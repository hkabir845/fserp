"""
Unified delete/edit rollback for documents that post GL, stock, or subledgers.

Pattern: rollback side effects → apply new data → sync posting (or block when shared downstream
records would be corrupted).
"""
from __future__ import annotations

from typing import Any

from api.models import Bill, Invoice, PaymentInvoiceAllocation
from api.services.gl_posting import (
    cleanup_vendor_bill_posting_effects,
    rollback_invoice_posting_effects,
    sync_invoice_gl,
    sync_posted_vendor_bill,
)
from api.services.payment_allocation import refresh_invoice_from_allocations


def assert_invoice_change_allowed(company_id: int, invoice_id: int) -> tuple[bool, str]:
    """Block invoice edit/delete when linked receipts cannot be rolled back safely."""
    alloc_rows = PaymentInvoiceAllocation.objects.filter(
        invoice_id=invoice_id, payment__company_id=company_id
    ).select_related("payment")
    pay_by_id = {a.payment_id: a.payment for a in alloc_rows}
    for p in pay_by_id.values():
        if getattr(p, "bank_deposit_id", None):
            return (
                False,
                "Cannot change this invoice: a linked customer receipt was included in a bank deposit. "
                "Remove that receipt from the deposit first.",
            )
        other = PaymentInvoiceAllocation.objects.filter(payment_id=p.id).exclude(
            invoice_id=invoice_id
        )
        if other.exists():
            return (
                False,
                "Cannot change this invoice while customer payments are applied to other invoices. "
                "Remove or reallocate those payments in Payments first.",
            )
    return True, ""


def reconcile_invoice_after_material_edit(
    company_id: int,
    inv: Invoice,
    *,
    old_status: str | None = None,
    payment_method: str = "cash",
    bank_account_id: int | None = None,
) -> tuple[bool, str]:
    """Rollback AUTO-INV-* / stock / shift (not payments), then re-post from current invoice rows."""
    ok, err = assert_invoice_change_allowed(company_id, int(inv.id))
    if not ok:
        return False, err
    ok_rb, err_rb = rollback_invoice_posting_effects(
        company_id, inv, purge_linked_payments=False
    )
    if not ok_rb:
        return False, err_rb
    inv.refresh_from_db()
    sync_invoice_gl(
        company_id,
        inv,
        old_status=old_status,
        payment_method=payment_method,
        bank_account_id=bank_account_id,
    )
    if PaymentInvoiceAllocation.objects.filter(
        invoice_id=inv.id, payment__company_id=company_id
    ).exists():
        refresh_invoice_from_allocations(inv, company_id)
    return True, ""


def reconcile_bill_after_material_edit(
    company_id: int,
    bill: Bill,
    *,
    acknowledge_tank_overfill: bool = False,
) -> None:
    """Rollback AUTO-BILL / stock / vendor A/P bump, then re-post from current bill lines."""
    cleanup_vendor_bill_posting_effects(company_id, bill)
    bill.refresh_from_db()
    if bill.status not in ("draft", "cancelled"):
        sync_posted_vendor_bill(
            company_id,
            bill,
            acknowledge_tank_overfill=acknowledge_tank_overfill,
        )


INVOICE_MATERIAL_BODY_KEYS = frozenset(
    {
        "invoice_date",
        "due_date",
        "subtotal",
        "tax_total",
        "total",
        "status",
        "payment_method",
        "shift_session_id",
        "station_id",
        "station",
        "lines",
        "line_items",
        "customer_id",
        "bank_account_id",
    }
)


def body_has_material_invoice_change(body: dict[str, Any]) -> bool:
    return any(k in body for k in INVOICE_MATERIAL_BODY_KEYS)


BILL_MATERIAL_BODY_KEYS = frozenset(
    {
        "bill_date",
        "due_date",
        "vendor_id",
        "status",
        "tax_amount",
        "tax_total",
        "lines",
        "receipt_station_id",
    }
)


def body_has_material_bill_change(body: dict[str, Any], *, lines_changed: bool) -> bool:
    if lines_changed:
        return True
    return any(k in body for k in BILL_MATERIAL_BODY_KEYS)
