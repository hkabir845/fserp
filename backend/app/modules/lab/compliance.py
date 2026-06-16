"""Evaluate numeric results against optional lower/upper bounds (inclusive)."""
from __future__ import annotations

from decimal import Decimal
from typing import Optional, Tuple


def evaluate_compliance(
    value: Decimal,
    lower: Optional[Decimal],
    upper: Optional[Decimal],
) -> Optional[bool]:
    """Returns True/False compliant, or None if no bounds to judge."""
    if lower is None and upper is None:
        return None
    if lower is not None and value < lower:
        return False
    if upper is not None and value > upper:
        return False
    return True
