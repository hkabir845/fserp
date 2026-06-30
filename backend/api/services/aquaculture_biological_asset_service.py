"""
Pond biological asset valuation and ledger.

Management view of accumulated pond production cost and survivor unit economics:
  Total biological asset value = direct pond costs + transfer-in − transfer-out − harvest relief.
  Mortality reduces live fish count but does not reduce accumulated cost (cost redistributes).
  Harvest relief removes cost proportional to fish sold (bio-asset GL relief pattern).

Reuses pond P&L bucket aggregation (aquaculture_cost_per_kg) and fish stock position.
"""
from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Sum
from django.db.models.functions import Coalesce

from api.models import (
    AquacultureFishPondTransferLine,
    AquacultureFishSale,
    AquacultureFishStockLedger,
    AquacultureProductionCycle,
    JournalEntryLine,
)
from api.services.aquaculture_cost_per_kg import (
    COST_BUCKET_LABELS,
    pond_bucket_amounts_for_period,
)
from api.services.aquaculture_data_bank_service import pond_biological_settlement
from api.services.aquaculture_pond_pl_opening import pl_opening_totals_for_pond
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows
from api.services.aquaculture_transfer_cost import pl_window_for_transfer_date
from api.services.tenant_reporting_categories import income_type_is_non_biological_for_company


def _money_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _kg_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


# Buckets that accumulate into biological asset value (excludes transfer-out and write-off).
_DIRECT_BIO_ASSET_BUCKETS = frozenset(COST_BUCKET_LABELS.keys()) - frozenset(
    {"fish_transfer_out", "biological_writeoff"}
)


def _harvest_bio_relief_total(
    company_id: int,
    *,
    pond_id: int,
    start: date,
    end: date,
    production_cycle_id: int | None,
) -> Decimal:
    """Sum of posted harvest bio-relief (Cr 1581) for finalized fish sales in scope."""
    q = AquacultureFishSale.objects.filter(
        company_id=company_id,
        pond_id=pond_id,
        sale_date__gte=start,
        sale_date__lte=end,
    ).select_related("pond")
    if production_cycle_id is not None:
        q = q.filter(production_cycle_id=production_cycle_id)

    total = Decimal("0")
    for sale in q:
        if income_type_is_non_biological_for_company(company_id, sale.income_type or ""):
            continue
        je_num = f"AUTO-AQ-SALE-{sale.id}-BIO"
        cr = (
            JournalEntryLine.objects.filter(
                journal_entry__company_id=company_id,
                journal_entry__entry_number=je_num,
                journal_entry__is_posted=True,
                account__account_code="1581",
                credit__gt=0,
            ).aggregate(t=Coalesce(Sum("credit"), Decimal("0")))["t"]
        )
        total += Decimal(str(cr or 0))
    return _money_q(total)


def _transfer_totals_for_scope(
    company_id: int,
    *,
    pond_id: int,
    start: date,
    end: date,
    production_cycle_id: int | None,
) -> tuple[Decimal, Decimal]:
    """Return (transfer_in, transfer_out) cost amounts for pond in date range."""
    rows = AquacultureFishPondTransferLine.objects.filter(
        transfer__company_id=company_id,
        transfer__transfer_date__gte=start,
        transfer__transfer_date__lte=end,
    ).values(
        "cost_amount",
        "to_pond_id",
        "to_production_cycle_id",
        "transfer__from_pond_id",
        "transfer__from_production_cycle_id",
    )
    t_in = Decimal("0")
    t_out = Decimal("0")
    for xr in rows:
        cost = _money_q(Decimal(str(xr["cost_amount"] or 0)))
        if cost == 0:
            continue
        fp = int(xr["transfer__from_pond_id"])
        tp = int(xr["to_pond_id"])
        fc = xr["transfer__from_production_cycle_id"]
        tc = xr["to_production_cycle_id"]
        fc_key: int | None = int(fc) if fc is not None else None
        tc_key: int | None = int(tc) if tc is not None else None
        if production_cycle_id is not None:
            if tp == pond_id and tc_key == production_cycle_id:
                t_in += cost
            if fp == pond_id and fc_key == production_cycle_id:
                t_out += cost
        else:
            if tp == pond_id:
                t_in += cost
            if fp == pond_id:
                t_out += cost
    return _money_q(t_in), _money_q(t_out)


