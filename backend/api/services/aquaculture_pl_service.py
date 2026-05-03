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
    EXPENSE_CATEGORY_LABELS,
    FISH_STOCK_LEDGER_PL_NOTE,
    INTER_POND_FISH_TRANSFER_PL_NOTE,
    SHARED_OPERATING_COST_RULE,
)
from api.services.aquaculture_cost_per_kg import aquaculture_pl_cost_basis_doc, build_pond_cost_per_kg_block


def _money_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"))


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

    ponds_qs = AquaculturePond.objects.filter(company_id=cid, is_active=True).order_by("sort_order", "id")
    if pond_filter_id is not None:
        ponds_qs = ponds_qs.filter(pk=pond_filter_id)

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
        q = AquacultureExpense.objects.filter(
            company_id=cid,
            pond_id=pond_id,
            expense_date__gte=start,
            expense_date__lte=end,
        )
        if cycle_filter_id is not None:
            q = q.filter(production_cycle_id=cycle_filter_id)
        return q

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

    for pond in ponds_qs:
        exp_direct = _money_q(_dexp_q(pond.id).aggregate(t=Sum("amount"))["t"] or Decimal("0"))
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
        exp_total = _money_q(exp_direct + exp_shared + t_in - t_out + wo)
        rev = _money_q(_rev_q(pond.id).aggregate(t=Sum("total_amount"))["t"] or Decimal("0"))
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

        rev_by_type: list[dict] = []
        rq = _rev_q(pond.id)
        for code, lbl in AQUACULTURE_INCOME_TYPE_CHOICES:
            tq = _money_q(rq.filter(income_type=code).aggregate(t=Sum("total_amount"))["t"] or Decimal("0"))
            if tq != 0:
                rev_by_type.append({"income_type": code, "label": lbl, "amount": str(tq)})

        rows.append(
            {
                "pond_id": pond.id,
                "pond_name": pond.name,
                "revenue": str(rev),
                "revenue_by_income_type": rev_by_type,
                "direct_operating_expenses": str(exp_direct),
                "shared_operating_expenses": str(exp_shared),
                "fish_transfer_cost_in": str(t_in),
                "fish_transfer_cost_out": str(t_out),
                "biological_write_offs": str(wo),
                "operating_expenses": str(exp_total),
                "payroll_allocated": str(pay),
                "total_costs": str(_money_q(exp_total + pay)),
                "profit": str(profit),
                "cost_per_kg": build_pond_cost_per_kg_block(
                    company_id=cid,
                    pond_id=pond.id,
                    pond_name=pond.name,
                    start=start,
                    end=end,
                    cycle_filter_id=cycle_filter_id,
                    operating_expenses_total=exp_total,
                    payroll_allocated=pay,
                    total_costs=_money_q(exp_total + pay),
                    shared_expenses=shared_expenses,
                    transfer_in=t_in,
                    transfer_out=t_out,
                    biological_writeoff=wo,
                ),
            }
        )
        total_rev += rev
        total_exp += exp_total
        total_pay += pay

    total_profit = _money_q(total_rev - total_exp - total_pay)

    by_cat_dec: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    if pond_filter_id is None:
        for row in (
            AquacultureExpense.objects.filter(
                company_id=cid,
                pond_id__isnull=False,
                expense_date__gte=start,
                expense_date__lte=end,
            )
            .values("expense_category")
            .annotate(s=Sum("amount"))
        ):
            by_cat_dec[row["expense_category"]] += _money_q(row["s"] or Decimal("0"))
        for e in shared_expenses:
            by_cat_dec[e.expense_category] += _money_q(e.amount)
    elif cycle_filter_id is not None:
        for row in _dexp_q(pond_filter_id).values("expense_category").annotate(s=Sum("amount")):
            by_cat_dec[row["expense_category"]] += _money_q(row["s"] or Decimal("0"))
    else:
        for row in (
            AquacultureExpense.objects.filter(
                company_id=cid,
                pond_id=pond_filter_id,
                expense_date__gte=start,
                expense_date__lte=end,
            )
            .values("expense_category")
            .annotate(s=Sum("amount"))
        ):
            by_cat_dec[row["expense_category"]] += _money_q(row["s"] or Decimal("0"))
        for e in shared_expenses:
            for sh in e.pond_shares.filter(pond_id=pond_filter_id):
                by_cat_dec[e.expense_category] += _money_q(sh.amount)

    expenses_by_pond = []
    for pond in ponds_qs:
        by_cat_pond_dec: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
        for row in _dexp_q(pond.id).values("expense_category").annotate(s=Sum("amount")):
            by_cat_pond_dec[row["expense_category"]] += _money_q(row["s"] or Decimal("0"))
        if cycle_filter_id is None:
            for e in shared_expenses:
                for sh in e.pond_shares.filter(pond_id=pond.id):
                    by_cat_pond_dec[e.expense_category] += _money_q(sh.amount)
        expenses_by_pond.append(
            {
                "pond_id": pond.id,
                "pond_name": pond.name,
                "categories": [
                    {
                        "category": c,
                        "label": EXPENSE_CATEGORY_LABELS.get(c, c),
                        "amount": str(by_cat_pond_dec.get(c, Decimal("0"))),
                    }
                    for c, _ in AQUACULTURE_EXPENSE_CATEGORY_CHOICES
                    if by_cat_pond_dec.get(c, Decimal("0")) != 0
                ],
            }
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
                cexp = _money_q(
                    AquacultureExpense.objects.filter(
                        company_id=cid,
                        pond_id=pond.id,
                        production_cycle_id=c.id,
                        expense_date__gte=start,
                        expense_date__lte=end,
                    ).aggregate(t=Sum("amount"))["t"]
                    or Decimal("0")
                )
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
            uexp = _money_q(
                AquacultureExpense.objects.filter(
                    company_id=cid,
                    pond_id=pond.id,
                    production_cycle__isnull=True,
                    expense_date__gte=start,
                    expense_date__lte=end,
                ).aggregate(t=Sum("amount"))["t"]
                or Decimal("0")
            )
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
        "ponds": rows,
        "expenses_by_pond": expenses_by_pond,
        "expenses_by_category": [
            {
                "category": c,
                "label": EXPENSE_CATEGORY_LABELS.get(c, c),
                "amount": str(by_cat_dec.get(c, Decimal("0"))),
            }
            for c, _ in AQUACULTURE_EXPENSE_CATEGORY_CHOICES
            if by_cat_dec.get(c, Decimal("0")) != 0
        ],
        "totals": {
            "revenue": str(_money_q(total_rev)),
            "operating_expenses": str(_money_q(total_exp)),
            "payroll_allocated": str(_money_q(total_pay)),
            "total_costs": str(_money_q(total_exp + total_pay)),
            "profit": str(total_profit),
        },
    }
    if include_cycle_breakdown:
        payload["pond_cycle_segments"] = cycle_segments
    return payload
