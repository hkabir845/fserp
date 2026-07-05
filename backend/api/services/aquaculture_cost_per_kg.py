"""
Per-kg pond costing from management P&L inputs (expenses, payroll, transfers, write-offs).

Denominator: harvest-sale kg (fish_harvest_sale), then fallback to biological sale kg if needed.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal

from django.db.models import Q, Sum

from api.models import AquacultureExpense, AquacultureFishSale, JournalEntry, JournalEntryLine


# Journal lines from posted vendor bills: debit accounts in these types count toward pond operating P&L.
_VENDOR_BILL_POND_PL_ACCOUNT_TYPES = frozenset({"expense", "cost_of_goods_sold"})

# Pond-tagged COGS / expense journals (bills, POS shop sales to pond customers, internal shop issues).
_POND_PL_JOURNAL_Q = (
    Q(journal_entry__entry_number__startswith="AUTO-BILL-")
    | (
        Q(journal_entry__entry_number__startswith="AUTO-INV-")
        & Q(journal_entry__entry_number__endswith="-COGS")
    )
    | Q(journal_entry__entry_number__startswith="AUTO-AQ-SHOP-")
    | Q(journal_entry__entry_number__startswith="AUTO-AQ-POND-")
)


def vendor_bill_pond_expense_lines_qs(
    *,
    company_id: int,
    pond_id: int | None,
    start: date,
    end: date,
    cycle_filter_id: int | None,
    uncycled_bill_lines_only: bool = False,
):
    """
    Journal debits with aquaculture pond tagging: vendor bills, POS COGS to pond customers,
    and internal shop/pond stock issues.
    When pond_id is None, includes all ponds (company-wide).
    uncycled_bill_lines_only: only lines with no production cycle on the journal line
    (for "no cycle" pond segments).
    """
    q = JournalEntryLine.objects.filter(
        journal_entry__company_id=company_id,
        journal_entry__entry_date__gte=start,
        journal_entry__entry_date__lte=end,
        debit__gt=0,
        account__account_type__in=_VENDOR_BILL_POND_PL_ACCOUNT_TYPES,
        aquaculture_pond_id__isnull=False,
    ).filter(_POND_PL_JOURNAL_Q)
    if pond_id is not None:
        q = q.filter(aquaculture_pond_id=pond_id)
    if uncycled_bill_lines_only:
        q = q.filter(aquaculture_production_cycle_id__isnull=True)
    elif cycle_filter_id is not None:
        q = q.filter(aquaculture_production_cycle_id=cycle_filter_id)
    return q


def vendor_bill_pond_operating_total(
    *,
    company_id: int,
    pond_id: int,
    start: date,
    end: date,
    cycle_filter_id: int | None,
    uncycled_bill_lines_only: bool = False,
) -> Decimal:
    t = vendor_bill_pond_expense_lines_qs(
        company_id=company_id,
        pond_id=pond_id,
        start=start,
        end=end,
        cycle_filter_id=cycle_filter_id,
        uncycled_bill_lines_only=uncycled_bill_lines_only,
    ).aggregate(s=Sum("debit"))["s"]
    return _money_q(Decimal(str(t or 0)))


def pond_warehouse_consumption_cogs_journal_total(
    *,
    company_id: int,
    pond_id: int,
    start: date,
    end: date,
    cycle_filter_id: int | None,
) -> Decimal:
    """AUTO-AQ-POND-{expense_id}-COGS debits already included in vendor_bill_pond_operating_total."""
    t = (
        vendor_bill_pond_expense_lines_qs(
            company_id=company_id,
            pond_id=pond_id,
            start=start,
            end=end,
            cycle_filter_id=cycle_filter_id,
        )
        .filter(
            journal_entry__entry_number__startswith="AUTO-AQ-POND-",
            journal_entry__entry_number__endswith="-COGS",
        )
        .aggregate(s=Sum("debit"))["s"]
    )
    return _money_q(Decimal(str(t or 0)))


def vendor_bill_pond_operating_total_company(
    *,
    company_id: int,
    start: date,
    end: date,
) -> Decimal:
    t = vendor_bill_pond_expense_lines_qs(
        company_id=company_id,
        pond_id=None,
        start=start,
        end=end,
        cycle_filter_id=None,
    ).aggregate(s=Sum("debit"))["s"]
    return _money_q(Decimal(str(t or 0)))


def landlord_lease_payment_pond_journal_qs(
    *,
    company_id: int,
    pond_id: int | None,
    start: date,
    end: date,
    cycle_filter_id: int | None,
    uncycled_landlord_lines_only: bool = False,
):
    """
    Journal debits from AUTO-LL-PAY-* (landlord ledger payment with bank register).
    Tagged with aquaculture_cost_bucket=lease and pond on the expense line.
    """
    q = JournalEntryLine.objects.filter(
        journal_entry__company_id=company_id,
        journal_entry__entry_date__gte=start,
        journal_entry__entry_date__lte=end,
        journal_entry__entry_number__startswith="AUTO-LL-PAY-",
        debit__gt=0,
        account__account_type__in=_VENDOR_BILL_POND_PL_ACCOUNT_TYPES,
        aquaculture_pond_id__isnull=False,
        aquaculture_cost_bucket="lease",
    )
    if pond_id is not None:
        q = q.filter(aquaculture_pond_id=pond_id)
    if uncycled_landlord_lines_only:
        q = q.filter(aquaculture_production_cycle_id__isnull=True)
    elif cycle_filter_id is not None:
        q = q.filter(aquaculture_production_cycle_id=cycle_filter_id)
    return q


def landlord_lease_payment_pond_operating_total(
    *,
    company_id: int,
    pond_id: int,
    start: date,
    end: date,
    cycle_filter_id: int | None,
    uncycled_landlord_lines_only: bool = False,
) -> Decimal:
    t = landlord_lease_payment_pond_journal_qs(
        company_id=company_id,
        pond_id=pond_id,
        start=start,
        end=end,
        cycle_filter_id=cycle_filter_id,
        uncycled_landlord_lines_only=uncycled_landlord_lines_only,
    ).aggregate(s=Sum("debit"))["s"]
    return _money_q(Decimal(str(t or 0)))


def landlord_lease_payment_pond_operating_total_company(
    *,
    company_id: int,
    start: date,
    end: date,
) -> Decimal:
    t = landlord_lease_payment_pond_journal_qs(
        company_id=company_id,
        pond_id=None,
        start=start,
        end=end,
        cycle_filter_id=None,
    ).aggregate(s=Sum("debit"))["s"]
    return _money_q(Decimal(str(t or 0)))


def fry_stocking_capitalized_manual_expense_ids(company_id: int) -> set[int]:
    """Manual pond expenses capitalized Dr 1581 (AUTO-AQ-EXP) — exclude from expense-bucket double count."""
    nums = (
        JournalEntry.objects.filter(
            company_id=company_id,
            is_posted=True,
            entry_number__startswith="AUTO-AQ-EXP-",
            lines__account__account_code="1581",
            lines__aquaculture_cost_bucket="fry_stocking",
        )
        .values_list("entry_number", flat=True)
        .distinct()
    )
    out: set[int] = set()
    for en in nums:
        suffix = str(en).rsplit("-", 1)[-1]
        if suffix.isdigit():
            out.add(int(suffix))
    return out


def pond_fry_stocking_capitalized_journal_total(
    *,
    company_id: int,
    pond_id: int,
    start: date,
    end: date,
    cycle_filter_id: int | None,
) -> Decimal:
    """
    Fry/fingerling purchases post Dr 1581 (vendor bills and manual fry expenses).
    Include in fry_stocking bucket so inter-pond transfer cost moves fry purchase value with the fish.
    """
    from django.db.models import Q

    fry_start = start
    if cycle_filter_id is not None:
        # Fry is usually purchased before or at batch start; include YTD fry bills for cycle-scoped transfers.
        fry_start = date(start.year, 1, 1)

    q1581 = JournalEntryLine.objects.filter(
        journal_entry__company_id=company_id,
        journal_entry__entry_date__gte=fry_start,
        journal_entry__entry_date__lte=end,
        journal_entry__is_posted=True,
        debit__gt=0,
        account__account_code="1581",
        aquaculture_pond_id=pond_id,
    ).filter(
        Q(
            journal_entry__entry_number__startswith="AUTO-BILL-",
            aquaculture_cost_bucket="fry_stocking",
        )
        | Q(
            journal_entry__entry_number__startswith="AUTO-AQ-EXP-",
            aquaculture_cost_bucket="fry_stocking",
        )
    )
    if cycle_filter_id is not None:
        q1581 = q1581.filter(
            Q(aquaculture_production_cycle_id=cycle_filter_id)
            | Q(aquaculture_production_cycle_id__isnull=True)
        )
    s1581 = q1581.aggregate(s=Sum("debit"))["s"]

    # Legacy expense-mode fry bills posted to 6715 before unified 1581 routing.
    q6715 = JournalEntryLine.objects.filter(
        journal_entry__company_id=company_id,
        journal_entry__entry_date__gte=fry_start,
        journal_entry__entry_date__lte=end,
        journal_entry__is_posted=True,
        debit__gt=0,
        account__account_code="6715",
        aquaculture_pond_id=pond_id,
        aquaculture_cost_bucket="fry_stocking",
        journal_entry__entry_number__startswith="AUTO-BILL-",
    )
    if cycle_filter_id is not None:
        q6715 = q6715.filter(
            Q(aquaculture_production_cycle_id=cycle_filter_id)
            | Q(aquaculture_production_cycle_id__isnull=True)
        )
    s6715 = q6715.aggregate(s=Sum("debit"))["s"]

    total = Decimal(str(s1581 or 0)) + Decimal(str(s6715 or 0))
    return _money_q(total)


def vendor_bill_pond_bucket_additions(
    *,
    company_id: int,
    pond_id: int,
    start: date,
    end: date,
    cycle_filter_id: int | None,
    uncycled_bill_lines_only: bool = False,
) -> dict[str, Decimal]:
    out: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    qs = vendor_bill_pond_expense_lines_qs(
        company_id=company_id,
        pond_id=pond_id,
        start=start,
        end=end,
        cycle_filter_id=cycle_filter_id,
        uncycled_bill_lines_only=uncycled_bill_lines_only,
    )
    for row in qs.values("aquaculture_cost_bucket").annotate(s=Sum("debit")):
        b = (row["aquaculture_cost_bucket"] or "").strip() or "ancillary"
        out[b] += _money_q(Decimal(str(row["s"] or 0)))
    return dict(out)


def aquaculture_expense_category_to_cost_bucket(category: str, company_id: int | None = None) -> str:
    """Maps AquacultureExpense.expense_category to a stable cost-bucket code (P&L + journal tagging)."""
    c = (category or "").strip()
    if company_id is not None:
        from api.services.tenant_reporting_categories import resolve_aquaculture_expense_to_builtin

        c = resolve_aquaculture_expense_to_builtin(company_id, c)
    if c == "fry_stocking":
        return "fry_stocking"
    if c in ("pond_preparation", "soilcut"):
        return "pond_preparation"
    if c in ("feed_purchase", "feed_consumed", "feed_medicine"):
        return "feed"
    if c in ("medicine_purchase", "medicine_consumed"):
        return "medicine"
    if c == "vendor_bill_pond":
        return "miscellaneous"
    if c == "worker_salary":
        return "labor"
    if c == "electricity":
        return "electricity"
    if c == "generator_fuel":
        return "electricity"
    if c == "water":
        return "miscellaneous"
    if c == "equipment":
        return "equipment"
    if c == "depreciation":
        return "equipment"
    if c == "repair_maintenance":
        return "repair_maintenance"
    if c == "lease":
        return "lease"
    if c == "transportation":
        return "transportation"
    if c == "fish_haul_supplies":
        return "transportation"
    if c == "office_supplies":
        return "shop_supplies"
    if c == "meals_entertainment":
        return "miscellaneous"
    if c == "pond_care_products":
        return "medicine"
    if c == "sampling_lab":
        return "medicine"
    if c in (
        "security",
        "predator_control",
        "insurance",
        "bank_charges",
        "licenses_permits",
        "professional_fees",
        "communication",
    ):
        return "miscellaneous"
    if c == "netting_gear":
        return "shop_supplies"
    if c == "fisherman":
        return "fisherman"
    if c == "day_labor":
        return "day_labor"
    if c == "shop_supplies":
        return "shop_supplies"
    if c == "mortality":
        return "biological_writeoff"
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
    "equipment": "Equipment (aerators, nets, tools, and similar purchases)",
    "repair_maintenance": "Repair & maintenance (structures, pumps, vehicles, site upkeep)",
    "lease": "Lease / pond rental",
    "transportation": "Transportation",
    "fisherman": "Harvesting / fisherman charges",
    "day_labor": "Day & contract labor (vendor bills, not payroll)",
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
        b = aquaculture_expense_category_to_cost_bucket(category, company_id=company_id)
        out[b] += _money_q(amount)

    from api.services.aquaculture_pl_expense_sum import aquaculture_expenses_for_pl_direct_sum

    q = AquacultureExpense.objects.filter(
        company_id=company_id,
        pond_id=pond_id,
        expense_date__gte=start,
        expense_date__lte=end,
    )
    if cycle_filter_id is not None:
        q = q.filter(production_cycle_id=cycle_filter_id)
    q = aquaculture_expenses_for_pl_direct_sum(q)
    capitalized_fry_ids = fry_stocking_capitalized_manual_expense_ids(company_id)
    for row in (
        q.exclude(pk__in=capitalized_fry_ids)
        .values("expense_category")
        .annotate(s=Sum("amount"))
    ):
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

    for bkey, bamt in vendor_bill_pond_bucket_additions(
        company_id=company_id,
        pond_id=pond_id,
        start=start,
        end=end,
        cycle_filter_id=cycle_filter_id,
    ).items():
        if bkey == "fry_stocking":
            # Fry vendor bills are included via pond_fry_stocking_capitalized_journal_total (1581 + legacy 6715).
            continue
        if bamt != 0:
            out[bkey] += bamt

    ll_lease = landlord_lease_payment_pond_operating_total(
        company_id=company_id,
        pond_id=pond_id,
        start=start,
        end=end,
        cycle_filter_id=cycle_filter_id,
    )
    if ll_lease != 0:
        out["lease"] += ll_lease

    fry_cap = pond_fry_stocking_capitalized_journal_total(
        company_id=company_id,
        pond_id=pond_id,
        start=start,
        end=end,
        cycle_filter_id=cycle_filter_id,
    )
    if fry_cap != 0:
        out["fry_stocking"] += fry_cap

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
        "repair_maintenance",
        "lease",
        "transportation",
        "fisherman",
        "day_labor",
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

    from api.services.aquaculture_transfer_cost import (
        _biological_production_cost_total,
        _transfer_denominator_kg,
    )

    bio_total = _biological_production_cost_total(lines)
    transfer_denom, transfer_denom_note = _transfer_denominator_kg(
        company_id=company_id,
        pond_id=pond_id,
        cycle_filter_id=cycle_filter_id,
        cpk={
            "denominator_kg": str(denom_kg),
            "weight_basis": basis,
        },
        line_weight_kg=None,
    )
    transfer_cost_per_kg: str | None = None
    transfer_cost_basis_note: str | None = None
    if bio_total > 0 and transfer_denom > 0:
        transfer_cost_per_kg = str(_money_q(bio_total / transfer_denom))
        transfer_cost_basis_note = (
            f"Inter-pond transfer uses production costs (fry, feed, medicine, preparation) "
            f"÷ {transfer_denom} kg ({transfer_denom_note}). "
            "Shop supplies and overhead are not included."
        )
    elif total_per_kg:
        transfer_cost_per_kg = total_per_kg
        transfer_cost_basis_note = None

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
        "transfer_cost_per_kg": transfer_cost_per_kg,
        "transfer_cost_basis_note": transfer_cost_basis_note,
        "operating_expenses_per_kg": opex_per_kg,
        "payroll_allocated_per_kg": pay_per_kg,
        "costing_lines": lines,
    }


def aquaculture_pl_cost_basis_doc() -> str:
    return (
        "Pond cost per kg: total pond costs (operating expenses including shared allocation, inter-pond transfer "
        "adjustments, biological write-offs, plus payroll allocated to the pond) divided by sale kg. "
        "Expense categories map to buckets (fry, pond preparation, feed, medicine, labor, electricity, equipment, "
        "repair & maintenance, lease, transportation, fisherman, miscellaneous, plus ancillary for unknown codes). "
        "Labor includes worker_salary lines and PayrollRunPondAllocation. "
        "Posted journals can carry aquaculture_pond, production_cycle, and aquaculture_cost_bucket on each line for "
        "traceability (shop issues, biological stock, fish-sale invoices, POS COGS to a pond's linked customer, "
        "and landlord lease payments with bank_account_id on the landlord ledger)."
    )
