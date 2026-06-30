"""Half-up rounding for physical measuring units (kg, L, sacks, decimals of land, etc.)."""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

MEASURED_QUANTITY_QUANTUM = Decimal("0.01")


def quantize_measured_quantity(d: Decimal | None) -> Decimal | None:
    if d is None:
        return None
    return d.quantize(MEASURED_QUANTITY_QUANTUM, rounding=ROUND_HALF_UP)


def format_measured_quantity_for_api(d: Decimal | None) -> str | None:
    """Stable JSON string with exactly two digits after the decimal point."""
    q = quantize_measured_quantity(d)
    if q is None:
        return None
    return f"{q:.2f}"


# Back-compat aliases used by aquaculture pond area / depth formatters
quantize_two_decimal_places = quantize_measured_quantity
format_two_decimal_places_for_api = format_measured_quantity_for_api
