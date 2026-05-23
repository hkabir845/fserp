"""Recompute party current_balance from subledger after opening-balance changes."""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

from api.models import Customer, Vendor
from api.services.payment_allocation import compute_customer_balance_due, compute_vendor_balance_due

_MONEY = Decimal("0.01")


def _q(d: Decimal) -> Decimal:
    return d.quantize(_MONEY, rounding=ROUND_HALF_UP)


def refresh_customer_balance(company_id: int, customer_id: int) -> None:
    """Set Customer.current_balance = opening + unpaid invoice balances."""
    bal = _q(compute_customer_balance_due(company_id, customer_id))
    Customer.objects.filter(pk=customer_id, company_id=company_id).update(current_balance=bal)


def refresh_vendor_balance(company_id: int, vendor_id: int) -> None:
    """Set Vendor.current_balance = opening_balance + unpaid bill totals."""
    v = Vendor.objects.filter(pk=vendor_id, company_id=company_id).only("opening_balance").first()
    if not v:
        return
    owed = compute_vendor_balance_due(company_id, vendor_id)
    bal = _q((v.opening_balance or Decimal("0")) + owed)
    Vendor.objects.filter(pk=vendor_id, company_id=company_id).update(current_balance=bal)
