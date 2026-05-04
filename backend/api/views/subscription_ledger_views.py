"""Subscription ledger API: invoices list/create/update/delete; admin company subscription (Super Admin)."""
from datetime import date
from decimal import Decimal
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.utils.auth import auth_required, get_user_from_request, user_is_super_admin
from api.views.common import parse_json_body
from api.models import SubscriptionLedgerInvoice, Company
from api.saas_billing import SAAS_BILLING_PLANS, plan_name_for_code


def _super_admin_required(view_func):
    def wrapped(request, *args, **kwargs):
        user = getattr(request, "api_user", None) or get_user_from_request(request)
        if not user:
            return JsonResponse({"detail": "Authentication required"}, status=401)
        if not user_is_super_admin(user):
            return JsonResponse({"detail": "Super Admin access required"}, status=403)
        return view_func(request, *args, **kwargs)
    return wrapped


def _serialize_date(d):
    if d is None:
        return None
    return d.isoformat() if hasattr(d, "isoformat") else str(d)


def _invoice_to_json(inv: SubscriptionLedgerInvoice) -> dict:
    """Shape aligned with admin SubscriptionLedger UI."""
    c = inv.company
    company_name = c.name if c else ""
    period_start = inv.period_start or inv.invoice_date
    period_end = inv.period_end
    st = (inv.status or "draft").lower()
    # Map legacy draft/sent to pending for clearer AR tracking in UI
    display_status = st
    if st in ("draft", "sent"):
        display_status = "pending"
    return {
        "id": inv.id,
        "invoice_number": inv.invoice_number,
        "payment_number": inv.invoice_number,
        "company_id": inv.company_id,
        "company_name": company_name,
        "subscription_id": inv.company_id,
        "amount": float(inv.amount),
        "currency": (inv.currency or "BDT").upper(),
        "billing_plan_code": inv.billing_plan_code or "",
        "billing_cycle": inv.billing_cycle or "",
        "status": display_status,
        "status_raw": st,
        "due_date": _serialize_date(inv.due_date),
        "paid_date": _serialize_date(inv.paid_date),
        "period_start": _serialize_date(period_start),
        "period_end": _serialize_date(period_end),
        "invoice_date": _serialize_date(inv.invoice_date),
        "notes": inv.notes or "",
        "created_at": inv.created_at.isoformat() if inv.created_at else None,
        "updated_at": inv.updated_at.isoformat() if inv.updated_at else None,
    }


def _decimal(val, default=0):
    if val is None:
        return default
    try:
        return Decimal(str(val))
    except Exception:
        return default


def _parse_date(val):
    if not val:
        return None
    try:
        return date.fromisoformat(str(val).split("T")[0])
    except Exception:
        return None


def _normalize_subscription_invoice_number(raw: str) -> str:
    """Canonical form for uniqueness (case-insensitive in UI; stored uppercase)."""
    return (raw or "").strip().upper()[:64]


def _subscription_invoice_number_taken(
    company_id: int, invoice_number: str, exclude_invoice_id: int | None = None
) -> bool:
    num = _normalize_subscription_invoice_number(invoice_number)
    if not num:
        return False
    qs = SubscriptionLedgerInvoice.objects.filter(
        company_id=company_id, invoice_number__iexact=num
    )
    if exclude_invoice_id is not None:
        qs = qs.exclude(id=exclude_invoice_id)
    return qs.exists()


def _next_auto_subscription_invoice_number(company_id: int) -> str:
    n = SubscriptionLedgerInvoice.objects.filter(company_id=company_id).count() + 1
    inv_num = f"SUB-{company_id}-{n:04d}"
    while _subscription_invoice_number_taken(company_id, inv_num):
        n += 1
        inv_num = f"SUB-{company_id}-{n:04d}"
    return _normalize_subscription_invoice_number(inv_num)


def _append_discount_notes(existing: str, body: dict) -> str:
    parts = []
    dp = body.get("discount_percent")
    da = body.get("discount_amount")
    dr = body.get("discount_reason")
    try:
        if dp is not None and float(dp) > 0:
            parts.append(f"discount_percent={dp}")
    except (TypeError, ValueError):
        pass
    try:
        if da is not None and float(da) > 0:
            parts.append(f"discount_amount={da}")
    except (TypeError, ValueError):
        pass
    if dr:
        parts.append(f"discount_reason={dr}")
    if not parts:
        return existing or ""
    block = "[invoice_meta] " + "; ".join(parts)
    base = (existing or "").strip()
    if base:
        return base + "\n" + block
    return block


