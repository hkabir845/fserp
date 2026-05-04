"""Loan schedule preview (EMI / amortized). Used by API; does not persist until Phase 2."""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any


def _q2(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def amortized_schedule(
    principal: Decimal,
    annual_rate_percent: Decimal,
    num_payments: int,
    payments_per_year: int = 12,
) -> list[dict[str, Any]]:
    """
    Reducing-balance amortization (standard bank / NBFC EMI on term loans and similar products).

    Monthly rate r = (annual_rate_percent / 100) / payments_per_year.
    Equated instalment: EMI = P × r × (1 + r)^n / ((1 + r)^n − 1).
    Each period, interest = outstanding × r; principal = EMI − interest (last period adjusted).

    This matches the methodology described by major bank term-loan EMI calculators (reducing balance),
    not “flat rate” interest on the original principal for the whole tenor.
    """
    if principal <= 0 or num_payments <= 0:
        return []
    p = principal
    n = num_payments
    m = payments_per_year
    if m <= 0:
        m = 12
    r = (annual_rate_percent / Decimal("100")) / Decimal(m)
    rows: list[dict[str, Any]] = []
    if r == 0:
        pay = _q2(p / Decimal(n))
        bal = p
        for k in range(1, n + 1):
            princ = pay if k < n else bal
            intr = Decimal("0")
            bal = _q2(bal - princ)
            rows.append(
                {
                    "period": k,
                    "payment": _q2(princ),
                    "principal": _q2(princ),
                    "interest": intr,
                    "closing_balance": max(bal, Decimal("0")),
                }
            )
        return rows
    one_plus = (Decimal("1") + r) ** n
    pay = p * r * one_plus / (one_plus - Decimal("1"))
    pay = _q2(pay)
    bal = p
    for k in range(1, n + 1):
        intr = _q2(bal * r)
        princ = _q2(pay - intr) if k < n else bal
        if k == n:
            princ = bal
            pay = _q2(princ + intr)
        bal = _q2(bal - princ)
        rows.append(
            {
                "period": k,
                "payment": pay,
                "principal": princ,
                "interest": intr,
                "closing_balance": max(bal, Decimal("0")),
            }
        )
    return rows