def _shared_expenses_for_pl(company_id: int, start: date, end: date):
    from api.models import AquacultureExpense

    return list(
        AquacultureExpense.objects.filter(
            company_id=company_id,
            pond_id__isnull=True,
            expense_date__gte=start,
            expense_date__lte=end,
        ).prefetch_related("pond_shares")
    )


def _payroll_for_pond(
    company_id: int,
    *,
    pond_id: int,
    start: date,
    end: date,
    production_cycle_id: int | None,
) -> Decimal:
    from api.models import PayrollRunPondAllocation

    if production_cycle_id is not None:
        return Decimal("0")
    t = (
        PayrollRunPondAllocation.objects.filter(
            pond_id=pond_id,
            payroll_run__company_id=company_id,
            payroll_run__payment_date__gte=start,
            payroll_run__payment_date__lte=end,
        ).aggregate(s=Sum("amount"))["s"]
    )
    return _money_q(Decimal(str(t or 0)))


def _writeoff_for_scope(
    company_id: int,
    *,
    pond_id: int,
    start: date,
    end: date,
    production_cycle_id: int | None,
) -> Decimal:
    q = AquacultureFishStockLedger.objects.filter(
        company_id=company_id,
        pond_id=pond_id,
        entry_date__gte=start,
        entry_date__lte=end,
        entry_kind="loss",
    )
    if production_cycle_id is not None:
        q = q.filter(production_cycle_id=production_cycle_id)
    t = q.aggregate(s=Sum("book_value"))["s"]
    return _money_q(Decimal(str(t or 0)))


