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
