"""Vendor bill list filters (site / entity scope)."""
from __future__ import annotations

from django.db.models import Exists, OuterRef, QuerySet

from api.models import Bill, BillLine
from api.services.bill_list_allocations import bill_line_scope_q


def apply_bill_list_entity_scope(
    qs: QuerySet[Bill],
    *,
    station_id: int | None,
    pond_id: int | None,
    head_office: bool,
) -> QuerySet[Bill]:
    """Filter by effective line Charge to, including mixed bills and explicit Head Office."""
    if station_id or pond_id or head_office:
        matching = BillLine.objects.filter(bill_id=OuterRef("pk")).filter(
            bill_line_scope_q(station_id=station_id, pond_id=pond_id, head_office=head_office)
        )
        return qs.filter(Exists(matching))
    return qs