def compute_pond_biological_asset_summary(
    company_id: int,
    *,
    pond_id: int,
    as_of_date: date | None = None,
    production_cycle: AquacultureProductionCycle | None = None,
) -> dict:
    """
    Current biological asset valuation for a pond (or pond × cycle scope).

    Returns totals, cost per fish/kg, bucket breakdown, and reconciliation to GL 1581.
    """
    as_of = as_of_date or date.today()
    cycle_id = production_cycle.id if production_cycle is not None else None
    start, end = pl_window_for_transfer_date(as_of, production_cycle)

    shared = _shared_expenses_for_pl(company_id, start, end) if cycle_id is None else []
    t_in, t_out = _transfer_totals_for_scope(
        company_id,
        pond_id=pond_id,
        start=start,
        end=end,
        production_cycle_id=cycle_id,
    )
    writeoff = _writeoff_for_scope(
        company_id,
        pond_id=pond_id,
        start=start,
        end=end,
        production_cycle_id=cycle_id,
    )
    payroll = _payroll_for_pond(
        company_id,
        pond_id=pond_id,
        start=start,
        end=end,
        production_cycle_id=cycle_id,
    )

    buckets = pond_bucket_amounts_for_period(
        company_id=company_id,
        pond_id=pond_id,
        start=start,
        end=end,
        cycle_filter_id=cycle_id,
        shared_expenses=shared,
        transfer_in=t_in,
        transfer_out=t_out,
        biological_writeoff=writeoff,
        payroll_allocated=payroll,
    )

    prior_income, prior_expense, _, prior_expense_by = (
        (Decimal("0"), Decimal("0"), {}, {})
        if cycle_id is not None
        else pl_opening_totals_for_pond(company_id, pond_id)
    )

    direct_accumulated = Decimal("0")
    bucket_lines: list[dict] = []
    for code in sorted(_DIRECT_BIO_ASSET_BUCKETS, key=lambda c: COST_BUCKET_LABELS.get(c, c)):
        amt = _money_q(buckets.get(code, Decimal("0")))
        if amt == 0:
            continue
        direct_accumulated += amt
        bucket_lines.append(
            {
                "cost_bucket": code,
                "label": COST_BUCKET_LABELS.get(code, code),
                "amount": str(amt),
            }
        )

    if prior_expense > 0:
        direct_accumulated += _money_q(prior_expense)
        bucket_lines.insert(
            0,
            {
                "cost_bucket": "prior_pl_opening",
                "label": "Prior P&L opening (expense)",
                "amount": str(_money_q(prior_expense)),
            },
        )

    transfer_out_amt = _money_q(buckets.get("fish_transfer_out", Decimal("0")))
    harvest_relief = _harvest_bio_relief_total(
        company_id,
        pond_id=pond_id,
        start=start,
        end=end,
        production_cycle_id=cycle_id,
    )

    total_bio_asset_value = _money_q(direct_accumulated - transfer_out_amt - harvest_relief)

    pos_rows = compute_fish_stock_position_rows(
        company_id,
        pond_id=pond_id,
        production_cycle_id=cycle_id,
    )
    live_count = 0
    live_weight_kg = Decimal("0")
    mortality_count = 0
    if pos_rows:
        row = pos_rows[0]
        live_count = int(row.get("implied_net_fish_count") or 0)
        live_weight_kg = _kg_q(Decimal(str(row.get("implied_net_weight_kg") or 0)))
        mortality_count = int(row.get("mortality_fish_count") or 0)

    avg_weight_kg: str | None = None
    if live_count > 0 and live_weight_kg > 0:
        avg_weight_kg = str(_kg_q(live_weight_kg / Decimal(live_count)))

    cost_per_fish: str | None = None
    if live_count > 0 and total_bio_asset_value > 0:
        cost_per_fish = str(_money_q(total_bio_asset_value / Decimal(live_count)))

    cost_per_kg: str | None = None
    if live_weight_kg > 0 and total_bio_asset_value > 0:
        cost_per_kg = str(_money_q(total_bio_asset_value / live_weight_kg))

    settlement = pond_biological_settlement(company_id, pond_id, as_of)
    gl_1581_balance = _money_q(Decimal(str(settlement.get("settlement_bioasset_value") or 0)))

    from api.services.aquaculture_pond_bio_capitalization import company_capitalizes_pond_production

    capitalize = company_capitalizes_pond_production(company_id)
    recon_note: str | None = None
    if gl_1581_balance != total_bio_asset_value:
        if capitalize:
            recon_note = (
                "GL 1581 and management biological asset value differ — check lease/shop costs, "
                "harvest relief timing, or entries before capitalization was enabled."
            )
        else:
            recon_note = (
                "GL 1581 primarily capitalizes fry purchases; feed/medicine post to operating expense. "
                "Enable “Capitalize pond consumption to bio-asset” in company settings so all direct "
                "pond inputs accumulate in 1581 and align with management biological asset value."
            )

    return {
        "pond_id": pond_id,
        "production_cycle_id": cycle_id,
        "as_of_date": as_of.isoformat(),
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "total_biological_asset_value": str(total_bio_asset_value),
        "direct_cost_accumulated": str(_money_q(direct_accumulated)),
        "transfer_cost_in": str(t_in),
        "transfer_cost_out": str(transfer_out_amt),
        "harvest_bio_relief": str(harvest_relief),
        "mortality_book_writeoff": str(writeoff),
        "mortality_fish_count": mortality_count,
        "cost_redistribution_note": (
            "Mortality reduces live fish count but accumulated cost is retained on survivors "
            "(mortality book write-off is tracked separately and does not reduce this total)."
            if mortality_count != 0
            else None
        ),
        "live_fish_count": live_count,
        "live_weight_kg": str(live_weight_kg),
        "avg_weight_per_fish_kg": avg_weight_kg,
        "cost_per_fish": cost_per_fish,
        "cost_per_kg": cost_per_kg,
        "gl_1581_balance": str(gl_1581_balance),
        "gl_reconciliation_note": recon_note,
        "prior_pl_opening_income": str(_money_q(prior_income)),
        "prior_pl_opening_expense": str(_money_q(prior_expense)),
        "cost_buckets": bucket_lines,
    }


