"""Payments API: received, made, deposits, outstanding (company-scoped)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from django.db import transaction
from django.db.models import Count, F, Q
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.utils.auth import auth_required
from api.utils.customer_display import customer_display_name
from api.exceptions import GlPostingError
from api.views.common import parse_json_body, require_company_id
from api.models import (
    BankAccount,
    BankDeposit,
    Bill,
    Customer,
    Invoice,
    Payment,
    PaymentBillAllocation,
    PaymentInvoiceAllocation,
    ShiftSession,
    Vendor,
)
from api.services.gl_posting import (
    post_bank_deposit_journal,
    post_payment_made_journal,
    post_payment_received_journal,
    reverse_payment_made_posting,
    reverse_payment_received_posting,
)
from api.services.payment_allocation import (
    customer_uninvoiced_receivable,
    vendor_unbilled_payable,
    invoice_balance_due,
    invoice_balance_due_excluding_payment,
    refresh_bill_from_allocations,
    refresh_bills_touched_by_payment,
    refresh_invoice_from_allocations,
    refresh_invoices_touched_by_payment,
)
from api.services.gl_posting import _is_walkin_customer
from api.services.shift_sales import record_ar_collection_on_shift


def _serialize_date(d):
    if d is None:
        return None
    return d.isoformat() if hasattr(d, "isoformat") else str(d)


def _payment_mutation_flags(p: Payment) -> dict:
    """Edit/delete allowed unless a received payment is tied to a bank deposit batch."""
    locked = bool(getattr(p, "bank_deposit_id", None))
    return {
        "can_edit": p.payment_type in ("received", "made") and not locked,
        "can_delete": p.payment_type in ("received", "made") and not locked,
        "immutable_reason": (
            "This receipt is on a bank deposit. Void or adjust the deposit before editing or deleting this payment."
            if locked
            else None
        ),
    }


def _payment_to_json(p):
    out = {
        "id": p.id,
        "payment_type": p.payment_type,
        "payment_number": f"PAY-{p.id}",
        "customer_id": p.customer_id,
        "vendor_id": p.vendor_id,
        "bank_account_id": p.bank_account_id,
        "amount": str(p.amount),
        "payment_date": _serialize_date(p.payment_date),
        "reference": p.reference or "",
        "reference_number": p.reference or "",
        "memo": p.memo or "",
        "created_at": _serialize_date(p.created_at) if p.created_at else None,
        "payment_method": (getattr(p, "payment_method", None) or "unspecified").strip()
        or "unspecified",
    }
    if p.payment_type == "received":
        out["invoice_allocations"] = [
            {"invoice_id": a.invoice_id, "amount": str(a.amount)}
            for a in p.invoice_allocations.all()
        ]
    if p.payment_type == "made":
        out["bill_allocations"] = [
            {"bill_id": a.bill_id, "amount": str(a.amount)}
            for a in p.bill_allocations.all()
        ]
    if p.payment_type == "received":
        bid = getattr(p, "bank_deposit_id", None)
        out["deposit_status"] = (
            "deposited" if (p.bank_account_id or bid) else "undeposited"
        )
        out["deposit_id"] = bid
    if p.payment_type in ("received", "made"):
        out.update(_payment_mutation_flags(p))
    return out


def _payment_register_json(p: Payment) -> dict:
    """Unified row for cash-disbursement / cash-receipt registers (All payments UI)."""
    row = _payment_to_json(p)
    row["customer_name"] = (
        customer_display_name(p.customer) if p.customer_id and p.customer else ""
    )
    row["vendor_name"] = (
        _vendor_display_name(p.vendor) if p.vendor_id and p.vendor else ""
    )
    ba = getattr(p, "bank_account", None)
    row["bank_account_name"] = ba.account_name if ba else None
    allocs: list[dict] = []
    if p.payment_type == "received":
        for a in p.invoice_allocations.all():
            allocs.append(
                {
                    "invoice_id": a.invoice_id,
                    "bill_id": None,
                    "allocated_amount": float(a.amount),
                }
            )
    elif p.payment_type == "made":
        for a in p.bill_allocations.all():
            allocs.append(
                {
                    "invoice_id": None,
                    "bill_id": a.bill_id,
                    "allocated_amount": float(a.amount),
                }
            )
    row["allocations"] = allocs
    row.update(_payment_mutation_flags(p))
    return row


def _parse_date(val):
    if not val:
        return None
    try:
        return date.fromisoformat(str(val).split("T")[0])
    except Exception:
        return None


def _decimal(val, default=0):
    if val is None:
        return default
    try:
        return Decimal(str(val))
    except Exception:
        return default


def _normalize_payment_method(body: dict) -> str:
    raw = (body.get("payment_method") or "").strip().lower()[:32]
    return raw if raw else "unspecified"


@csrf_exempt
@auth_required
@require_company_id
def payments_all_list(request):
    """Combined cash receipt & disbursement register for the company (AR + AP payments)."""
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = request.company_id
    qs = (
        Payment.objects.filter(company_id=cid, payment_type__in=["received", "made"])
        .select_related("customer", "vendor", "bank_account")
        .prefetch_related("invoice_allocations", "bill_allocations")
        .order_by("-payment_date", "-id")
    )
    ptype = (request.GET.get("type") or "all").strip().lower()
    if ptype in ("received", "made"):
        qs = qs.filter(payment_type=ptype)
    start = request.GET.get("start_date")
    end = request.GET.get("end_date")
    if start:
        qs = qs.filter(payment_date__gte=_parse_date(start))
    if end:
        qs = qs.filter(payment_date__lte=_parse_date(end))
    q = (request.GET.get("q") or "").strip()
    if q:
        qs = qs.filter(
            Q(reference__icontains=q)
            | Q(memo__icontains=q)
            | Q(payment_method__icontains=q)
        )
    return JsonResponse([_payment_register_json(p) for p in qs], safe=False)


@csrf_exempt
@auth_required
@require_company_id
def payments_received_list(request):
    if request.method == "POST":
        return payments_received_create(request)
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    qs = (
        Payment.objects.filter(company_id=request.company_id, payment_type="received")
        .prefetch_related("invoice_allocations")
        .order_by("-payment_date", "-id")
    )
    start = request.GET.get("start_date")
    end = request.GET.get("end_date")
    if start:
        qs = qs.filter(payment_date__gte=_parse_date(start))
    if end:
        qs = qs.filter(payment_date__lte=_parse_date(end))
    return JsonResponse([_payment_to_json(p) for p in qs], safe=False)


@csrf_exempt
@auth_required
@require_company_id
def payments_received_outstanding(request):
    """Invoices with remaining balance (respects payment allocations)."""
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = request.company_id
    qs = (
        Invoice.objects.filter(company_id=cid)
        .exclude(status="draft")
        .select_related("customer")
        .prefetch_related("payment_allocations")
        .order_by("invoice_date")
    )
    cust_param = request.GET.get("customer_id")
    if cust_param is not None and str(cust_param).strip() != "":
        try:
            qs = qs.filter(customer_id=int(cust_param))
        except (TypeError, ValueError):
            pass

    out = []
    today = date.today()
    for inv in qs:
        bal = invoice_balance_due(inv, cid)
        if bal <= Decimal("0.005"):
            continue
        total = inv.total or Decimal("0")
        paid = (total - bal).quantize(Decimal("0.01"))
        if paid < 0:
            paid = Decimal("0")
        cust = inv.customer
        due = inv.due_date
        days_overdue = None
        if due:
            if due < today:
                days_overdue = (today - due).days
            else:
                days_overdue = 0
        out.append(
            {
                "id": inv.id,
                "invoice_number": inv.invoice_number,
                "invoice_date": _serialize_date(inv.invoice_date),
                "due_date": _serialize_date(inv.due_date),
                "customer_id": inv.customer_id,
                "customer_name": customer_display_name(cust),
                "total": str(total),
                "total_amount": str(total),
                "amount_paid": str(paid),
                "balance_due": str(bal),
                "days_overdue": days_overdue,
            }
        )

    def _append_uninvoiced_on_account(c: Customer) -> None:
        if _is_walkin_customer(c):
            return
        u = customer_uninvoiced_receivable(cid, c)
        if u <= Decimal("0.005"):
            return
        out.append(
            {
                "id": 0,
                "synthetic": True,
                "on_account": True,
                "invoice_number": "On-account (opening / not invoiced)",
                "invoice_date": _serialize_date(c.opening_balance_date) or _serialize_date(today),
                "due_date": None,
                "customer_id": c.id,
                "customer_name": customer_display_name(c),
                "total": str(u),
                "total_amount": str(u),
                "amount_paid": "0",
                "balance_due": str(u),
                "days_overdue": None,
            }
        )

    if cust_param is not None and str(cust_param).strip() != "":
        try:
            cust_id = int(cust_param)
        except (TypeError, ValueError):
            cust_id = None
        if cust_id is not None:
            c = Customer.objects.filter(company_id=cid, id=cust_id).first()
            if c:
                _append_uninvoiced_on_account(c)
    else:
        cand = (
            Customer.objects.filter(company_id=cid, is_active=True)
            .filter(Q(current_balance__gt=0) | Q(opening_balance__gt=0))
            .order_by("display_name", "id")
        )
        for c in cand:
            _append_uninvoiced_on_account(c)
    return JsonResponse(out, safe=False)


def _invoice_allocation_row_amount(row: dict) -> Decimal:
    """UI sends allocated_amount; OpenAPI-style payloads use amount — accept both."""
    v = row.get("amount")
    if v is None or v == "":
        v = row.get("allocated_amount")
    return _decimal(v)


def _align_stored_receivable_before_receipt(company_id: int, customer_id: int) -> None:
    """If A/R in subledger (opening / un-invoiced) is higher than stored current_balance, align it."""
    c = (
        Customer.objects.filter(company_id=company_id, id=customer_id)
        .select_for_update()
        .first()
    )
    if not c or _is_walkin_customer(c):
        return
    u = customer_uninvoiced_receivable(company_id, c)
    cb0 = c.current_balance or Decimal("0")
    if u > cb0 + Decimal("0.01"):
        Customer.objects.filter(pk=c.id).update(current_balance=u)


def _align_stored_ap_before_made_payment(company_id: int, vendor_id: int) -> None:
    """If A/P in subledger exceeds stored vendor.current_balance, align it before a disbursement."""
    v = (
        Vendor.objects.filter(company_id=company_id, id=vendor_id)
        .select_for_update()
        .first()
    )
    if not v:
        return
    u = vendor_unbilled_payable(company_id, v)
    cb0 = v.current_balance or Decimal("0")
    if u > cb0 + Decimal("0.01"):
        Vendor.objects.filter(pk=v.id).update(current_balance=u)


def _is_on_account_allocation_row(row: dict) -> bool:
    if row.get("on_account") is True:
        return True
    iid = row.get("invoice_id")
    if iid is None or iid == "":
        return False
    try:
        return int(iid) == 0
    except (TypeError, ValueError):
        return False


def _validate_invoice_allocations(
    company_id: int,
    customer_id: int,
    amount: Decimal,
    rows: list,
    *,
    exclude_payment_id: int | None = None,
) -> tuple[bool, str, list[tuple[int, Decimal]], Decimal]:
    """Returns (ok, err, invoice_alloc_pairs, on_account_total). on_account has no PaymentInvoice row."""
    coerced_from_empty = bool((not rows) and amount and amount > 0)
    if coerced_from_empty:
        # Legacy: POST without allocation lines applies the full amount to A/R (not to a specific invoice).
        rows = [{"invoice_id": 0, "allocated_amount": str(amount)}]
    if not rows:
        if amount > 0:
            return False, "invoice_allocations must sum to payment amount", [], Decimal("0")
        return True, "", [], Decimal("0")
    if not Customer.objects.filter(id=customer_id, company_id=company_id).exists():
        return False, "Customer not found", [], Decimal("0")

    on_account_total = Decimal("0")
    total_alloc = Decimal("0")
    cleaned: list[tuple[int, Decimal]] = []
    for row in rows:
        if not isinstance(row, dict):
            return False, "invalid allocation", [], Decimal("0")
        if _is_on_account_allocation_row(row):
            try:
                d_amt = _invoice_allocation_row_amount(row)
            except Exception:
                return False, "invalid on-account amount", [], Decimal("0")
            if d_amt <= 0:
                continue
            on_account_total += d_amt
            total_alloc += d_amt
            continue
        iid = row.get("invoice_id")
        if iid is None:
            continue
        try:
            iid = int(iid)
        except (TypeError, ValueError):
            return False, "invalid allocation", [], Decimal("0")
        if iid == 0:
            continue
        try:
            d_amt = _invoice_allocation_row_amount(row)
        except Exception:
            return False, "invalid allocation", [], Decimal("0")
        if d_amt <= 0:
            continue
        inv = Invoice.objects.filter(
            id=iid, company_id=company_id, customer_id=customer_id
        ).prefetch_related("payment_allocations").first()
        if not inv:
            return False, f"invoice {iid} invalid for customer", [], Decimal("0")
        if inv.status == "draft":
            return False, f"invoice {iid} is draft", [], Decimal("0")
        if exclude_payment_id is not None:
            open_amt = invoice_balance_due_excluding_payment(
                inv, company_id, exclude_payment_id
            )
        else:
            open_amt = invoice_balance_due(inv, company_id)
        if d_amt > open_amt + Decimal("0.01"):
            return False, f"allocation exceeds balance for invoice {iid}", [], Decimal("0")
        cleaned.append((inv.id, d_amt))
        total_alloc += d_amt
    # on_account may exceed customer_uninvoiced_receivable: the difference is
    # customer prepayment (credit on account), not an error.
    if abs(total_alloc - amount) > Decimal("0.01"):
        return False, "invoice_allocations must sum to payment amount", [], Decimal("0")
    return True, "", cleaned, on_account_total


@csrf_exempt
@auth_required
@require_company_id
def payments_received_create(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    body, err = parse_json_body(request)
    if err:
        return err
    customer_id = body.get("customer_id")
    amount = _decimal(body.get("amount"))
    if not customer_id or not amount or amount <= 0:
        return JsonResponse({"detail": "customer_id and positive amount required"}, status=400)
    if not Customer.objects.filter(id=customer_id, company_id=request.company_id).exists():
        return JsonResponse({"detail": "Customer not found"}, status=400)
    bank_id = body.get("bank_account_id")
    if bank_id and not BankAccount.objects.filter(id=bank_id, company_id=request.company_id).exists():
        bank_id = None
    alloc_rows = body.get("invoice_allocations") or body.get("allocations") or []
    if alloc_rows and not isinstance(alloc_rows, list):
        return JsonResponse({"detail": "invoice_allocations must be a list"}, status=400)
    ok, msg, cleaned, on_acct = _validate_invoice_allocations(
        request.company_id, int(customer_id), amount, alloc_rows
    )
    if not ok:
        return JsonResponse({"detail": msg}, status=400)

    shift_session_id_for_roll: int | None = None
    raw_shift = body.get("shift_session_id")
    if raw_shift is not None and str(raw_shift).strip() != "":
        try:
            shift_session_id_for_roll = int(raw_shift)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "Invalid shift_session_id"}, status=400)
        if not ShiftSession.objects.filter(
            id=shift_session_id_for_roll,
            company_id=request.company_id,
            closed_at__isnull=True,
        ).exists():
            return JsonResponse(
                {
                    "detail": (
                        "shift_session_id must be an open shift session for this company "
                        "(see GET /api/shifts/sessions/active/)."
                    )
                },
                status=400,
            )

    pm_norm = _normalize_payment_method(body)

    try:
        with transaction.atomic():
            if on_acct and on_acct > 0:
                _align_stored_receivable_before_receipt(
                    request.company_id, int(customer_id)
                )
            p = Payment(
                company_id=request.company_id,
                payment_type="received",
                customer_id=customer_id,
                bank_account_id=bank_id,
                amount=amount,
                payment_date=_parse_date(body.get("payment_date")) or date.today(),
                payment_method=pm_norm,
                reference=body.get("reference_number") or body.get("reference") or "",
                memo=body.get("memo") or "",
            )
            p.save()
            PaymentInvoiceAllocation.objects.filter(payment_id=p.id).delete()
            for iid, d_amt in cleaned:
                PaymentInvoiceAllocation.objects.create(
                    payment_id=p.id, invoice_id=iid, amount=d_amt
                )
            post_payment_received_journal(request.company_id, p)
            refresh_invoices_touched_by_payment(request.company_id, p.id)
            if shift_session_id_for_roll is not None:
                record_ar_collection_on_shift(
                    request.company_id, shift_session_id_for_roll, amount, pm_norm
                )
    except GlPostingError as e:
        return JsonResponse({"detail": e.detail, "code": "gl_posting"}, status=400)

    p = (
        Payment.objects.filter(id=p.id)
        .prefetch_related("invoice_allocations")
        .first()
    )
    return JsonResponse(_payment_to_json(p), status=201)


@csrf_exempt
@auth_required
@require_company_id
def payments_made_list(request):
    if request.method == "POST":
        return payments_made_create(request)
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    qs = (
        Payment.objects.filter(company_id=request.company_id, payment_type="made")
        .prefetch_related("bill_allocations")
        .order_by("-payment_date", "-id")
    )
    start = request.GET.get("start_date")
    end = request.GET.get("end_date")
    if start:
        qs = qs.filter(payment_date__gte=_parse_date(start))
    if end:
        qs = qs.filter(payment_date__lte=_parse_date(end))
    return JsonResponse([_payment_to_json(p) for p in qs], safe=False)


def _bill_allocation_row_amount(row: dict) -> Decimal:
    """UI sends allocated_amount; API docs use amount — accept both."""
    v = row.get("amount")
    if v is None or v == "":
        v = row.get("allocated_amount")
    return _decimal(v)


def _is_on_account_bill_row(row: dict) -> bool:
    if row.get("on_account") is True:
        return True
    bid = row.get("bill_id")
    if bid is None or bid == "":
        return False
    try:
        return int(bid) == 0
    except (TypeError, ValueError):
        return False


def _validate_bill_allocations(
    company_id: int,
    vendor_id: int,
    amount: Decimal,
    rows: list,
    *,
    exclude_payment_id: int | None = None,
) -> tuple[bool, str, list[tuple[int, Decimal]], Decimal]:
    from api.services.payment_allocation import (
        total_allocated_to_bill,
        total_allocated_to_bill_excluding_payment,
    )

    coerced_from_empty = bool((not rows) and amount and amount > 0)
    if coerced_from_empty:
        rows = [{"bill_id": 0, "allocated_amount": str(amount)}]
    if not rows:
        if amount > 0:
            return False, "bill_allocations must sum to payment amount", [], Decimal("0")
        return True, "", [], Decimal("0")
    v = Vendor.objects.filter(id=vendor_id, company_id=company_id).first()
    if not v:
        return False, "Vendor not found", [], Decimal("0")
    ex_pay = None
    if exclude_payment_id is not None:
        ex_pay = Payment.objects.filter(
            id=exclude_payment_id, company_id=company_id, payment_type="made"
        ).first()
    cap_on = vendor_unbilled_payable(company_id, v, exclude_payment=ex_pay)

    on_account_total = Decimal("0")
    total_alloc = Decimal("0")
    cleaned: list[tuple[int, Decimal]] = []
    for row in rows:
        if not isinstance(row, dict):
            return False, "invalid allocation", [], Decimal("0")
        if _is_on_account_bill_row(row):
            try:
                d_amt = _bill_allocation_row_amount(row)
            except Exception:
                return False, "invalid on-account amount", [], Decimal("0")
            if d_amt <= 0:
                continue
            on_account_total += d_amt
            total_alloc += d_amt
            continue
        bid = row.get("bill_id")
        if bid is None:
            continue
        try:
            bid = int(bid)
        except (TypeError, ValueError):
            return False, "invalid allocation", [], Decimal("0")
        if bid == 0:
            continue
        d_amt = _bill_allocation_row_amount(row)
        if d_amt <= 0:
            continue
        bill = Bill.objects.filter(id=bid, company_id=company_id, vendor_id=vendor_id).first()
        if not bill:
            return False, f"bill {bid} invalid for vendor", [], Decimal("0")
        if bill.status == "draft":
            return False, f"bill {bid} is draft", [], Decimal("0")
        if exclude_payment_id is not None:
            paid = total_allocated_to_bill_excluding_payment(
                company_id, bill.id, exclude_payment_id
            )
        else:
            paid = total_allocated_to_bill(company_id, bill.id)
        open_amt = max(Decimal("0"), (bill.total or Decimal("0")) - paid)
        if d_amt > open_amt + Decimal("0.01"):
            return False, f"allocation exceeds balance for bill {bid}", [], Decimal("0")
        cleaned.append((bill.id, d_amt))
        total_alloc += d_amt
    if on_account_total > cap_on + Decimal("0.01"):
        if not coerced_from_empty or cap_on > Decimal("0.01"):
            return (
                False,
                "on-account amount exceeds unbilled A/P (not covered by open bills)",
                [],
                Decimal("0"),
            )
    if abs(total_alloc - amount) > Decimal("0.01"):
        return False, "bill_allocations must sum to payment amount", [], Decimal("0")
    return True, "", cleaned, on_account_total


def _vendor_display_name(vendor) -> str:
    if not vendor:
        return ""
    name = (getattr(vendor, "display_name", None) or "").strip()
    if name:
        return name
    return (getattr(vendor, "company_name", None) or "").strip()


def _outstanding_bill_payload(cid: int, b: Bill):
    """One row for payments/made/outstanding; returns None if nothing due."""
    from api.services.payment_allocation import total_allocated_to_bill

    paid = total_allocated_to_bill(cid, b.id)
    total = b.total or Decimal("0")
    bal = max(Decimal("0"), total - paid)
    if bal <= 0:
        return None
    vendor = getattr(b, "vendor", None)
    due = b.due_date
    days_overdue = None
    if due:
        today = date.today()
        if due < today:
            days_overdue = (today - due).days
        else:
            days_overdue = 0
    return {
        "id": b.id,
        "bill_number": b.bill_number,
        "bill_date": _serialize_date(b.bill_date),
        "due_date": _serialize_date(b.due_date),
        "vendor_id": b.vendor_id,
        "vendor_name": _vendor_display_name(vendor),
        "status": b.status,
        "total": str(total),
        "total_amount": str(total),
        "amount_paid": str(paid),
        "balance_due": str(bal),
        "days_overdue": days_overdue,
    }


@csrf_exempt
@auth_required
@require_company_id
def payments_made_outstanding(request):
    """Open bills with balance due (non-draft, non-paid), with vendor and due-date for AP UI."""
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = request.company_id
    vendor_id = request.GET.get("vendor_id")
    vid = None
    if vendor_id is not None and str(vendor_id).strip() != "":
        try:
            vid = int(vendor_id)
        except (TypeError, ValueError):
            vid = None

    qs = (
        Bill.objects.filter(company_id=cid)
        .exclude(status="draft")
        .exclude(status="paid")
        .select_related("vendor")
        .order_by("bill_date", "id")
    )
    if vid is not None:
        qs = qs.filter(vendor_id=vid)

    out = []
    for b in qs:
        row = _outstanding_bill_payload(cid, b)
        if row:
            out.append(row)

    def _append_unbilled_on_account(v: Vendor) -> None:
        u = vendor_unbilled_payable(cid, v)
        if u <= Decimal("0.005"):
            return
        t = date.today()
        out.append(
            {
                "id": 0,
                "synthetic": True,
                "on_account": True,
                "bill_number": "On-account (opening / not on a bill)",
                "bill_date": _serialize_date(v.opening_balance_date) or _serialize_date(t),
                "due_date": None,
                "vendor_id": v.id,
                "vendor_name": _vendor_display_name(v),
                "status": "on_account",
                "total": str(u),
                "total_amount": str(u),
                "amount_paid": "0",
                "balance_due": str(u),
                "days_overdue": None,
            }
        )

    if vendor_id is not None and str(vendor_id).strip() != "":
        try:
            v_only_id = int(vendor_id)
        except (TypeError, ValueError):
            v_only_id = None
        if v_only_id is not None:
            ve = Vendor.objects.filter(company_id=cid, id=v_only_id).first()
            if ve:
                _append_unbilled_on_account(ve)
    else:
        for v in (
            Vendor.objects.filter(company_id=cid, is_active=True)
            .filter(Q(current_balance__gt=0) | Q(opening_balance__gt=0))
            .order_by("display_name", "company_name", "id")
        ):
            _append_unbilled_on_account(v)
    return JsonResponse(out, safe=False)


@csrf_exempt
@auth_required
@require_company_id
def payments_made_create(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    body, err = parse_json_body(request)
    if err:
        return err
    vendor_id = body.get("vendor_id")
    amount = _decimal(body.get("amount"))
    if not vendor_id or not amount or amount <= 0:
        return JsonResponse({"detail": "vendor_id and positive amount required"}, status=400)
    if not Vendor.objects.filter(id=vendor_id, company_id=request.company_id).exists():
        return JsonResponse({"detail": "Vendor not found"}, status=400)
    bank_id = body.get("bank_account_id")
    if bank_id and not BankAccount.objects.filter(id=bank_id, company_id=request.company_id).exists():
        bank_id = None
    alloc_rows = body.get("bill_allocations") or body.get("allocations") or []
    if alloc_rows and not isinstance(alloc_rows, list):
        return JsonResponse({"detail": "bill_allocations must be a list"}, status=400)
    ok, msg, cleaned, on_acct = _validate_bill_allocations(
        request.company_id, int(vendor_id), amount, alloc_rows
    )
    if not ok:
        return JsonResponse({"detail": msg}, status=400)

    try:
        with transaction.atomic():
            if on_acct and on_acct > 0:
                _align_stored_ap_before_made_payment(
                    request.company_id, int(vendor_id)
                )
            p = Payment(
                company_id=request.company_id,
                payment_type="made",
                vendor_id=vendor_id,
                bank_account_id=bank_id,
                amount=amount,
                payment_date=_parse_date(body.get("payment_date")) or date.today(),
                payment_method=_normalize_payment_method(body),
                reference=(body.get("reference_number") or body.get("reference") or ""),
                memo=body.get("memo") or "",
            )
            p.save()
            PaymentBillAllocation.objects.filter(payment_id=p.id).delete()
            for bid, d_amt in cleaned:
                PaymentBillAllocation.objects.create(
                    payment_id=p.id, bill_id=bid, amount=d_amt
                )
            post_payment_made_journal(request.company_id, p)
            refresh_bills_touched_by_payment(request.company_id, p.id)
    except GlPostingError as e:
        return JsonResponse({"detail": e.detail, "code": "gl_posting"}, status=400)

    p = Payment.objects.filter(id=p.id).prefetch_related("bill_allocations").first()
    return JsonResponse(_payment_to_json(p), status=201)


class DepositGlError(Exception):
    """Raised to roll back a bank deposit when GL posting fails."""


def _bank_deposit_to_json(d: BankDeposit, payment_count: int | None = None) -> dict:
    cnt = payment_count if payment_count is not None else d.deposit_payments.count()
    ba = d.bank_account
    return {
        "id": d.id,
        "deposit_number": d.deposit_number or f"DEP-{d.id}",
        "deposit_date": _serialize_date(d.deposit_date),
        "total_amount": float(d.total_amount),
        "bank_account_id": d.bank_account_id,
        "bank_account_name": ba.account_name if ba else "",
        "is_reconciled": d.is_reconciled,
        "payment_count": cnt,
        "memo": d.memo or "",
    }


@csrf_exempt
@auth_required
@require_company_id
def payments_undeposited_funds(request):
    """Customer receipts still in clearing (cash / undeposited / card) — not yet moved to a bank register."""
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = request.company_id
    qs = (
        Payment.objects.filter(
            company_id=cid,
            payment_type="received",
            bank_account_id__isnull=True,
            bank_deposit_id__isnull=True,
        )
        .select_related("customer")
        .order_by("-payment_date", "-id")
    )
    total = Decimal("0")
    out = []
    for p in qs:
        amt = p.amount or Decimal("0")
        total += amt
        cust = p.customer
        out.append(
            {
                "id": p.id,
                "payment_number": f"PAY-{p.id}",
                "payment_date": _serialize_date(p.payment_date),
                "payment_method": (p.payment_method or "unspecified").strip()
                or "unspecified",
                "amount": float(amt),
                "reference_number": p.reference or None,
                "customer_id": p.customer_id,
                "customer_name": customer_display_name(cust) if cust else "",
                "memo": p.memo or None,
            }
        )
    return JsonResponse({"payments": out, "total_amount": float(total)})


@csrf_exempt
@auth_required
@require_company_id
def payments_deposits_list_or_create(request):
    """List bank deposits (batch) or create one from undeposited customer payments."""
    cid = request.company_id
    if request.method == "GET":
        qs = (
            BankDeposit.objects.filter(company_id=cid)
            .select_related("bank_account")
            .annotate(pc=Count("deposit_payments"))
            .order_by("-deposit_date", "-id")
        )
        return JsonResponse(
            [_bank_deposit_to_json(d, payment_count=d.pc) for d in qs],
            safe=False,
        )

    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        bank_id = body.get("bank_account_id")
        payment_ids = body.get("payment_ids") or []
        if not bank_id:
            return JsonResponse({"detail": "bank_account_id is required"}, status=400)
        if not isinstance(payment_ids, list) or not payment_ids:
            return JsonResponse(
                {"detail": "payment_ids must be a non-empty list"}, status=400
            )
        try:
            bank_id = int(bank_id)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "invalid bank_account_id"}, status=400)
        try:
            pids = [int(x) for x in payment_ids]
        except (TypeError, ValueError):
            return JsonResponse({"detail": "invalid payment_ids"}, status=400)

        dest = BankAccount.objects.filter(
            id=bank_id,
            company_id=cid,
            is_active=True,
            is_equity_register=False,
        ).first()
        if not dest:
            return JsonResponse({"detail": "Bank account not found"}, status=404)

        dep_date = _parse_date(body.get("deposit_date")) or date.today()
        memo = (body.get("memo") or "").strip()[:500]

        if len(set(pids)) != len(pids):
            return JsonResponse(
                {"detail": "Duplicate payment_ids are not allowed"}, status=400
            )

        try:
            with transaction.atomic():
                payments = list(
                    Payment.objects.select_for_update()
                    .filter(
                        id__in=pids,
                        company_id=cid,
                        payment_type="received",
                        bank_account_id__isnull=True,
                        bank_deposit_id__isnull=True,
                    )
                    .order_by("id")
                )
                if len(payments) != len(pids):
                    return JsonResponse(
                        {
                            "detail": "One or more payments are invalid, already deposited, or not eligible (must be undeposited receipts)."
                        },
                        status=400,
                    )
                total = sum((p.amount or Decimal("0")) for p in payments)
                total = total.quantize(Decimal("0.01"))
                if total <= 0:
                    return JsonResponse(
                        {"detail": "Total deposit amount must be positive"}, status=400
                    )

                dep = BankDeposit(
                    company_id=cid,
                    bank_account_id=dest.id,
                    deposit_date=dep_date,
                    total_amount=total,
                    memo=memo,
                )
                dep.save()
                BankDeposit.objects.filter(pk=dep.pk).update(
                    deposit_number=f"DEP-{dep.pk}"
                )
                dep.refresh_from_db()

                if not post_bank_deposit_journal(
                    cid, dep.id, dest, payments, dep_date, memo
                ):
                    raise DepositGlError(
                        "Could not post this deposit to the general ledger. "
                        "Ensure the bank register is linked to a chart account and each "
                        "selected payment has a posted receipt journal (AUTO-PAY-*-RCV)."
                    )

                Payment.objects.filter(pk__in=[p.pk for p in payments]).update(
                    bank_deposit_id=dep.id
                )
                BankAccount.objects.filter(pk=dest.id).update(
                    current_balance=F("current_balance") + total
                )
        except DepositGlError as e:
            return JsonResponse({"detail": str(e)}, status=400)

        dep.refresh_from_db()
        return JsonResponse(_bank_deposit_to_json(dep), status=201)

    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def payment_detail_update_delete(request, payment_id: int):
    """
    GET: full register row (same shape as /payments/ list).
    PUT: update header + allocations; reverses and reposts GL (atomic rollback on failure).
    DELETE: reverses GL + subledgers, deletes payment; invoice/bill status recomputed.
    """
    cid = request.company_id
    p = (
        Payment.objects.filter(id=payment_id, company_id=cid)
        .select_related("customer", "vendor", "bank_account")
        .prefetch_related("invoice_allocations", "bill_allocations")
        .first()
    )
    if not p:
        return JsonResponse({"detail": "Payment not found"}, status=404)
    if p.payment_type not in ("received", "made"):
        return JsonResponse(
            {"detail": "Only customer receipts and vendor payments can be edited here."},
            status=400,
        )

    if request.method == "GET":
        return JsonResponse(_payment_register_json(p))

    if p.bank_deposit_id:
        return JsonResponse(
            {
                "detail": "This receipt is on a bank deposit. Void or adjust the deposit before editing or deleting this payment.",
                "policy": "immutable_while_on_deposit",
            },
            status=409,
        )

    if request.method == "DELETE":
        if p.payment_type == "received":
            inv_ids = list(
                PaymentInvoiceAllocation.objects.filter(payment_id=p.id).values_list(
                    "invoice_id", flat=True
                )
            )
            journal_ref = f"AUTO-PAY-{p.id}-RCV"
            amt = str(p.amount)
            with transaction.atomic():
                ok, msg = reverse_payment_received_posting(cid, p)
                if not ok:
                    return JsonResponse({"detail": msg}, status=400)
                p.delete()
            for iid in inv_ids:
                inv = Invoice.objects.filter(id=iid, company_id=cid).first()
                if inv:
                    refresh_invoice_from_allocations(inv, cid)
            return JsonResponse(
                {
                    "detail": "Payment deleted.",
                    "rollback": {
                        "gl": f"Removed posted journal {journal_ref}.",
                        "subledger": f"Customer AR balance increased by {amt} (non-walk-in customers only).",
                        "documents": f"Invoice status recomputed for: {sorted(set(inv_ids))}.",
                    },
                },
                status=200,
            )

        if p.payment_type == "made":
            bill_ids = list(
                PaymentBillAllocation.objects.filter(payment_id=p.id).values_list(
                    "bill_id", flat=True
                )
            )
            journal_ref = f"AUTO-PAY-{p.id}-MADE"
            amt = str(p.amount)
            with transaction.atomic():
                ok, msg = reverse_payment_made_posting(cid, p)
                if not ok:
                    return JsonResponse({"detail": msg}, status=400)
                p.delete()
            for bid in bill_ids:
                bill = Bill.objects.filter(id=bid, company_id=cid).first()
                if bill:
                    refresh_bill_from_allocations(bill, cid)
            return JsonResponse(
                {
                    "detail": "Payment deleted.",
                    "rollback": {
                        "gl": f"Removed posted journal {journal_ref}.",
                        "subledger": f"Vendor A/P balance increased by {amt} where applicable.",
                        "documents": f"Bill status recomputed for: {sorted(set(bill_ids))}.",
                    },
                },
                status=200,
            )

    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err

        if p.payment_type == "received":
            if body.get("customer_id") is not None and int(body.get("customer_id")) != int(
                p.customer_id or 0
            ):
                return JsonResponse(
                    {
                        "detail": "Changing the customer is not supported. Delete this payment and record a new one.",
                        "policy": "customer_locked",
                    },
                    status=400,
                )
            customer_id = p.customer_id
            amount = _decimal(body.get("amount"), p.amount)
            if not customer_id or amount <= 0:
                return JsonResponse(
                    {"detail": "customer_id and positive amount required"}, status=400
                )
            if "bank_account_id" in body:
                raw_b = body.get("bank_account_id")
                if raw_b is None or raw_b == "":
                    bank_id = None
                else:
                    try:
                        bank_id = int(raw_b)
                    except (TypeError, ValueError):
                        return JsonResponse({"detail": "invalid bank_account_id"}, status=400)
                    if not BankAccount.objects.filter(
                        id=bank_id, company_id=cid, is_equity_register=False
                    ).exists():
                        return JsonResponse({"detail": "Bank account not found"}, status=400)
            else:
                bank_id = p.bank_account_id

            alloc_rows = body.get("invoice_allocations") or body.get("allocations")
            if alloc_rows is None:
                alloc_rows = [
                    {"invoice_id": a.invoice_id, "amount": str(a.amount)}
                    for a in p.invoice_allocations.all()
                ]
            if alloc_rows and not isinstance(alloc_rows, list):
                return JsonResponse(
                    {"detail": "invoice_allocations must be a list"}, status=400
                )
            ok, msg, cleaned, on_acct = _validate_invoice_allocations(
                cid,
                int(customer_id),
                amount,
                alloc_rows,
                exclude_payment_id=p.id,
            )
            if not ok:
                return JsonResponse({"detail": msg}, status=400)

            journal_ref = f"AUTO-PAY-{p.id}-RCV"
            try:
                with transaction.atomic():
                    ok, msg = reverse_payment_received_posting(cid, p)
                    if not ok:
                        return JsonResponse({"detail": msg}, status=400)
                    p.refresh_from_db()
                    if on_acct and on_acct > 0:
                        _align_stored_receivable_before_receipt(cid, int(customer_id))
                    p.payment_date = _parse_date(body.get("payment_date")) or p.payment_date
                    p.payment_method = _normalize_payment_method(body)
                    p.reference = (body.get("reference_number") or body.get("reference") or "").strip()[
                        :200
                    ]
                    p.memo = (body.get("memo") or "")[:500]
                    p.bank_account_id = bank_id
                    p.amount = amount
                    p.save()
                    PaymentInvoiceAllocation.objects.filter(payment_id=p.id).delete()
                    for iid, d_amt in cleaned:
                        PaymentInvoiceAllocation.objects.create(
                            payment_id=p.id, invoice_id=iid, amount=d_amt
                        )
                    post_payment_received_journal(cid, p)
                    refresh_invoices_touched_by_payment(cid, p.id)
            except GlPostingError as e:
                return JsonResponse({"detail": e.detail, "code": "gl_posting"}, status=400)

            p.refresh_from_db()
            p = (
                Payment.objects.filter(id=p.id, company_id=cid)
                .select_related("customer", "vendor", "bank_account")
                .prefetch_related("invoice_allocations", "bill_allocations")
                .first()
            )
            return JsonResponse(
                {
                    **_payment_register_json(p),
                    "rollback_note": (
                        f"Previous {journal_ref} was reversed; subledger and invoices were adjusted; "
                        "a new receipt journal was posted for the updated amounts."
                    ),
                }
            )

        if p.payment_type == "made":
            if body.get("vendor_id") is not None and int(body.get("vendor_id")) != int(
                p.vendor_id or 0
            ):
                return JsonResponse(
                    {
                        "detail": "Changing the vendor is not supported. Delete this payment and record a new one.",
                        "policy": "vendor_locked",
                    },
                    status=400,
                )
            vendor_id = p.vendor_id
            amount = _decimal(body.get("amount"), p.amount)
            if not vendor_id or amount <= 0:
                return JsonResponse({"detail": "vendor_id and positive amount required"}, status=400)
            if "bank_account_id" in body:
                raw_b = body.get("bank_account_id")
                if raw_b is None or raw_b == "":
                    bank_id = None
                else:
                    try:
                        bank_id = int(raw_b)
                    except (TypeError, ValueError):
                        return JsonResponse({"detail": "invalid bank_account_id"}, status=400)
                    if not BankAccount.objects.filter(
                        id=bank_id, company_id=cid, is_equity_register=False
                    ).exists():
                        return JsonResponse({"detail": "Bank account not found"}, status=400)
            else:
                bank_id = p.bank_account_id

            alloc_rows = body.get("bill_allocations") or body.get("allocations")
            if alloc_rows is None:
                alloc_rows = [
                    {"bill_id": a.bill_id, "amount": str(a.amount)}
                    for a in p.bill_allocations.all()
                ]
            if alloc_rows and not isinstance(alloc_rows, list):
                return JsonResponse({"detail": "bill_allocations must be a list"}, status=400)
            ok, msg, cleaned, on_acct = _validate_bill_allocations(
                cid, int(vendor_id), amount, alloc_rows, exclude_payment_id=p.id
            )
            if not ok:
                return JsonResponse({"detail": msg}, status=400)

            journal_ref = f"AUTO-PAY-{p.id}-MADE"
            try:
                with transaction.atomic():
                    ok, msg = reverse_payment_made_posting(cid, p)
                    if not ok:
                        return JsonResponse({"detail": msg}, status=400)
                    p.refresh_from_db()
                    if on_acct and on_acct > 0:
                        _align_stored_ap_before_made_payment(cid, int(vendor_id))
                    p.payment_date = _parse_date(body.get("payment_date")) or p.payment_date
                    p.payment_method = _normalize_payment_method(body)
                    p.reference = (body.get("reference_number") or body.get("reference") or "").strip()[
                        :200
                    ]
                    p.memo = (body.get("memo") or "")[:500]
                    p.bank_account_id = bank_id
                    p.amount = amount
                    p.save()
                    PaymentBillAllocation.objects.filter(payment_id=p.id).delete()
                    for bid, d_amt in cleaned:
                        PaymentBillAllocation.objects.create(
                            payment_id=p.id, bill_id=bid, amount=d_amt
                        )
                    post_payment_made_journal(cid, p)
                    refresh_bills_touched_by_payment(cid, p.id)
            except GlPostingError as e:
                return JsonResponse({"detail": e.detail, "code": "gl_posting"}, status=400)

            p = (
                Payment.objects.filter(id=p.id, company_id=cid)
                .select_related("customer", "vendor", "bank_account")
                .prefetch_related("invoice_allocations", "bill_allocations")
                .first()
            )
            return JsonResponse(
                {
                    **_payment_register_json(p),
                    "rollback_note": (
                        f"Previous {journal_ref} was reversed; vendor A/P was adjusted; "
                        "a new disbursement journal was posted for the updated amounts."
                    ),
                }
            )

    return JsonResponse({"detail": "Method not allowed"}, status=405)
