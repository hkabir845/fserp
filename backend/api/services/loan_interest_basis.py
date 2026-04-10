"""Interest day-count and basis from counterparty role (bank/finance vs others)."""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

from api.models import Loan

_ANNUAL_DAY_COUNT_ROLES = frozenset({"bank", "finance_company"})

# Map legacy / free-text variants to canonical role keys before annual vs monthly check.
_ROLE_ALIASES = {
    "financial_company": "finance_company",
    "financecompany": "finance_company",
    "financing_company": "finance_company",
    "nbfi": "finance_company",
    "non_bank_financial": "finance_company",
}


def _q2(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _to_dec(v) -> Decimal:
    if v is None:
        return Decimal("0")
    return Decimal(str(v))


def counterparty_role_normalized(lo: Loan) -> str:
    c = getattr(lo, "counterparty", None)
    if c is None:
        return "other"
    raw = (c.role_type or "other").strip().lower() or "other"
    raw = raw.replace(" ", "_").replace("-", "_")
    while "__" in raw:
        raw = raw.replace("__", "_")
    return _ROLE_ALIASES.get(raw, raw)


def loan_interest_basis_key(lo: Loan) -> str:
    """
    - zero: no rate or rate <= 0 (zero-interest loans).
    - annual_act_365: bank / finance company — simple interest uses actual/365.
    - monthly_30_360: all other counterparties — 30/360 style (APR * days / 360).
    """
    rate = lo.annual_interest_rate
    if rate is None or _to_dec(rate) <= Decimal("0"):
        return "zero"
    if counterparty_role_normalized(lo) in _ANNUAL_DAY_COUNT_ROLES:
        return "annual_act_365"
    return "monthly_30_360"


def interest_basis_label(basis_key: str) -> str:
    if basis_key == "zero":
        return "Zero interest (0% annual rate)"
    if basis_key == "annual_act_365":
        return "Annual (bank/finance): actual/365 day count"
    return "Monthly (other parties): 30/360 day count"


def simple_interest_for_days(
    outstanding: Decimal,
    annual_rate_percent: Decimal,
    days: int,
    basis_key: str,
) -> Decimal:
    if outstanding <= Decimal("0") or days <= 0:
        return Decimal("0")
    if basis_key == "zero":
        return Decimal("0")
    r = annual_rate_percent / Decimal("100")
    if basis_key == "annual_act_365":
        return _q2(outstanding * r * Decimal(days) / Decimal("365"))
    return _q2(outstanding * r * Decimal(days) / Decimal("360"))
