"""Invoice/bill payment application (subledger + status sync)."""
from __future__ import annotations

from decimal import Decimal
from typing import Optional

from django.db import transaction
from django.db.models import Sum

from api.models import (
    Bill,
    Customer,
    Invoice,
    Payment,
    PaymentBillAllocation,
    PaymentInvoiceAllocation,
    Vendor,
)
from api.services.gl_posting import _is_walkin_customer


def total_allocated_to_invoice(company_id: int, invoice_id: int) -> Decimal:
    s = (
        PaymentInvoiceAllocation.objects.filter(
            invoice_id=invoice_id,
            payment__company_id=company_id,
        ).aggregate(total=Sum("amount"))["total"]
    )
    return s or Decimal("0")


def total_allocated_to_invoice_excluding_payment(
    company_id: int, invoice_id: int, exclude_payment_id: int
) -> Decimal:
    """Allocations to this invoice from other payments only (for editing a payment)."""
    s = (
        PaymentInvoiceAllocation.objects.filter(
            invoice_id=invoice_id,
            payment__company_id=company_id,
        )
        .exclude(payment_id=exclude_payment_id)
        .aggregate(total=Sum("amount"))["total"]
    )
    return s or Decimal("0")


def invoice_balance_due_excluding_payment(
    inv: Invoice, company_id: int, exclude_payment_id: int
) -> Decimal:
    """Open invoice balance if this payment's allocations were removed first."""
    if inv.status == "draft":
        return inv.total or Decimal("0")
    paid = total_allocated_to_invoice_excluding_payment(company_id, inv.id, exclude_payment_id)
    total = inv.total or Decimal("0")
    return max(Decimal("0"), total - paid)


def total_allocated_for_invoice(inv: Invoice, company_id: int) -> Decimal:
    c = getattr(inv, "_prefetched_objects_cache", None)
    if c and "payment_allocations" in c:
        return sum(
            (a.amount for a in inv.payment_allocations.all()),
            start=Decimal("0"),
        )
    return total_allocated_to_invoice(company_id, inv.id)


def invoice_open_amount(inv: Invoice, company_id: int) -> Decimal:
    """Remaining invoice total not covered by payment allocations."""
    if inv.status == "draft":
        return Decimal("0")
    total = inv.total or Decimal("0")
    paid = total_allocated_for_invoice(inv, company_id)
    return max(Decimal("0"), total - paid)


def invoice_balance_due(inv: Invoice, company_id: int) -> Decimal:
    """Same as open amount for non-draft; draft shows full total as not yet invoiced for collection."""
    if inv.status == "draft":
        return inv.total or Decimal("0")
    return invoice_open_amount(inv, company_id)


def customer_uninvoiced_receivable(
    company_id: int,
    customer: Customer,
    *,
    exclude_payment: Optional[Payment] = None,
) -> Decimal:
    """
    A/R represented in customer subledger that is not covered by open invoice lines
    (e.g. opening balance with no bill yet). When editing a receipt, pass exclude_payment so
    the receipt is treated as not yet applied while validating the new split.
    """
    if _is_walkin_customer(customer):
        return Decimal("0")
    a = Decimal("0")
    for inv in Invoice.objects.filter(
        company_id=company_id, customer_id=customer.id
    ).exclude(status="draft"):
        if exclude_payment is not None:
            a += invoice_balance_due_excluding_payment(
                inv, company_id, exclude_payment.id
            )
        else:
            a += invoice_balance_due(inv, company_id)
    cb = customer.current_balance or Decimal("0")
    if exclude_payment is not None and (exclude_payment.amount or 0) > 0:
        cb = cb + (exclude_payment.amount or Decimal("0"))
    u = cb - a
    ob = customer.opening_balance or Decimal("0")
    if a == 0 and cb == 0 and ob > 0:
        u = max(u, ob)
    if u < 0:
        u = Decimal("0")
    return u.quantize(Decimal("0.01"))