def compute_biological_asset_ledger_rows(
    company_id: int,
    *,
    pond_id: int,
    as_of_date: date | None = None,
    production_cycle: AquacultureProductionCycle | None = None,
    limit: int = 200,
) -> list[dict]:
    """
    Chronological ledger rows combining cost accumulation events and fish movements.
    Newest first. Each row includes quantity, value, and running cost hints where applicable.
    """
    from api.services.aquaculture_fish_biomass_ledger_service import compute_fish_biomass_ledger_rows

    as_of = as_of_date or date.today()
    cycle_id = production_cycle.id if production_cycle is not None else None
    start = date(as_of.year, 1, 1)
    if production_cycle and production_cycle.start_date:
        start = production_cycle.start_date

    biomass_rows = compute_fish_biomass_ledger_rows(
        company_id,
        pond_id=pond_id,
        production_cycle_id=cycle_id,
        date_from=start,
        date_to=as_of,
        limit=limit,
    )

    summary = compute_pond_biological_asset_summary(
        company_id,
        pond_id=pond_id,
        as_of_date=as_of,
        production_cycle=production_cycle,
    )
    cpf = summary.get("cost_per_fish")
    cpk = summary.get("cost_per_kg")

    out: list[dict] = []
    for br in biomass_rows:
        src = br.get("source") or ""
        fc = int(br.get("fish_count_delta") or 0)
        wkg = Decimal(str(br.get("weight_kg_delta") or 0))
        value = br.get("cost_amount")
        row: dict = {
            "entry_date": br.get("entry_date"),
            "entry_type": src,
            "entry_type_label": br.get("source_label") or src,
            "source_doc": br.get("source_doc") or "",
            "source_id": br.get("source_id"),
            "fish_count_delta": fc,
            "weight_kg_delta": str(wkg),
            "cost_amount": value,
            "production_cycle_id": br.get("production_cycle_id"),
            "production_cycle_name": br.get("production_cycle_name"),
            "fish_species_label": br.get("fish_species_label"),
            "memo": br.get("memo") or "",
        }
        if src in ("ledger_loss",) and fc < 0:
            row["cost_note"] = (
                "Mortality — quantity reduced; accumulated cost retained on survivors."
            )
            if cpf:
                row["implied_cost_per_survivor_fish"] = cpf
        elif src == "transfer_out" and value:
            row["cost_note"] = f"Transfer cost moved to destination pond ({value} BDT)."
        elif src == "transfer_in" and value:
            row["cost_note"] = f"Opening biological asset from source pond ({value} BDT)."
        elif src == "vendor_bill":
            row["cost_note"] = "Fry/fingerling purchase capitalized to pond biological asset."
        elif src == "sale" and wkg < 0:
            row["cost_note"] = "Harvest — bio-relief reduces pond biological asset value."
            if cpk:
                implied = _money_q(abs(wkg) * Decimal(str(cpk)))
                row["implied_harvest_cost"] = str(implied)
        out.append(row)
    return out


def compute_biological_asset_portfolio(
    company_id: int,
    *,
    as_of_date: date | None = None,
) -> dict:
    """All active ponds: biological asset summary snapshot."""
    from api.models import AquaculturePond

    as_of = as_of_date or date.today()
    ponds = AquaculturePond.objects.filter(company_id=company_id, is_active=True).order_by(
        "sort_order", "id"
    )
    rows = []
    grand_value = Decimal("0")
    grand_count = 0
    for pond in ponds:
        s = compute_pond_biological_asset_summary(company_id, pond_id=pond.id, as_of_date=as_of)
        rows.append(
            {
                "pond_id": pond.id,
                "pond_name": pond.name,
                "pond_role": pond.pond_role or "",
                **{k: s[k] for k in (
                    "total_biological_asset_value",
                    "live_fish_count",
                    "live_weight_kg",
                    "cost_per_fish",
                    "cost_per_kg",
                    "gl_1581_balance",
                )},
            }
        )
        grand_value += Decimal(str(s["total_biological_asset_value"]))
        grand_count += int(s["live_fish_count"])
    return {
        "as_of_date": as_of.isoformat(),
        "pond_count": len(rows),
        "total_biological_asset_value": str(_money_q(grand_value)),
        "total_live_fish_count": grand_count,
        "ponds": rows,
    }
