"""Business line (revolving limit): quarterly interest-only schedule preview.

Real facilities usually accrue interest on each day's drawn balance and bill quarterly;
this preview uses **constant current outstanding** over **actual calendar-quarter day counts**
as an indicative total for each quarter (same simple-interest basis as accrual-from-days).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from api.services.loan_interest_basis import simple_interest_for_days


def _q2(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _year_quarter(d: date) -> tuple[int, int]:
    return d.year, (d.month - 1) // 3 + 1


def _add_quarters(year: int, quarter: int, offset: int) -> tuple[int, int]:
    """quarter in 1..4; returns (year, quarter) after offset quarters."""
    base = year * 4 + (quarter - 1) + offset
    return base // 4, (base % 4) + 1


def _quarter_bounds(year: int, quarter: int) -> tuple[date, date]:
    start_month = {1: 1, 2: 4, 3: 7, 4: 10}[quarter]
    end_month, end_day = {1: (3, 31), 2: (6, 30), 3: (9, 30), 4: (12, 31)}[quarter]
    return date(year, start_month, 1), date(year, end_month, end_day)


def quarterly_interest_schedule_rows(
    outstanding: Decimal,
    annual_rate_percent: Decimal,
    basis_key: str,
    as_of: date,
    num_quarters: int,
) -> list[dict[str, Any]]:
    """
    One row per **calendar quarter**: interest-only on ``outstanding`` for actual days in that quarter.
    Principal column is always zero; balance unchanged in the preview.
    """
    if outstanding <= Decimal("0") or num_quarters <= 0:
        return []
    y, q = _year_quarter(as_of)
    rows: list[dict[str, Any]] = []
    for i in range(num_quarters):
        yy, qq = _add_quarters(y, q, i)
        start, end = _quarter_bounds(yy, qq)
        days = (end - start).days + 1
        intr = _q2(simple_interest_for_days(outstanding, annual_rate_percent, days, basis_key))
        label = f"{yy} Q{qq}"
        rows.append(
            {
                "period": i + 1,
                "period_label": label,
                "period_start": start.isoformat(),
                "period_end": end.isoformat(),
                "days_in_period": days,
                "payment": str(intr),
                "principal": "0.00",
                "interest": str(intr),
                "closing_balance": str(_q2(outstanding)),
            }
        )
    return rows