def vendor_unbilled_payable(
    company_id: int,
    vendor: Vendor,
    *,
    exclude_payment: Optional[Payment] = None,
) -> Decimal:
    """
    A/P in vendor subledger not covered by open bill lines (e.g. opening / legacy opening only).
    """
    a = Decimal("0")
    for b in Bill.objects.filter(company_id=company_id, vendor_id=vendor.id).exclude(
        status="draft"
    ):
        total = b.total or Decimal("0")
        if total <= 0:
            continue
        if exclude_payment is not None:
            paid = total_allocated_to_bill_excluding_payment(
                company_id, b.id, exclude_payment.id
            )
        else:
            paid = total_allocated_to_bill(company_id, b.id)
        a += max(Decimal("0"), total - paid)
    cb = vendor.current_balance or Decimal("0")
    if exclude_payment is not None and (exclude_payment.amount or 0) > 0:
        cb = cb + (exclude_payment.amount or Decimal("0"))
    u = cb - a
    ob = vendor.opening_balance or Decimal("0")
    if a == 0 and cb == 0 and ob > 0:
        u = max(u, ob)
    if u < 0:
        u = Decimal("0")
    return u.quantize(Decimal("0.01"))


def refresh_invoice_from_allocations(inv: Invoice, company_id: int) -> None:
    """Set status to paid/partial/sent based on allocations (credit sales only)."""
    if inv.status == "draft":
        return
    paid = total_allocated_for_invoice(inv, company_id)
    total = inv.total or Decimal("0")
    if total <= 0:
        return
    if paid >= total:
        new_status = "paid"
    elif paid > 0:
        new_status = "partial"
    else:
        if inv.status in ("partial", "paid"):
            new_status = "sent"
        else:
            new_status = inv.status
    if new_status != inv.status:
        inv.status = new_status
        inv.save(update_fields=["status", "updated_at"])


def refresh_invoices_touched_by_payment(company_id: int, payment_id: int) -> None:
    ids = (
        PaymentInvoiceAllocation.objects.filter(payment_id=payment_id)
        .values_list("invoice_id", flat=True)
        .distinct()
    )
    for iid in ids:
        inv = Invoice.objects.filter(id=iid, company_id=company_id).first()
        if inv:
            refresh_invoice_from_allocations(inv, company_id)


def compute_vendor_balance_due(company_id: int, vendor_id: int) -> Decimal:
    """
    Unpaid bill totals for a vendor (sum of max(0, bill.total - allocated payments)).
    Matches what Vendor.current_balance should show for A/P.
    """
    owed = Decimal("0")
    for b in Bill.objects.filter(company_id=company_id, vendor_id=vendor_id).exclude(
        status="draft"
    ):
        total = b.total or Decimal("0")
        if total <= 0:
            continue
        paid = total_allocated_to_bill(company_id, b.id)
        owed += max(Decimal("0"), total - paid)
    return owed


def total_allocated_to_bill(company_id: int, bill_id: int) -> Decimal:
    s = (
        PaymentBillAllocation.objects.filter(
            bill_id=bill_id,
            payment__company_id=company_id,
        ).aggregate(total=Sum("amount"))["total"]
    )
    return s or Decimal("0")


def total_allocated_to_bill_excluding_payment(
    company_id: int, bill_id: int, exclude_payment_id: int
) -> Decimal:
    s = (
        PaymentBillAllocation.objects.filter(
            bill_id=bill_id,
            payment__company_id=company_id,
        )
        .exclude(payment_id=exclude_payment_id)
        .aggregate(total=Sum("amount"))["total"]
    )
    return s or Decimal("0")


def refresh_bill_from_allocations(bill: Bill, company_id: int) -> None:
    if bill.status == "draft":
        return
    paid = total_allocated_to_bill(company_id, bill.id)
    total = bill.total or Decimal("0")
    if total <= 0:
        return
    if paid >= total:
        new_status = "paid"
    elif paid > 0:
        new_status = "partial"
    else:
        new_status = "open" if bill.status in ("partial", "paid") else bill.status
    if new_status != bill.status:
        bill.status = new_status
        bill.save(update_fields=["status", "updated_at"])


