"""Fixed-rate monthly amortization (actuarial rounding on each line)."""
from __future__ import annotations

import calendar
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Tuple


def _monthly_rate(annual_pct: Decimal) -> Decimal:
    return (annual_pct / Decimal("100")) / Decimal("12")


def monthly_payment(principal: Decimal, annual_pct: Decimal, term_months: int) -> Decimal:
    if term_months <= 0:
        return Decimal("0").quantize(Decimal("0.01"))
    r = _monthly_rate(annual_pct)
    if r == 0:
        return (principal / Decimal(term_months)).quantize(Decimal("0.01"), ROUND_HALF_UP)
    n = Decimal(term_months)
    one_plus = (Decimal("1") + r) ** n
    num = principal * r * one_plus
    den = one_plus - Decimal("1")
    if den == 0:
        return Decimal("0")
    return (num / den).quantize(Decimal("0.01"), ROUND_HALF_UP)


def add_months(dt: datetime, months: int) -> datetime:
    y, m = dt.year, dt.month + months
    while m > 12:
        m -= 12
        y += 1
    while m < 1:
        m += 12
        y -= 1
    last_day = calendar.monthrange(y, m)[1]
    d = min(dt.day, last_day)
    return dt.replace(year=y, month=m, day=d)


def build_schedule_rows(
    principal: Decimal,
    annual_pct: Decimal,
    start_date: datetime,
    term_months: int,
) -> List[Tuple[datetime, Decimal, Decimal, Decimal, Decimal, Decimal]]:
    """
    Returns list of (due_date, opening, principal_due, interest_due, total_due, closing_balance_after).
    """
    pay = monthly_payment(principal, annual_pct, term_months)
    r = _monthly_rate(annual_pct)
    balance = principal
    rows: List[Tuple[datetime, Decimal, Decimal, Decimal, Decimal, Decimal]] = []

    for i in range(1, term_months + 1):
        # First installment due one month after disbursement (common convention)
        due = add_months(start_date, i)
        opening = balance
        interest = (balance * r).quantize(Decimal("0.01"), ROUND_HALF_UP)
        principal_part = (pay - interest).quantize(Decimal("0.01"), ROUND_HALF_UP)

        if i == term_months:
            principal_part = balance.quantize(Decimal("0.01"), ROUND_HALF_UP)
            total = (principal_part + interest).quantize(Decimal("0.01"), ROUND_HALF_UP)
        else:
            total = (principal_part + interest).quantize(Decimal("0.01"), ROUND_HALF_UP)

        new_balance = (balance - principal_part).quantize(Decimal("0.01"), ROUND_HALF_UP)
        if new_balance < 0:
            new_balance = Decimal("0")

        rows.append((due, opening, principal_part, interest, total, new_balance))
        balance = new_balance

    return rows
