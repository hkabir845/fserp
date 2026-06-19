"""Classify stations for reporting: fuel forecourt vs aquaculture shop hub."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from api.models import Station

KIND_FUEL_STATION = "fuel_station"
KIND_SHOP_HUB = "shop_hub"

KIND_LABELS: dict[str, str] = {
    KIND_FUEL_STATION: "Fuel filling station",
    KIND_SHOP_HUB: "Shop / agro hub (Premium Agro)",
}


def station_business_kind(station) -> str:
    """Return stable kind code for a Station row."""
    if getattr(station, "operates_fuel_retail", True) is False:
        return KIND_SHOP_HUB
    return KIND_FUEL_STATION


def station_business_kind_label(kind: str) -> str:
    return KIND_LABELS.get((kind or "").strip(), kind or "Station")


def station_is_shop_hub(company_id: int, station_id: int | None) -> bool:
    """True when the station is a non-fuel aquaculture shop hub (e.g. Premium Agro)."""
    if not station_id:
        return False
    from api.models import Station

    st = Station.objects.filter(pk=int(station_id), company_id=company_id).first()
    return st is not None and station_business_kind(st) == KIND_SHOP_HUB


def line_receipt_station_id_from_row(row: dict) -> int | None:
    raw = row.get("line_receipt_station_id")
    if raw in (None, ""):
        raw = row.get("receipt_station_id")
    if raw in (None, ""):
        return None
    try:
        sid = int(raw)
    except (TypeError, ValueError):
        return None
    return sid if sid > 0 else None
