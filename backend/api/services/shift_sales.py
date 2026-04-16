"""Link POS invoices to shift sessions and roll up cash / sales totals."""
from __future__ import annotations

from decimal import Decimal

from django.db.models import F

from api.models import ShiftSession


def record_invoice_on_shift(
    company_id: int,
    shift_session_id: int | None,
    invoice_total: Decimal,
    payment_method: str,
    *,
    cash_tender_amount: Decimal | None = None,
) -> None:
    """
    Roll shift totals. For split tender (cash + A/R), pass cash_tender_amount so expected_cash
    only includes the immediate cash portion; invoice_total is still the full sale.
    """
    if not shift_session_id:
        return
    pm = (payment_method or "").strip().lower()
    updates: dict = {
        "total_sales_amount": F("total_sales_amount") + invoice_total,
        "sale_transaction_count": F("sale_transaction_count") + 1,
    }
    if pm == "cash":
        cash_part = (
            cash_tender_amount
            if cash_tender_amount is not None
            else invoice_total
        )
        if cash_part and cash_part > 0:
            updates["expected_cash_total"] = F("expected_cash_total") + cash_part
    ShiftSession.objects.filter(
        id=shift_session_id,
        company_id=company_id,
        closed_at__isnull=True,
    ).update(**updates)


def record_ar_collection_on_shift(
    company_id: int,
    shift_session_id: int | None,
    amount: Decimal,
    payment_method: str,
) -> None:
    """
    When a cashier collects on open A/R at the register, add **cash** to expected drawer
    (same basis as POS cash sales). Card/transfer/mobile do not increase expected_cash_total.
    """
    if not shift_session_id or amount is None or amount <= 0:
        return
    pm = (payment_method or "").strip().lower()
    if pm != "cash":
        return
    ShiftSession.objects.filter(
        id=shift_session_id,
        company_id=company_id,
        closed_at__isnull=True,
    ).update(expected_cash_total=F("expected_cash_total") + amount)
