"""Vendor bill list filters (site / entity scope)."""
from __future__ import annotations

from django.db.models import Exists, OuterRef, Q, QuerySet

from api.models import Bill, BillLine


def apply_bill_list_entity_scope(
    qs: QuerySet[Bill],
    *,
    station_id: int | None,
    pond_id: int | None,
    head_office: bool,
) -> QuerySet[Bill]:
    """Filter bills by receiving site — station, pond, or head office (no site tags)."""
    if pond_id:
        return qs.filter(lines__aquaculture_pond_id=pond_id).distinct()
    if station_id:
        line_station = BillLine.objects.filter(
            bill_id=OuterRef("pk"),
            receipt_station_id=station_id,
        )
        line_tank_station = BillLine.objects.filter(
            bill_id=OuterRef("pk"),
            tank__station_id=station_id,
        )
        return qs.filter(
            Q(receipt_station_id=station_id)
            | Exists(line_station)
            | Exists(line_tank_station)
        ).distinct()
    if head_office:
        line_pond = BillLine.objects.filter(
            bill_id=OuterRef("pk"),
            aquaculture_pond_id__isnull=False,
        )
        line_station = BillLine.objects.filter(
            bill_id=OuterRef("pk"),
            receipt_station_id__isnull=False,
        )
        line_tank = BillLine.objects.filter(
            bill_id=OuterRef("pk"),
            tank_id__isnull=False,
        )
        line_fuel = BillLine.objects.filter(
            bill_id=OuterRef("pk"),
        ).exclude(fuel_station_expense_category="")
        return qs.filter(
            ~Exists(line_pond),
            ~Exists(line_station),
            ~Exists(line_tank),
            ~Exists(line_fuel),
        )
    return qs
