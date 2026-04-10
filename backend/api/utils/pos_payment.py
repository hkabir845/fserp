"""
POS payment method normalization (cashier fuel + general POS).

Industry terms for selling without immediate tender:
  - On account / charge sale / house account / open invoice / accounts receivable (A/R).

API clients may send synonyms; we store a single canonical value on Invoice.payment_method.
"""
from __future__ import annotations

# Aliases accepted from JSON (case-insensitive; hyphens normalized to underscores).
_ON_ACCOUNT_ALIASES = frozenset(
    {
        "on_account",
        "onaccount",
        "charge",
        "charge_to_account",
        "house_account",
        "account",
        "ar",
        "a_r",
        "credit_sale",
        "acc_receivable",
        "accounts_receivable",
        "receivable",
    }
)

# Stored on invoice and sent to GL helpers (max 32 chars in DB).
CANONICAL_ON_ACCOUNT = "on_account"


def normalize_pos_payment_method(raw: str | None) -> str:
    """Return canonical payment_method string (lowercase, <= 32 chars)."""
    s = (raw or "cash").strip().lower().replace("-", "_")
    if not s:
        s = "cash"
    if s in _ON_ACCOUNT_ALIASES:
        return CANONICAL_ON_ACCOUNT
    return s[:32]


def is_on_account_payment(payment_method: str | None) -> bool:
    return normalize_pos_payment_method(payment_method) == CANONICAL_ON_ACCOUNT
