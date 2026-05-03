"""
Per-kg pond costing from management P&L inputs (expenses, payroll, transfers, write-offs).

Denominator: harvest-sale kg (fish_harvest_sale), then fallback to biological sale kg if needed.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal

from django.db.models import Sum

from api.models import AquacultureExpense, AquacultureFishSale


def aquaculture_expense_category_to_cost_bucket(category: str) -> str:
    """Maps AquacultureExpense.expense_category to a stable cost-bucket code (P&L + journal tagging)."""
    c = (category or "").strip()
    if c == "fry_stocking":
        return "fry_stocking"
    if c in ("pond_preparation", "soilcut"):
        return "pond_preparation"
    if c == "feed_purchase" or c == "feed_medicine":
        return "feed"
    if c == "medicine_purchase":
        return "medicine"
    if c == "worker_salary":
        return "labor"
    if c == "electricity":
        return "electricity"
    if c == "equipment":
        return "equipment"
    if c == "lease":
        return "lease"
    if c == "transportation":
        return "transportation"
    if c == "fisherman":
        return "fisherman"
    if c == "other":
        return "miscellaneous"
    return "ancillary"


def item_shop_issue_cost_bucket(item) -> str:
    """
    Bucket for inventoried shop goods sold to a pond (invoice COGS), aligned with pond P&L feed/medicine lines.
    """
    if not item:
        return "shop_supplies"
    pc = (getattr(item, "pos_category", None) or "").strip().lower()
    if pc == "feed":
        return "feed"
    cat = (getattr(item, "category", None) or "").strip().lower()
    name = (getattr(item, "name", None) or "").strip().lower()
    blob = f"{cat} {name}"
    if "medicine" in blob or "vaccin" in blob or "veterinar" in blob:
        return "medicine"
    return "shop_supplies"


COST_BUCKET_LABELS: dict[str, str] = {
    "fry_stocking": "Fry / fingerling purchase",
    "pond_preparation": "Pond preparation & soil work",
    "feed": "Feed (pond expenses, shop stock issue, and POS COGS when tagged as feed)",
    "medicine": "Medicine",
    "labor": "Labor (worker salary expenses + payroll allocated to pond)",
    "electricity": "Electricity",
    "equipment": "Equipment (aerators, nets, repairs, etc.)",
    "lease": "Lease / pond rental",
    "transportation": "Transportation",
    "fisherman": "Harvesting / fisherman charges",
    "miscellaneous": "Miscellaneous pond operating (category other)",
    "shop_supplies": "Shop supplies to pond (POS COGS, non-feed / non-medicine inventory)",
    "fish_transfer_in": "Inter-pond transfer — cost in",
    "fish_transfer_out": "Inter-pond transfer — cost out (credit)",
    "biological_writeoff": "Biological write-offs (mortality book value)",
    "ancillary": "Other pond operating costs (uncategorized legacy)",
}


def _money_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"))


def _kg_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.0001"))


def harvest_weight_denominator_kg(
    *,
    company_id: int,
    pond_id: int,
    start: date,
    end: date,
    cycle_filter_id: int | None,
) -> tuple[Decimal, Decimal, str]:
    """
    Returns (primary_harvest_kg, fallback_bio_kg, basis_code).

    basis_code: harvest_sale | bio_sales | none
    """
    base = AquacultureFishSale.objects.filter(
        company_id=company_id,
        pond_id=pond_id,
        sale_date__gte=start,
        sale_date__lte=end,
    )
    if cycle_filter_id is not None:
        base = base.filter(production_cycle_id=cycle_filter_id)

    h = base.filter(income_type="fish_harvest_sale").aggregate(t=Sum("weight_kg"))["t"]
    harvest_kg = _kg_q(Decimal(str(h or 0)))

    bio_types = ("fish_harvest_sale", "fingerling_sale", "processing_value_add")
    b = base.filter(income_type__in=bio_types).aggregate(t=Sum("weight_kg"))["t"]
    bio_kg = _kg_q(Decimal(str(b or 0)))

    if harvest_kg > 0:
        return harvest_kg, bio_kg, "harvest_sale"
    if bio_kg > 0:
        return Decimal("0"), bio_kg, "bio_sales"
    return Decimal("0"), Decimal("0"), "none"


def pond_bucket_amounts_for_period(
    *,
    company_id: int,
    pond_id: int,
    start: date,
    end: date,
    cycle_filter_id: int | None,
    shared_expenses: list,
    transfer_in: Decimal,
    transfer_out: Decimal,
    biological_writeoff: Decimal,
    payroll_allocated: Decimal,
) -> dict[str, Decimal]:
    """Returns positive Decimal amounts per cost bucket (same economic scope as pond P&L row)."""
    out: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))

    def add_from_expense_row(amount: Decimal, category: str) -> None:
        b = aquaculture_expense_category_to_cost_bucket(category)
        out[b] += _money_q(amount)

    q = AquacultureExpense.objects.filter(
        company_id=company_id,
        pond_id=pond_id,
        expense_date__gte=start,
        expense_date__lte=end,
    )
    if cycle_filter_id is not None:
        q = q.filter(production_cycle_id=cycle_filter_id)
    for row in q.values("expense_category").annotate(s=Sum("amount")):
        amt = _money_q(Decimal(str(row["s"] or 0)))
        if amt != 0:
            add_from_expense_row(amt, row["expense_category"])

    if cycle_filter_id is None:
        for e in shared_expenses:
            for sh in e.pond_shares.filter(pond_id=pond_id):
                add_from_expense_row(_money_q(sh.amount), e.expense_category)

    if transfer_in != 0:
        out["fish_transfer_in"] += _money_q(transfer_in)
    if transfer_out != 0:
        out["fish_transfer_out"] += _money_q(transfer_out)
    if biological_writeoff != 0:
        out["biological_writeoff"] += _money_q(biological_writeoff)
    if payroll_allocated != 0:
        out["labor"] += _money_q(payroll_allocated)

    return dict(out)


def build_pond_cost_per_kg_block(
    *,
    company_id: int,
    pond_id: int,
    pond_name: str,
    start: date,
    end: date,
    cycle_filter_id: int | None,
    operating_expenses_total: Decimal,
    payroll_allocated: Decimal,
    total_costs: Decimal,
    shared_expenses: list,
    transfer_in: Decimal,
    transfer_out: Decimal,
    biological_writeoff: Decimal,
) -> dict:
    primary_kg, fallback_kg, basis = harvest_weight_denominator_kg(
        company_id=company_id,
        pond_id=pond_id,
        start=start,
        end=end,
        cycle_filter_id=cycle_filter_id,
    )
    denom_kg = primary_kg if primary_kg > 0 else fallback_kg

    buckets_dec = pond_bucket_amounts_for_period(
        company_id=company_id,
        pond_id=pond_id,
        start=start,
        end=end,
        cycle_filter_id=cycle_filter_id,
        shared_expenses=shared_expenses,
        transfer_in=transfer_in,
        transfer_out=transfer_out,
        biological_writeoff=biological_writeoff,
        payroll_allocated=payroll_allocated,
    )

    display_order = [
        "fry_stocking",
        "pond_preparation",
        "feed",
        "medicine",
        "labor",
        "electricity",
        "equipment",
        "lease",
        "transportation",
        "fisherman",
        "miscellaneous",
        "shop_supplies",
        "fish_transfer_in",
        "fish_transfer_out",
        "biological_writeoff",
        "ancillary",
    ]

    lines: list[dict] = []
    for code in display_order:
        amt = _money_q(buckets_dec.get(code, Decimal("0")))
        if amt == 0:
            continue
        per_kg: str | None
        if denom_kg > 0:
            per_kg = str(_money_q(amt / denom_kg))
        else:
            per_kg = None
        lines.append(
            {
                "cost_bucket": code,
                "label": COST_BUCKET_LABELS.get(code, code),
                "amount": str(amt),
                "cost_per_kg": per_kg,
            }
        )

    total_per_kg = str(_money_q(total_costs / denom_kg)) if denom_kg > 0 else None
    opex_per_kg = str(_money_q(operating_expenses_total / denom_kg)) if denom_kg > 0 else None
    pay_per_kg = str(_money_q(payroll_allocated / denom_kg)) if denom_kg > 0 else None

    if basis == "harvest_sale":
        basis_note = (
            "Per kg uses kg from fish harvest sales (income_type=fish_harvest_sale) in this period and scope."
        )
    elif basis == "bio_sales":
        basis_note = (
            "No fish_harvest_sale kg in scope; per kg uses biological sale kg "
            "(fish_harvest_sale + fingerling_sale + processing_value_add)."
        )
    else:
        basis_note = "No biological sale kg in scope — cost per kg cannot be computed (division by zero)."

    return {
        "pond_id": pond_id,
        "pond_name": pond_name,
        "harvest_weight_kg": str(primary_kg),
        "biological_sale_weight_kg": str(fallback_kg),
        "weight_basis": basis,
        "denominator_kg": str(denom_kg),
        "basis_note": basis_note,
        "total_costs": str(_money_q(total_costs)),
        "total_cost_per_kg": total_per_kg,
        "operating_expenses_per_kg": opex_per_kg,
        "payroll_allocated_per_kg": pay_per_kg,
        "costing_lines": lines,
    }


def aquaculture_pl_cost_basis_doc() -> str:
    return (
        "Pond cost per kg: total pond costs (operating expenses including shared allocation, inter-pond transfer "
        "adjustments, biological write-offs, plus payroll allocated to the pond) divided by sale kg. "
        "Expense categories map to buckets (fry, pond preparation, feed, medicine, labor, electricity, equipment, "
        "lease, transportation, fisherman, miscellaneous, plus ancillary for unknown codes). "
        "Labor includes worker_salary lines and PayrollRunPondAllocation. "
        "Posted journals can carry aquaculture_pond, production_cycle, and aquaculture_cost_bucket on each line for "
        "traceability (shop issues, biological stock, fish-sale invoices, and POS COGS to a pond’s linked customer)."
    )