def refresh_bills_touched_by_payment(company_id: int, payment_id: int) -> None:
    ids = (
        PaymentBillAllocation.objects.filter(payment_id=payment_id)
        .values_list("bill_id", flat=True)
        .distinct()
    )
    for bid in ids:
        b = Bill.objects.filter(id=bid, company_id=company_id).first()
        if b:
            refresh_bill_from_allocations(b, company_id)


def apply_invoice_allocations_for_payment(
    company_id: int,
    payment_id: int,
    customer_id: int,
    rows: list[dict],
) -> tuple[bool, str]:
    """
    rows: [{"invoice_id": int, "amount": Decimal}, ...]
    Sum of amounts must equal payment amount. Each invoice must belong to company and customer.
    """
    from api.models import Payment

    p = Payment.objects.filter(id=payment_id, company_id=company_id).first()
    if not p:
        return False, "payment not found"
    total_alloc = Decimal("0")
    cleaned: list[tuple[int, Decimal]] = []
    for row in rows:
        iid = row.get("invoice_id")
        amt = row.get("amount")
        if iid is None or amt is None:
            continue
        try:
            d_amt = Decimal(str(amt))
        except Exception:
            return False, "invalid allocation amount"
        if d_amt <= 0:
            continue
        inv = Invoice.objects.filter(
            id=iid, company_id=company_id, customer_id=customer_id
        ).first()
        if not inv:
            return False, f"invoice {iid} not found for this customer"
        if inv.status == "draft":
            return False, f"invoice {iid} is draft"
        open_amt = invoice_open_amount(inv, company_id)
        if d_amt > open_amt + Decimal("0.01"):
            return False, f"allocation exceeds open balance for invoice {iid}"
        cleaned.append((inv.id, d_amt))
        total_alloc += d_amt
    if abs(total_alloc - p.amount) > Decimal("0.01"):
        return False, "sum of invoice allocations must equal payment amount"
    with transaction.atomic():
        PaymentInvoiceAllocation.objects.filter(payment_id=p.id).delete()
        for iid, d_amt in cleaned:
            PaymentInvoiceAllocation.objects.create(
                payment_id=p.id, invoice_id=iid, amount=d_amt
            )
    refresh_invoices_touched_by_payment(company_id, p.id)
    return True, ""


def apply_bill_allocations_for_payment(
    company_id: int,
    payment_id: int,
    vendor_id: int,
    rows: list[dict],
) -> tuple[bool, str]:
    from api.models import Payment

    p = Payment.objects.filter(id=payment_id, company_id=company_id).first()
    if not p:
        return False, "payment not found"
    total_alloc = Decimal("0")
    cleaned: list[tuple[int, Decimal]] = []
    for row in rows:
        bid = row.get("bill_id")
        amt = row.get("amount")
        if amt is None or amt == "":
            amt = row.get("allocated_amount")
        if bid is None or amt is None or amt == "":
            continue
        try:
            d_amt = Decimal(str(amt))
        except Exception:
            return False, "invalid allocation amount"
        if d_amt <= 0:
            continue
        bill = Bill.objects.filter(id=bid, company_id=company_id, vendor_id=vendor_id).first()
        if not bill:
            return False, f"bill {bid} not found for this vendor"
        if bill.status == "draft":
            return False, f"bill {bid} is draft"
        paid = total_allocated_to_bill(company_id, bill.id)
        open_amt = max(Decimal("0"), (bill.total or Decimal("0")) - paid)
        if d_amt > open_amt + Decimal("0.01"):
            return False, f"allocation exceeds open balance for bill {bid}"
        cleaned.append((bill.id, d_amt))
        total_alloc += d_amt
    if abs(total_alloc - p.amount) > Decimal("0.01"):
        return False, "sum of bill allocations must equal payment amount"
    with transaction.atomic():
        PaymentBillAllocation.objects.filter(payment_id=p.id).delete()
        for bid, d_amt in cleaned:
            PaymentBillAllocation.objects.create(
                payment_id=p.id, bill_id=bid, amount=d_amt
            )
    refresh_bills_touched_by_payment(company_id, p.id)
    return True, ""
