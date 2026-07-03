"""Helpers for values stored in Django DecimalField columns."""
from __future__ import annotations

from decimal import Decimal, InvalidOperation


def fit_decimal(value: Decimal, max_digits: int, decimal_places: int) -> Decimal:
    """Quantize and clamp so a value fits DecimalField(max_digits, decimal_places)."""
    q = Decimal(10) ** -decimal_places
    try:
        v = value.quantize(q)
    except InvalidOperation:
        return Decimal("0").quantize(q)
    max_abs = Decimal(10) ** (max_digits - decimal_places) - q
    if v > max_abs:
        return max_abs
    if v < -max_abs:
        return -max_abs
    return v
