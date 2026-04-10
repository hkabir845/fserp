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
) -> None:
    if not shift_session_id:
        return
    pm = (payment_method or "").strip().lower()
    updates: dict = {
        "total_sales_amount": F("total_sales_amount") + invoice_total,
        "sale_transaction_count": F("sale_transaction_count") + 1,
    }
    if pm == "cash":
        updates["expected_cash_total"] = F("expected_cash_total") + invoice_total
    ShiftSession.objects.filter(
        id=shift_session_id,
        company_id=company_id,
        closed_at__isnull=True,
    ).update(**updates)
