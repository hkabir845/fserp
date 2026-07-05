"""
P&L aggregation helpers for AquacultureExpense rows.

Pond-tagged COGS is also captured in vendor_bill_pond_operating_total via AUTO-AQ-POND-* and
AUTO-AQ-SHOP-* journals. Summing raw expense.amount for those rows double-counts operating cost.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db.models import Exists, OuterRef, Q, QuerySet, Sum

from api.models import AquacultureExpense, AquacultureExpenseInventoryLine
from api.services.aquaculture_pond_stock_service import POND_WAREHOUSE_CONSUMPTION_CATEGORIES

# Shop/bill feed & medicine purchases roll into consumption keys for P&L and cost buckets.
PL_CONSUMPTION_ROLLUP: tuple[tuple[str, str], ...] = (
    ("feed_purchase", "feed_consumed"),
    ("medicine_purchase", "medicine_consumed"),
)


def _money_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"))


def pond_category_expense_sum(
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


def pond_consumption_amounts_by_category(
    *,
    company_id: int,
    pond_id: int,
    start: date,
    end: date,
    cycle_filter_id: int | None,
) -> dict[str, Decimal]:
    """
    Feed/medicine consumption for one pond: pond-warehouse use plus shop stock issues
    (feed_purchase / medicine_purchase rolled into feed_consumed / medicine_consumed).
    """
    out: dict[str, Decimal] = {}
    out["feed_consumed"] = pond_category_expense_sum(
        company_id, pond_id, "feed_consumed", start, end, cycle_filter_id
    )
    out["medicine_consumed"] = pond_category_expense_sum(
        company_id, pond_id, "medicine_consumed", start, end, cycle_filter_id
    )
    shop_by_cat = pond_shop_stock_issue_amounts_by_category(
        company_id=company_id,
        pond_id=pond_id,
        start=start,
        end=end,
        cycle_filter_id=cycle_filter_id,
    )
    for code, amt in shop_by_cat.items():
        rolled = False
        for src, dest in PL_CONSUMPTION_ROLLUP:
            if code == src:
                out[dest] = _money_q(out.get(dest, Decimal("0")) + _money_q(amt))
                rolled = True
                break
        if not rolled:
            out[code] = _money_q(out.get(code, Decimal("0")) + _money_q(amt))
    return out


def aquaculture_expenses_for_pl_direct_sum(qs: QuerySet[AquacultureExpense]) -> QuerySet[AquacultureExpense]:
    """
    Expense rows whose amount should count toward pond direct operating expenses in P&L.

    Excludes:
    - feed_consumed / medicine_consumed (always mirrored by AUTO-AQ-POND-{id}-COGS journals)
    - shop stock issues with inventory lines (mirrored by AUTO-AQ-SHOP-{id}-COGS journals)
    """
    shop_issue = AquacultureExpenseInventoryLine.objects.filter(
        expense_id=OuterRef("pk"),
        source_station_id__isnull=False,
    )
    return qs.exclude(expense_category__in=POND_WAREHOUSE_CONSUMPTION_CATEGORIES).exclude(
        Exists(shop_issue)
    ).exclude(source_station_id__isnull=False)


def pond_shop_stock_issue_amounts_by_category(
    *,
    company_id: int,
    pond_id: int,
    start: date,
    end: date,
    cycle_filter_id: int | None,
) -> dict[str, Decimal]:
    """Shop stock issued to a pond — attributed by expense_category (feed, medicine, supplies, …)."""
    qs = AquacultureExpense.objects.filter(
        company_id=company_id,
        pond_id=pond_id,
        expense_date__gte=start,
        expense_date__lte=end,
    ).filter(
        Q(inventory_lines__source_station_id__isnull=False)
        | Q(source_station_id__isnull=False)
    ).distinct()
    if cycle_filter_id is not None:
        qs = qs.filter(production_cycle_id=cycle_filter_id)
    out: dict[str, Decimal] = {}
    for row in qs.values("expense_category").annotate(t=Sum("amount")):
        code = str(row["expense_category"] or "")
        if not code:
            continue
        out[code] = Decimal(str(row["t"] or 0)).quantize(Decimal("0.01"))
    return out
