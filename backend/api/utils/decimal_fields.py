"""Helpers for values stored in Django DecimalField columns."""
from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP


def fit_decimal(value: Decimal, max_digits: int, decimal_places: int) -> Decimal:
    """Quantize and clamp so a value fits DecimalField(max_digits, decimal_places).

    Half away from zero, matching api.utils.rounding — the Decimal default (half-even)
    would round the same amount differently here than everywhere else.
    """
    q = Decimal(10) ** -decimal_places
    try:
        v = value.quantize(q, rounding=ROUND_HALF_UP)
    except InvalidOperation:
        return Decimal("0").quantize(q, rounding=ROUND_HALF_UP)
    max_abs = Decimal(10) ** (max_digits - decimal_places) - q
    if v > max_abs:
        return max_abs
    if v < -max_abs:
        return -max_abs
    return v
