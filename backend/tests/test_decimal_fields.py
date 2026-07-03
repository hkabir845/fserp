"""Unit tests for decimal field helpers."""
from __future__ import annotations

from decimal import Decimal

from api.utils.decimal_fields import fit_decimal


def test_fit_decimal_clamps_overflow():
    huge = Decimal("999999999999999.99")
    clamped = fit_decimal(huge, max_digits=14, decimal_places=2)
    assert clamped == Decimal("999999999999.99")


def test_fit_decimal_preserves_in_range():
    v = Decimal("1234.5678")
    assert fit_decimal(v, max_digits=14, decimal_places=4) == Decimal("1234.5678")
