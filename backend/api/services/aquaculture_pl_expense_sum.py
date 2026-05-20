"""
P&L aggregation helpers for AquacultureExpense rows.

Pond-tagged COGS is also captured in vendor_bill_pond_operating_total via AUTO-AQ-POND-* and
AUTO-AQ-SHOP-* journals. Summing raw expense.amount for those rows double-counts operating cost.
"""
from __future__ import annotations

from django.db.models import Exists, OuterRef, QuerySet

from api.models import AquacultureExpense, AquacultureExpenseInventoryLine
from api.services.aquaculture_pond_stock_service import POND_WAREHOUSE_CONSUMPTION_CATEGORIES


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
    )
