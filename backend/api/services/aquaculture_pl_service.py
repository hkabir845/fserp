"""
Shared aquaculture pond P&L aggregation (used by aquaculture API and Reports module).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal

from django.db.models import Sum

from api.models import (
    AquacultureExpense,
    AquacultureFishPondTransferLine,
    AquacultureFishSale,
    AquacultureFishStockLedger,
    AquaculturePond,
    AquacultureProductionCycle,
    PayrollRunPondAllocation,
)
from api.services.aquaculture_constants import (
    AQUACULTURE_EXPENSE_CATEGORY_CHOICES,
    AQUACULTURE_INCOME_TYPE_CHOICES,
    FISH_STOCK_LEDGER_PL_NOTE,
    INTER_POND_FISH_TRANSFER_PL_NOTE,
    SHARED_OPERATING_COST_RULE,
)
from api.services.tenant_reporting_categories import aquaculture_expense_label, aquaculture_income_label
from api.services.aquaculture_cost_per_kg import (
    build_pond_cost_per_kg_block,
    cost_bucket_to_pl_expense_category,
    fry_stocking_capitalized_manual_expense_ids,
    landlord_lease_payment_pond_operating_total,
    pond_fry_stocking_capitalized_journal_total,
    pond_warehouse_consumption_cogs_journal_total,
    vendor_bill_only_pond_bucket_additions,
    vendor_bill_pond_operating_total,
)
from api.services.aquaculture_pl_expense_sum import pond_consumption_amounts_by_category
from api.services.aquaculture_pond_pl_opening import pl_opening_totals_for_pond


def _money_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"))


PL_FISH_INCOME_TYPES: frozenset[str] = frozenset({"fish_harvest_sale", "fingerling_sale"})
PL_EMPTY_SACK_INCOME_TYPES: frozenset[str] = frozenset({"empty_feed_sack_sale"})

PL_SUPPLEMENTAL_EXPENSE_KEYS: tuple[tuple[str, str], ...] = (
    ("fish_transfer_cost_in", "Inter-pond fish transfer in"),
    ("fish_transfer_cost_out", "Inter-pond fish transfer out"),
    ("biological_write_offs", "Biological write-offs (mortality)"),
    ("payroll_allocated", "Salaries, bonus & payroll"),
)
PL_SUPPLEMENTAL_EXPENSE_CODES: frozenset[str] = frozenset(c for c, _ in PL_SUPPLEMENTAL_EXPENSE_KEYS)
PL_SUPPLEMENTAL_EXPENSE_LABELS: dict[str, str] = dict(PL_SUPPLEMENTAL_EXPENSE_KEYS)

# P&L matrix: key operating costs first (feed, medicine, pond care, salaries, lease, equipment, …).
PL_EXPENSE_DISPLAY_ORDER: tuple[str, ...] = (
    "feed_purchase",
    "feed_consumed",
    "medicine_purchase",
    "medicine_consumed",
    "pond_care_products",
    "fry_stocking",
    "worker_salary",
    "payroll_allocated",
    "lease",
    "soilcut",
    "pond_preparation",
    "equipment",
    "repair_maintenance",
    "netting_gear",
    "depreciation",
    "electricity",
    "generator_fuel",
    "water",
    "transportation",
    "fish_haul_supplies",
    "fisherman",
    "day_labor",
    "shop_supplies",
    "office_supplies",
    "meals_entertainment",
    "sampling_lab",
    "security",
    "predator_control",
    "insurance",
    "mortality",
    "vendor_bill_pond",
    "fish_transfer_cost_in",
    "fish_transfer_cost_out",
    "biological_write_offs",
    "bank_charges",
    "licenses_permits",
    "professional_fees",
    "communication",
    "other",
)

PL_EQUIPMENT_EXPENSE_CODES: frozenset[str] = frozenset(
    {"equipment", "repair_maintenance", "netting_gear", "depreciation"}
)

PL_OTHER_CONSUMPTION_CODES: frozenset[str] = frozenset(
    {"pond_care_products", "shop_supplies", "pond_preparation"}
)


def _pl_expense_label(company_id: int, code: str) -> str:
    if code == "__consumption_cogs_adjustment":
        return "Warehouse COGS dedup (vendor bill offset)"
    if code in PL_SUPPLEMENTAL_EXPENSE_LABELS:
        return PL_SUPPLEMENTAL_EXPENSE_LABELS[code]
    return aquaculture_expense_label(company_id, code)


def _sort_pl_expense_keys(keys: list[str]) -> list[str]:
    order = {c: i for i, c in enumerate(PL_EXPENSE_DISPLAY_ORDER)}
    return sorted(keys, key=lambda k: (order.get(k, len(PL_EXPENSE_DISPLAY_ORDER)), k))


def _sum_expense_codes(amounts: dict[str, Decimal], codes: frozenset[str] | set[str]) -> Decimal:
    return _money_q(sum(_money_q(amounts.get(c, Decimal("0"))) for c in codes))


def _ordered_pl_category_keys(
    builtin_choices: tuple[tuple[str, str], ...],
    amounts: dict[str, Decimal],
    supplemental: tuple[tuple[str, str], ...],
    *,
    show_full_catalog: bool,
) -> list[str]:
    """Catalog order for P&L matrix columns; full catalog for one entity, active-only for all."""
    builtin = [c for c, _ in builtin_choices]
    supp = [c for c, _ in supplemental]
    custom = sorted(k for k in amounts if k not in builtin and k not in supp)
    if show_full_catalog:
        return builtin + supp + custom
    active = {k for k, v in amounts.items() if v != 0}
    return (
        [k for k in builtin if k in active]
        + [k for k in supp if k in active]
        + [k for k in custom if k in active]
    )


def _category_amount_rows(
    company_id: int,
    ordered_keys: list[str],
    amounts: dict[str, Decimal],
    *,
    label_fn,
) -> list[dict]:
    return [
        {
            "category": code,
            "label": label_fn(company_id, code),
            "amount": str(_money_q(amounts.get(code, Decimal("0")))),
        }
        for code in ordered_keys
    ]


def _pond_expense_amounts_dict(
    company_id: int,
    pond_id: int,
    start: date,
    end: date,
    cycle_filter_id: int | None,
    *,
    shared_expenses: list,
    landlord_lease: Decimal,
    transfer_in: Decimal,
    transfer_out: Decimal,
    writeoff: Decimal,
    payroll: Decimal,
    prior_expense_by: dict[str, Decimal],
    dexp_q_fn,
) -> dict[str, Decimal]:
    """All expense category amounts for one pond (register, bills, consumption, transfers, payroll)."""
    out: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    for row in dexp_q_fn(pond_id).values("expense_category").annotate(s=Sum("amount")):
        out[str(row["expense_category"] or "")] += _money_q(row["s"] or Decimal("0"))
    consumption_by_cat = pond_consumption_amounts_by_category(
        company_id=company_id,
        pond_id=pond_id,
        start=start,
        end=end,
        cycle_filter_id=cycle_filter_id,
    )
    for code, amt in consumption_by_cat.items():
        out[code] += _money_q(amt)
    for bkey, bamt in vendor_bill_only_pond_bucket_additions(
        company_id=company_id,
        pond_id=pond_id,
        start=start,
        end=end,
        cycle_filter_id=cycle_filter_id,
    ).items():
        if bkey == "fry_stocking":
            # Fry vendor bills are included via pond_fry_stocking_capitalized_journal_total (1581 + legacy 6715).
            continue
        if bamt == 0:
            continue
        out[cost_bucket_to_pl_expense_category(bkey)] += _money_q(bamt)
    out["lease"] += landlord_lease
    out["fry_stocking"] += pond_fry_stocking_capitalized_journal_total(
        company_id=company_id,
        pond_id=pond_id,
        start=start,
        end=end,
        cycle_filter_id=cycle_filter_id,
    )
    out["fry_stocking"] = _money_q(out.get("fry_stocking", Decimal("0")))
    if cycle_filter_id is None:
        for e in shared_expenses:
            for sh in e.pond_shares.filter(pond_id=pond_id):
                out[e.expense_category] += _money_q(sh.amount)
    for code, amt in prior_expense_by.items():
        out[code] += _money_q(amt)
    out["fish_transfer_cost_in"] = _money_q(transfer_in)
    out["fish_transfer_cost_out"] = _money_q(transfer_out)
    out["biological_write_offs"] = _money_q(writeoff)
    out["payroll_allocated"] = _money_q(payroll)
    return dict(out)


def _pond_income_total(merged_rev: dict[str, Decimal]) -> Decimal:
    return _money_q(sum((_money_q(v) for v in merged_rev.values()), Decimal("0")))


def _pond_expense_matrix_total(pond_exp: dict[str, Decimal]) -> Decimal:
    """Sum every expense category; inter-pond transfer-out reduces the total."""
    total = Decimal("0")
    for code, amt in pond_exp.items():
        if code == "fish_transfer_cost_out":
            total -= _money_q(amt)
        else:
            total += _money_q(amt)
    return _money_q(total)


def _income_breakdown(merged_rev: dict[str, Decimal]) -> tuple[Decimal, Decimal, Decimal]:
    fish = Decimal("0")
    empty = Decimal("0")
    other = Decimal("0")
    for code, amt in merged_rev.items():
        if code in PL_FISH_INCOME_TYPES:
            fish += amt
        elif code in PL_EMPTY_SACK_INCOME_TYPES:
            empty += amt
        else:
            other += amt
    return _money_q(fish), _money_q(empty), _money_q(other)


def _fry_fingerling_cost_for_pond(
    company_id: int,
    pond_id: int,
    start: date,
    end: date,
    cycle_filter_id: int | None,
    transfer_in: Decimal,
) -> Decimal:
    """Fry purchases, capitalized fingerling bills, and inter-pond transfer-in cost."""
    capitalized_ids = fry_stocking_capitalized_manual_expense_ids(company_id)
    fry_q = AquacultureExpense.objects.filter(
        company_id=company_id,
        pond_id=pond_id,
        expense_category="fry_stocking",
        expense_date__gte=start,
        expense_date__lte=end,
    )
    if cycle_filter_id is not None:
        fry_q = fry_q.filter(production_cycle_id=cycle_filter_id)
    if capitalized_ids:
        fry_q = fry_q.exclude(pk__in=capitalized_ids)
    fry_manual = _money_q(fry_q.aggregate(t=Sum("amount"))["t"] or Decimal("0"))
    fry_journals = pond_fry_stocking_capitalized_journal_total(
        company_id=company_id,
        pond_id=pond_id,
        start=start,
        end=end,
        cycle_filter_id=cycle_filter_id,
    )
    return _money_q(transfer_in + fry_manual + fry_journals)


def _lease_cost_for_pond(
    company_id: int,
    pond_id: int,
    start: date,
    end: date,
    cycle_filter_id: int | None,
    landlord_lease_total: Decimal,
) -> Decimal:
    lease_manual = _pond_category_expense_sum(
        company_id, pond_id, "lease", start, end, cycle_filter_id
    )
    return _money_q(landlord_lease_total + lease_manual)


def _pond_category_expense_sum(
    company_id: int,
    pond_id: int,
    category: str,
    start: date,
    end: date,
    cycle_filter_id: int | None,
) -> Decimal:
    q = AquacultureExpense.objects.filter(
        company_id=company_id,
        pond_id=pond_id,
        expense_category=category,
        expense_date__gte=start,
        expense_date__lte=end,
    )
    if cycle_filter_id is not None:
        q = q.filter(production_cycle_id=cycle_filter_id)
    return _money_q(q.aggregate(t=Sum("amount"))["t"] or Decimal("0"))


def compute_aquaculture_pl_summary_dict(
    company_id: int,
    start: date,
    end: date,
    pond_filter_id: int | None,
    cycle_filter_id: int | None,
    scoped_cycle: AquacultureProductionCycle | None,
    include_cycle_breakdown: bool,
) -> dict:
    """Returns the same JSON-shaped dict as the legacy aquaculture_pl_summary view."""
    cid = company_id

    ponds_qs = AquaculturePond.objects.filter(company_id=cid).order_by("sort_order", "id")
    if pond_filter_id is not None:
        ponds_qs = ponds_qs.filter(pk=pond_filter_id)
    else:
        ponds_qs = ponds_qs.filter(is_active=True)

    shared_expenses = list(
        AquacultureExpense.objects.filter(
            company_id=cid,
            pond_id__isnull=True,
            expense_date__gte=start,
            expense_date__lte=end,
        ).prefetch_related("pond_shares")
    )
    shared_per_pond: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    for e in shared_expenses:
        for sh in e.pond_shares.all():
            shared_per_pond[sh.pond_id] += _money_q(sh.amount)

    xfer_rows = list(
        AquacultureFishPondTransferLine.objects.filter(
            transfer__company_id=cid,
            transfer__transfer_date__gte=start,
            transfer__transfer_date__lte=end,
        ).values(
            "cost_amount",
            "to_pond_id",
            "to_production_cycle_id",
            "transfer__from_pond_id",
            "transfer__from_production_cycle_id",
        )
    )
    transfer_in_by_pond: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    transfer_out_by_pond: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    trans_cycle_in: dict[tuple[int, int | None], Decimal] = defaultdict(lambda: Decimal("0"))
    trans_cycle_out: dict[tuple[int, int | None], Decimal] = defaultdict(lambda: Decimal("0"))
    for xr in xfer_rows:
        cost = _money_q(Decimal(str(xr["cost_amount"] or 0)))
        if cost == 0:
            continue
        fp = int(xr["transfer__from_pond_id"])
        tp = int(xr["to_pond_id"])
        fc = xr["transfer__from_production_cycle_id"]
        tc = xr["to_production_cycle_id"]
        fc_key: int | None = int(fc) if fc is not None else None
        tc_key: int | None = int(tc) if tc is not None else None
        transfer_in_by_pond[tp] += cost
        transfer_out_by_pond[fp] += cost
        trans_cycle_in[(tp, tc_key)] += cost
        trans_cycle_out[(fp, fc_key)] += cost

    def _rev_q(pond_id: int):
        q = AquacultureFishSale.objects.filter(
            company_id=cid,
            pond_id=pond_id,
            sale_date__gte=start,
            sale_date__lte=end,
        )
        if cycle_filter_id is not None:
            q = q.filter(production_cycle_id=cycle_filter_id)
        return q

    def _dexp_q(pond_id: int):
        from api.services.aquaculture_pl_expense_sum import aquaculture_expenses_for_pl_direct_sum

        q = AquacultureExpense.objects.filter(
            company_id=cid,
            pond_id=pond_id,
            expense_date__gte=start,
            expense_date__lte=end,
        )
        if cycle_filter_id is not None:
            q = q.filter(production_cycle_id=cycle_filter_id)
        return aquaculture_expenses_for_pl_direct_sum(q)

    scope_note = None
    if cycle_filter_id is not None:
        scope_note = (
            "Scoped to this production cycle: revenue and direct pond expenses only. "
            "Shared aquaculture costs and payroll allocation are not applied in cycle-only scope "
            "(shown as zero here; use full pond view for complete net). "
            "Fish transfer cost is included when transfer lines reference this production_cycle_id "
            "(source: from_production_cycle; destination: to_production_cycle). "
            "Fish stock ledger losses use the same production_cycle_id filter."
        )

    loss_led_q = AquacultureFishStockLedger.objects.filter(
        company_id=cid,
        entry_date__gte=start,
        entry_date__lte=end,
        entry_kind="loss",
    )
    if pond_filter_id is not None:
        loss_led_q = loss_led_q.filter(pond_id=pond_filter_id)
    if cycle_filter_id is not None:
        loss_led_q = loss_led_q.filter(production_cycle_id=cycle_filter_id)
    writeoff_by_pond: dict[int, Decimal] = {}
    for row in loss_led_q.values("pond_id").annotate(t=Sum("book_value")):
        writeoff_by_pond[int(row["pond_id"])] = _money_q(Decimal(str(row["t"] or 0)))

    rows = []
    total_rev = Decimal("0")
    total_exp = Decimal("0")
    total_pay = Decimal("0")
    total_feed = Decimal("0")
    total_med = Decimal("0")
    total_fry = Decimal("0")
    total_lease = Decimal("0")
    total_rev_fish = Decimal("0")
    total_rev_empty = Decimal("0")
    total_rev_other = Decimal("0")
    total_direct = Decimal("0")
    total_shared = Decimal("0")
    total_other = Decimal("0")
    total_salaries_payroll = Decimal("0")
    total_pond_care = Decimal("0")
    total_equipment = Decimal("0")
    total_other_consumption = Decimal("0")

    pond_income_amounts: list[tuple[int, str, dict[str, Decimal]]] = []
    pond_expense_amounts: list[tuple[int, str, dict[str, Decimal]]] = []
    company_income_dec: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    company_expense_dec: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))

    for pond in ponds_qs:
        exp_aq = _money_q(_dexp_q(pond.id).aggregate(t=Sum("amount"))["t"] or Decimal("0"))
        exp_bill = vendor_bill_pond_operating_total(
            company_id=cid,
            pond_id=pond.id,
            start=start,
            end=end,
            cycle_filter_id=cycle_filter_id,
        )
        exp_landlord_lease = landlord_lease_payment_pond_operating_total(
            company_id=cid,
            pond_id=pond.id,
            start=start,
            end=end,
            cycle_filter_id=cycle_filter_id,
        )
        exp_direct = _money_q(exp_aq + exp_bill + exp_landlord_lease)
        exp_shared = (
            Decimal("0") if cycle_filter_id is not None else _money_q(shared_per_pond.get(pond.id, Decimal("0")))
        )
        if cycle_filter_id is not None:
            t_in = _money_q(trans_cycle_in.get((pond.id, cycle_filter_id), Decimal("0")))
            t_out = _money_q(trans_cycle_out.get((pond.id, cycle_filter_id), Decimal("0")))
        else:
            t_in = _money_q(transfer_in_by_pond.get(pond.id, Decimal("0")))
            t_out = _money_q(transfer_out_by_pond.get(pond.id, Decimal("0")))
        wo = _money_q(writeoff_by_pond.get(pond.id, Decimal("0")))
        prior_income = prior_expense = Decimal("0")
        prior_income_by: dict[str, Decimal] = {}
        prior_expense_by: dict[str, Decimal] = {}
        if cycle_filter_id is None:
            prior_income, prior_expense, prior_income_by, prior_expense_by = pl_opening_totals_for_pond(
                cid, pond.id
            )
        feed_cost = _pond_category_expense_sum(
            cid, pond.id, "feed_consumed", start, end, cycle_filter_id
        )
        med_cost = _pond_category_expense_sum(
            cid, pond.id, "medicine_consumed", start, end, cycle_filter_id
        )
        consumption_journals = pond_warehouse_consumption_cogs_journal_total(
            company_id=cid,
            pond_id=pond.id,
            start=start,
            end=end,
            cycle_filter_id=cycle_filter_id,
        )
        exp_total = _money_q(
            exp_direct
            + exp_shared
            + t_in
            - t_out
            + wo
            + prior_expense
            + feed_cost
            + med_cost
            - consumption_journals
        )
        period_rev = _rev_q(pond.id).aggregate(t=Sum("total_amount"))["t"] or Decimal("0")
        rev = _money_q(Decimal(str(period_rev)) + prior_income)
        if cycle_filter_id is not None:
            pay = Decimal("0")
        else:
            pay = _money_q(
                PayrollRunPondAllocation.objects.filter(
                    pond_id=pond.id,
                    payroll_run__company_id=cid,
                    payroll_run__payment_date__gte=start,
                    payroll_run__payment_date__lte=end,
                ).aggregate(t=Sum("amount"))["t"]
                or Decimal("0")
            )
        profit = _money_q(rev - exp_total - pay)

        merged_rev: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
        rq = _rev_q(pond.id)
        for row in rq.values("income_type").annotate(t=Sum("total_amount")):
            code = str(row["income_type"] or "")
            merged_rev[code] += _money_q(Decimal(str(row["t"] or 0)))
        for code, amt in prior_income_by.items():
            merged_rev[code] += _money_q(amt)
        rev_fish, rev_empty, rev_other = _income_breakdown(dict(merged_rev))
        fry_cost = _fry_fingerling_cost_for_pond(
            cid, pond.id, start, end, cycle_filter_id, t_in
        )
        lease_cost = _lease_cost_for_pond(
            cid, pond.id, start, end, cycle_filter_id, exp_landlord_lease
        )

        rev_by_type: list[dict] = []
        for code, tq in merged_rev.items():
            if tq == 0:
                continue
            rev_by_type.append(
                {
                    "income_type": code,
                    "label": aquaculture_income_label(cid, code),
                    "amount": str(tq),
                }
            )
        rev_by_type.sort(key=lambda x: x["income_type"])

        pond_income = dict(merged_rev)
        pond_income_amounts.append((pond.id, pond.name, pond_income))
        for code, amt in pond_income.items():
            company_income_dec[code] += _money_q(amt)

        pond_exp = _pond_expense_amounts_dict(
            cid,
            pond.id,
            start,
            end,
            cycle_filter_id,
            shared_expenses=shared_expenses,
            landlord_lease=exp_landlord_lease,
            transfer_in=t_in,
            transfer_out=t_out,
            writeoff=wo,
            payroll=pay,
            prior_expense_by=prior_expense_by,
            dexp_q_fn=_dexp_q,
        )
        pond_expense_amounts.append((pond.id, pond.name, pond_exp))
        for code, amt in pond_exp.items():
            signed = _money_q(amt)
            if code == "fish_transfer_cost_out":
                company_expense_dec[code] -= signed
            else:
                company_expense_dec[code] += signed

        salaries_payroll_cost = _money_q(
            _money_q(pond_exp.get("worker_salary", Decimal("0")))
            + _money_q(pond_exp.get("payroll_allocated", Decimal("0")))
        )
        pond_care_cost = _money_q(pond_exp.get("pond_care_products", Decimal("0")))
        equipment_cost = _sum_expense_codes(pond_exp, PL_EQUIPMENT_EXPENSE_CODES)
        feed_consumption_total = _money_q(pond_exp.get("feed_consumed", Decimal("0")))
        medicine_consumption_total = _money_q(pond_exp.get("medicine_consumed", Decimal("0")))
        other_consumption_total = _sum_expense_codes(pond_exp, PL_OTHER_CONSUMPTION_CODES)
        income_total = _pond_income_total(pond_income)
        expense_total = _pond_expense_matrix_total(pond_exp)
        net_profit = _money_q(income_total - expense_total)
        other_opex = _money_q(
            expense_total
            - feed_consumption_total
            - medicine_consumption_total
            - other_consumption_total
            - fry_cost
            - lease_cost
            - salaries_payroll_cost
            - pond_care_cost
            - equipment_cost
        )
        if other_opex < 0:
            other_opex = Decimal("0")

        rows.append(
            {
                "pond_id": pond.id,
                "pond_name": pond.name,
                "revenue": str(rev),
                "income_total": str(income_total),
                "expense_total": str(expense_total),
                "net_profit": str(net_profit),
                "revenue_fish_sales": str(rev_fish),
                "revenue_empty_sack_sales": str(rev_empty),
                "revenue_other_income": str(rev_other),
                "prior_pl_opening_income": str(_money_q(prior_income)),
                "prior_pl_opening_expense": str(_money_q(prior_expense)),
                "revenue_by_income_type": rev_by_type,
                "direct_operating_expenses": str(exp_direct),
                "shared_operating_expenses": str(exp_shared),
                "feed_consumption_cost": str(feed_consumption_total),
                "medicine_consumption_cost": str(medicine_consumption_total),
                "other_consumption_cost": str(other_consumption_total),
                "fry_fingerling_cost": str(fry_cost),
                "lease_cost": str(lease_cost),
                "salaries_and_payroll_cost": str(salaries_payroll_cost),
                "pond_care_products_cost": str(pond_care_cost),
                "equipment_cost": str(equipment_cost),
                "other_operating_expenses": str(other_opex),
                "fish_transfer_cost_in": str(t_in),
                "fish_transfer_cost_out": str(t_out),
                "biological_write_offs": str(wo),
                "operating_expenses": str(exp_total),
                "payroll_allocated": str(pay),
                "total_costs": str(expense_total),
                "profit": str(net_profit),
                "cost_per_kg": build_pond_cost_per_kg_block(
                    company_id=cid,
                    pond_id=pond.id,
                    pond_name=pond.name,
                    start=start,
                    end=end,
                    cycle_filter_id=cycle_filter_id,
                    operating_expenses_total=expense_total,
                    payroll_allocated=pay,
                    total_costs=expense_total,
                    shared_expenses=shared_expenses,
                    transfer_in=t_in,
                    transfer_out=t_out,
                    biological_writeoff=wo,
                ),
            }
        )
        total_rev += rev
        total_exp += expense_total
        total_pay += pay
        total_fry += fry_cost
        total_lease += lease_cost
        total_rev_fish += rev_fish
        total_rev_empty += rev_empty
        total_rev_other += rev_other
        total_other += other_opex
        total_direct += exp_direct
        total_shared += exp_shared
        total_salaries_payroll += salaries_payroll_cost
        total_pond_care += pond_care_cost
        total_equipment += equipment_cost
        total_other_consumption += other_consumption_total
        total_feed += feed_consumption_total
        total_med += medicine_consumption_total

    total_profit = _money_q(total_rev - total_exp)

    # Always expose the full income/expense catalog as matrix columns (zeros where no activity).
    show_full_catalog = True

    income_column_keys = _ordered_pl_category_keys(
        AQUACULTURE_INCOME_TYPE_CHOICES,
        dict(company_income_dec),
        (),
        show_full_catalog=show_full_catalog,
    )
    expense_column_keys = _sort_pl_expense_keys(
        _ordered_pl_category_keys(
            AQUACULTURE_EXPENSE_CATEGORY_CHOICES,
            dict(company_expense_dec),
            PL_SUPPLEMENTAL_EXPENSE_KEYS,
            show_full_catalog=show_full_catalog,
        )
    )

    income_by_pond = [
        {
            "pond_id": pid,
            "pond_name": pname,
            "categories": _category_amount_rows(
                cid,
                income_column_keys,
                amounts,
                label_fn=aquaculture_income_label,
            ),
        }
        for pid, pname, amounts in pond_income_amounts
    ]
    income_by_category_list = _category_amount_rows(
        cid,
        income_column_keys,
        dict(company_income_dec),
        label_fn=aquaculture_income_label,
    )

    expenses_by_pond = [
        {
            "pond_id": pid,
            "pond_name": pname,
            "categories": _category_amount_rows(
                cid,
                expense_column_keys,
                amounts,
                label_fn=_pl_expense_label,
            ),
        }
        for pid, pname, amounts in pond_expense_amounts
    ]
    expenses_by_category_list = _category_amount_rows(
        cid,
        expense_column_keys,
        dict(company_expense_dec),
        label_fn=_pl_expense_label,
    )

    cycle_segments: list[dict] = []
    if include_cycle_breakdown and cycle_filter_id is None:
        for pond in ponds_qs:
            cycles = AquacultureProductionCycle.objects.filter(
                company_id=cid, pond_id=pond.id, is_active=True
            ).order_by("sort_order", "-start_date", "id")
            for c in cycles:
                if c.end_date and c.end_date < start:
                    continue
                if c.start_date > end:
                    continue
                crev = _money_q(
                    AquacultureFishSale.objects.filter(
                        company_id=cid,
                        pond_id=pond.id,
                        production_cycle_id=c.id,
                        sale_date__gte=start,
                        sale_date__lte=end,
                    ).aggregate(t=Sum("total_amount"))["t"]
                    or Decimal("0")
                )
                cexp_aq = _money_q(
                    AquacultureExpense.objects.filter(
                        company_id=cid,
                        pond_id=pond.id,
                        production_cycle_id=c.id,
                        expense_date__gte=start,
                        expense_date__lte=end,
                    ).aggregate(t=Sum("amount"))["t"]
                    or Decimal("0")
                )
                cexp_bill = vendor_bill_pond_operating_total(
                    company_id=cid,
                    pond_id=pond.id,
                    start=start,
                    end=end,
                    cycle_filter_id=c.id,
                )
                cexp_ll = landlord_lease_payment_pond_operating_total(
                    company_id=cid,
                    pond_id=pond.id,
                    start=start,
                    end=end,
                    cycle_filter_id=c.id,
                )
                cexp = _money_q(cexp_aq + cexp_bill + cexp_ll)
                ct_in = _money_q(trans_cycle_in.get((pond.id, c.id), Decimal("0")))
                ct_out = _money_q(trans_cycle_out.get((pond.id, c.id), Decimal("0")))
                cexp_adj = _money_q(cexp + ct_in - ct_out)
                if crev != 0 or cexp != 0 or ct_in != 0 or ct_out != 0:
                    cycle_segments.append(
                        {
                            "pond_id": pond.id,
                            "pond_name": pond.name,
                            "production_cycle_id": c.id,
                            "production_cycle_name": c.name,
                            "revenue": str(crev),
                            "direct_operating_expenses": str(cexp),
                            "fish_transfer_cost_in": str(ct_in),
                            "fish_transfer_cost_out": str(ct_out),
                            "direct_operating_expenses_with_transfers": str(cexp_adj),
                            "segment_margin": str(_money_q(crev - cexp_adj)),
                        }
                    )
            urev = _money_q(
                AquacultureFishSale.objects.filter(
                    company_id=cid,
                    pond_id=pond.id,
                    production_cycle__isnull=True,
                    sale_date__gte=start,
                    sale_date__lte=end,
                ).aggregate(t=Sum("total_amount"))["t"]
                or Decimal("0")
            )
            uexp_aq = _money_q(
                AquacultureExpense.objects.filter(
                    company_id=cid,
                    pond_id=pond.id,
                    production_cycle__isnull=True,
                    expense_date__gte=start,
                    expense_date__lte=end,
                ).aggregate(t=Sum("amount"))["t"]
                or Decimal("0")
            )
            uexp_bill = vendor_bill_pond_operating_total(
                company_id=cid,
                pond_id=pond.id,
                start=start,
                end=end,
                cycle_filter_id=None,
                uncycled_bill_lines_only=True,
            )
            uexp_ll = landlord_lease_payment_pond_operating_total(
                company_id=cid,
                pond_id=pond.id,
                start=start,
                end=end,
                cycle_filter_id=None,
                uncycled_landlord_lines_only=True,
            )
            uexp = _money_q(uexp_aq + uexp_bill + uexp_ll)
            ut_in = _money_q(trans_cycle_in.get((pond.id, None), Decimal("0")))
            ut_out = _money_q(trans_cycle_out.get((pond.id, None), Decimal("0")))
            uexp_adj = _money_q(uexp + ut_in - ut_out)
            if urev != 0 or uexp != 0 or ut_in != 0 or ut_out != 0:
                cycle_segments.append(
                    {
                        "pond_id": pond.id,
                        "pond_name": pond.name,
                        "production_cycle_id": None,
                        "production_cycle_name": "No production cycle",
                        "revenue": str(urev),
                        "direct_operating_expenses": str(uexp),
                        "fish_transfer_cost_in": str(ut_in),
                        "fish_transfer_cost_out": str(ut_out),
                        "direct_operating_expenses_with_transfers": str(uexp_adj),
                        "segment_margin": str(_money_q(urev - uexp_adj)),
                    }
                )

    payload = {
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "pond_scope_id": pond_filter_id,
        "cycle_scope_id": cycle_filter_id,
        "cycle_scope_name": (scoped_cycle.name or "").strip() if scoped_cycle else None,
        "cycle_scope_note": scope_note,
        "shared_operating_cost_rule": SHARED_OPERATING_COST_RULE,
        "inter_pond_fish_transfer_note": INTER_POND_FISH_TRANSFER_PL_NOTE,
        "fish_stock_ledger_note": FISH_STOCK_LEDGER_PL_NOTE,
        "pl_show_full_catalog": show_full_catalog,
        "pl_formula_note": (
            "Net profit = Total income − Total costs & expenses. "
            "Every registered income type and expense category is listed; zeros where none in the period. "
            "Feed, medicine, and shop-issued consumption appear in their own columns; "
            "inter-pond transfer out reduces expenses."
        ),
        "pl_grand_totals": {
            "total_income": str(_money_q(total_rev)),
            "total_costs_and_expenses": str(_money_q(total_exp)),
            "net_profit": str(total_profit),
        },
        "pl_income_columns": [
            {"code": c, "label": aquaculture_income_label(cid, c)} for c in income_column_keys
        ],
        "pl_expense_columns": [
            {"code": c, "label": _pl_expense_label(cid, c)} for c in expense_column_keys
        ],
        "ponds": rows,
        "income_by_pond": income_by_pond,
        "income_by_category": income_by_category_list,
        "expenses_by_pond": expenses_by_pond,
        "expenses_by_category": expenses_by_category_list,
        "totals": {
            "revenue": str(_money_q(total_rev)),
            "revenue_fish_sales": str(_money_q(total_rev_fish)),
            "revenue_empty_sack_sales": str(_money_q(total_rev_empty)),
            "revenue_other_income": str(_money_q(total_rev_other)),
            "operating_expenses": str(_money_q(total_exp)),
            "direct_operating_expenses": str(_money_q(total_direct)),
            "shared_operating_expenses": str(_money_q(total_shared)),
            "feed_consumption_cost": str(_money_q(total_feed)),
            "medicine_consumption_cost": str(_money_q(total_med)),
            "fry_fingerling_cost": str(_money_q(total_fry)),
            "lease_cost": str(_money_q(total_lease)),
            "salaries_and_payroll_cost": str(_money_q(total_salaries_payroll)),
            "pond_care_products_cost": str(_money_q(total_pond_care)),
            "equipment_cost": str(_money_q(total_equipment)),
            "other_consumption_cost": str(_money_q(total_other_consumption)),
            "other_operating_expenses": str(_money_q(total_other)),
            "payroll_allocated": str(_money_q(total_pay)),
            "total_costs": str(_money_q(total_exp)),
            "total_income": str(_money_q(total_rev)),
            "total_costs_and_expenses": str(_money_q(total_exp)),
            "consumption_expenses_total": str(
                _money_q(total_feed + total_med + total_other_consumption)
            ),
            "profit": str(total_profit),
            "net_profit": str(total_profit),
        },
    }
    if include_cycle_breakdown:
        payload["pond_cycle_segments"] = cycle_segments
    return payload
