"""Recompute party current_balance from subledger after opening-balance changes."""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

from api.models import Customer, Vendor
from api.services.payment_allocation import compute_customer_balance_due, compute_vendor_balance_due

_MONEY = Decimal("0.01")


def _q(d: Decimal) -> Decimal:
    return d.quantize(_MONEY, rounding=ROUND_HALF_UP)


def refresh_customer_balance(company_id: int, customer_id: int) -> None:
    """Set Customer.current_balance = A/R subledger (same as customer ledger all-time closing)."""
    bal = _q(compute_customer_balance_due(company_id, customer_id))
    Customer.objects.filter(pk=customer_id, company_id=company_id).update(current_balance=bal)


def refresh_vendor_balance(company_id: int, vendor_id: int) -> None:
    """Set Vendor.current_balance = A/P subledger (same as vendor ledger all-time closing)."""
    bal = _q(compute_vendor_balance_due(company_id, vendor_id))
    Vendor.objects.filter(pk=vendor_id, company_id=company_id).update(current_balance=bal)