@csrf_exempt
@auth_required
@_super_admin_required
def admin_billing_plans(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    return JsonResponse(SAAS_BILLING_PLANS, safe=False)


@csrf_exempt
@auth_required
@_super_admin_required
def subscription_ledger_invoices_list_or_create(request):
    if request.method == "GET":
        company_id = request.GET.get("company_id")
        start_date = request.GET.get("start_date")
        end_date = request.GET.get("end_date")
        status = (request.GET.get("status") or "").strip().lower()
        qs = SubscriptionLedgerInvoice.objects.select_related("company").order_by("-invoice_date", "-id")
        if company_id:
            try:
                qs = qs.filter(company_id=int(company_id))
            except ValueError:
                pass
        if start_date:
            d0 = _parse_date(start_date)
            if d0:
                qs = qs.filter(invoice_date__gte=d0)
        if end_date:
            d1 = _parse_date(end_date)
            if d1:
                qs = qs.filter(invoice_date__lte=d1)
        if status:
            if status == "pending":
                qs = qs.filter(status__in=["draft", "sent", "pending"])
            elif status == "paid":
                qs = qs.filter(status__iexact="paid")
            elif status == "failed":
                qs = qs.filter(status__iexact="failed")
        return JsonResponse([_invoice_to_json(inv) for inv in qs], safe=False)

    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        company_id = body.get("company_id")
        if not company_id or not Company.objects.filter(id=company_id, is_deleted=False).exists():
            return JsonResponse({"detail": "Valid company_id required"}, status=400)
        company_id = int(company_id)

        sub_id = body.get("subscription_id")
        if sub_id is not None and str(sub_id).strip() != "":
            try:
                if int(sub_id) != company_id:
                    return JsonResponse(
                        {"detail": "subscription_id must match company_id for tenant billing"},
                        status=400,
                    )
            except (TypeError, ValueError):
                return JsonResponse({"detail": "Invalid subscription_id"}, status=400)

        count = SubscriptionLedgerInvoice.objects.filter(company_id=company_id).count()
        inv_num = (body.get("invoice_number") or body.get("payment_number") or "").strip()
        if not inv_num:
            inv_num = f"SUB-{company_id}-{count + 1:04d}"

        period_start = _parse_date(body.get("period_start"))
        period_end = _parse_date(body.get("period_end"))
        due = _parse_date(body.get("due_date"))
        inv_date = _parse_date(body.get("invoice_date")) or period_start or date.today()

        currency = (body.get("currency") or "BDT")[:3].upper()
        billing_cycle = (body.get("billing_cycle") or "")[:32]
        plan_code = (body.get("billing_plan_code") or "")[:32].strip().lower()

        status_in = (body.get("status") or "pending")[:32].lower()
        if status_in not in ("draft", "sent", "pending", "paid", "overdue", "void", "failed"):
            status_in = "pending"
        if status_in == "pending":
            status_in = "sent"

        notes = _append_discount_notes(body.get("notes") or "", body)

        inv = SubscriptionLedgerInvoice(
            company_id=company_id,
            invoice_number=inv_num,
            amount=_decimal(body.get("amount")),
            currency=currency,
            billing_plan_code=plan_code,
            billing_cycle=billing_cycle,
            invoice_date=inv_date,
            period_start=period_start,
            period_end=period_end,
            due_date=due,
            paid_date=_parse_date(body.get("paid_date")),
            status=status_in,
            notes=notes,
        )
        if inv.status == "paid" and not inv.paid_date:
            inv.paid_date = date.today()
        inv.save()
        return JsonResponse(_invoice_to_json(inv), status=201)

    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@_super_admin_required
def subscription_ledger_invoice_detail(request, invoice_id: int):
    inv = SubscriptionLedgerInvoice.objects.filter(id=invoice_id).select_related("company").first()
    if not inv:
        return JsonResponse({"detail": "Invoice not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_invoice_to_json(inv))
    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err
        if "invoice_number" in body or "payment_number" in body:
            raw = (body.get("invoice_number") or body.get("payment_number") or "").strip()
            if raw:
                new_num = _normalize_subscription_invoice_number(raw)
                if _subscription_invoice_number_taken(inv.company_id, new_num, exclude_invoice_id=inv.id):
                    return JsonResponse(
                        {
                            "detail": (
                                f"Subscription invoice number '{new_num}' already exists for this company."
                            )
                        },
                        status=409,
                    )
                inv.invoice_number = new_num
        if "amount" in body:
            inv.amount = _decimal(body.get("amount"), inv.amount)
        if "currency" in body:
            inv.currency = (body.get("currency") or inv.currency or "BDT")[:3].upper()
        if "billing_plan_code" in body:
            inv.billing_plan_code = (body.get("billing_plan_code") or "")[:32].strip().lower()
        if "billing_cycle" in body:
            inv.billing_cycle = (body.get("billing_cycle") or "")[:32]
        if "invoice_date" in body:
            inv.invoice_date = _parse_date(body.get("invoice_date")) or inv.invoice_date
        if "period_start" in body:
            inv.period_start = _parse_date(body.get("period_start"))
        if "period_end" in body:
            inv.period_end = _parse_date(body.get("period_end"))
        if "due_date" in body:
            inv.due_date = _parse_date(body.get("due_date"))
        if "paid_date" in body:
            inv.paid_date = _parse_date(body.get("paid_date"))
        if "status" in body:
            st = (body.get("status") or inv.status)[:32].lower()
            if st == "pending":
                st = "sent"
            inv.status = st
            if st == "paid" and not inv.paid_date:
                inv.paid_date = date.today()
        if "notes" in body:
            inv.notes = body.get("notes") or ""
        inv.save()
        return JsonResponse(_invoice_to_json(inv))
    if request.method == "DELETE":
        inv.delete()
        return JsonResponse({"detail": "Deleted"}, status=200)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@_super_admin_required
def admin_company_subscription(request, company_id: int):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    c = Company.objects.filter(id=company_id, is_deleted=False).first()
    if not c:
        return JsonResponse({"detail": "Company not found"}, status=404)
    invoices = SubscriptionLedgerInvoice.objects.filter(company_id=company_id).order_by("-invoice_date")[:20]
    plan_code = (getattr(c, "billing_plan_code", None) or "").strip().lower()
    plan_name = plan_name_for_code(plan_code) if plan_code else ""
    label = c.name
    if plan_name:
        label = f"{c.name} — {plan_name}"
    elif plan_code:
        label = f"{c.name} — {plan_code}"
    else:
        label = f"{c.name} — Tenant subscription"

    legacy = {
        "id": c.id,
        "plan_id": c.id,
        "company_id": c.id,
        "plan_code": plan_code,
        "plan_name": plan_name or "Not set",
        "label": label,
    }
    return JsonResponse({
        "company_id": c.id,
        "company_name": c.name,
        "billing_plan_code": plan_code,
        "billing_plan_name": plan_name,
        "payment_start_date": _serialize_date(getattr(c, "payment_start_date", None)),
        "payment_end_date": _serialize_date(getattr(c, "payment_end_date", None)),
        "payment_amount": str(getattr(c, "payment_amount", 0) or 0),
        "invoices": [
            {
                "id": x.id,
                "company_id": x.company_id,
                "invoice_number": x.invoice_number,
                "amount": str(x.amount),
                "invoice_date": _serialize_date(x.invoice_date),
                "due_date": _serialize_date(x.due_date),
                "status": x.status,
                "notes": x.notes or "",
                "currency": getattr(x, "currency", "BDT") or "BDT",
                "billing_plan_code": getattr(x, "billing_plan_code", "") or "",
            }
            for x in invoices
        ],
        "subscription": legacy,
        "subscriptions": [legacy],
    })


@csrf_exempt
@auth_required
@_super_admin_required
def admin_company_subscription_extend(request, company_id: int):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    body, err = parse_json_body(request)
    if err:
        return err
    c = Company.objects.filter(id=company_id, is_deleted=False).first()
    if not c:
        return JsonResponse({"detail": "Company not found"}, status=404)
    end = _parse_date(body.get("payment_end_date") or body.get("end_date"))
    if end:
        c.payment_end_date = end
        c.save()
    return JsonResponse({"ok": True, "payment_end_date": _serialize_date(getattr(c, "payment_end_date", None))})
