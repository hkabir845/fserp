"""
Valid lifecycle statuses for customer invoices and vendor bills.

An accounting document must never be storable in a state the ledger cannot post. Before this
existed, ``status`` was a free-text CharField written straight from the request body, so a typo
("posted" instead of "sent") produced a saved invoice that silently failed every GL attempt:
revenue on the document, nothing in the ledger, and no error until someone read a report.
"""
from __future__ import annotations

# Customer invoice: draft is unposted; sent/partial/overdue sit in A/R; paid settled at once.
INVOICE_STATUSES: tuple[str, ...] = ("draft", "sent", "paid", "partial", "overdue", "void")

# Vendor bill: draft is unposted; open/partial/overdue sit in A/P; paid settled.
BILL_STATUSES: tuple[str, ...] = ("draft", "open", "paid", "partial", "overdue", "void")


def normalize_document_status(raw, allowed: tuple[str, ...], *, field_label: str = "status"):
    """
    Returns ``(status, error_detail)``. A blank value leaves the caller's default in place
    by returning ``(None, None)``.
    """
    if raw is None or str(raw).strip() == "":
        return None, None
    st = str(raw).strip().lower()
    if st not in allowed:
        return None, (
            f"{field_label}: '{st}' is not a valid status. Use one of: {', '.join(allowed)}."
        )
    return st, None

# Invoice statuses that put the balance into Accounts Receivable rather than settling it.
INVOICE_AR_STATUSES: tuple[str, ...] = ("sent", "partial", "overdue")


def walkin_ar_invoice_error(status, customer) -> str | None:
    """
    Reject a receivable invoice raised against the Walk-in customer.

    Walk-in has no A/R subledger by design (see api.services.contact_ledgers), so a credit
    invoice against it debits 1100 in the GL while the customer balances report shows nothing:
    the A/R control account stops reconciling to the customer list. The POS already refuses
    on-account sales to Walk-in; this is the same rule for invoices raised through the API.
    """
    from api.services.gl_posting import _is_walkin_customer

    st = (status or "").strip().lower()
    if st not in INVOICE_AR_STATUSES:
        return None
    if customer is None or not _is_walkin_customer(customer):
        return None
    return (
        "Accounts receivable invoices cannot use the Walk-in customer. "
        "Select a credit / house-account customer, or mark the invoice paid."
    )
