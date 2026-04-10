"""
Tenant-facing subscription UI API (maps SAAS_BILLING_PLANS + Company billing fields).

Used by Next.js /subscriptions. Super Admin uses X-Selected-Company-Id like other tenant APIs.
"""
from __future__ import annotations

from decimal import Decimal

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.models import Company, Station, SubscriptionLedgerInvoice, User
from api.saas_billing import SAAS_BILLING_PLANS
from api.utils.auth import auth_required, company_context_error_response, get_company_id
from api.views.common import parse_json_body
from api.views.subscription_ledger_views import _invoice_to_json


def _serialize_date(d):
    if d is None:
        return None
    return d.isoformat() if hasattr(d, "isoformat") else str(d)


def _plan_row_by_id(plan_id: int) -> tuple[dict | None, int | None]:
    """Return (catalog_row, 1-based id) or (None, None)."""
    try:
        pid = int(plan_id)
    except (TypeError, ValueError):
        return None, None
    for i, p in enumerate(SAAS_BILLING_PLANS, start=1):
        if i == pid:
            return p, i
    return None, None


def _plan_row_by_code(code: str | None) -> tuple[dict | None, int]:
    c = (code or "").strip().lower()
    for i, p in enumerate(SAAS_BILLING_PLANS, start=1):
        if p["code"] == c:
            return p, i
    return None, 1


def _serialize_plan(plan_id: int, p: dict) -> dict:
    sm = float(p.get("suggested_monthly") or 0)
    sy = float(p.get("suggested_yearly") or 0)
    sq = round(sm * 3 * 0.98, 2)
    return {
        "id": plan_id,
        "plan_code": p["code"],
        "plan_name": p["name"],
        "plan_type": p["code"],
        "description": p.get("tagline") or "",
        "price_monthly": sm,
        "price_quarterly": sq,
        "price_yearly": sy,
        "currency": "BDT",
        "features": [],
        "limits": {},
        "trial_days": 14 if p["code"] == "starter" else 0,
        "is_featured": p["code"] in ("growth", "enterprise"),
        "display_order": plan_id,
    }


@csrf_exempt
@auth_required
def subscriptions_plans(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    out = []
    for i, p in enumerate(SAAS_BILLING_PLANS, start=1):
        out.append(_serialize_plan(i, p))
    return JsonResponse(out, safe=False)


@csrf_exempt
@auth_required
def subscriptions_my_subscription(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = get_company_id(request)
    err = company_context_error_response(request)
    if err:
        return err
    if not cid:
        return JsonResponse({"detail": "No company context"}, status=404)
    c = Company.objects.filter(id=cid, is_deleted=False).first()
    if not c:
        return JsonResponse({"detail": "Company not found"}, status=404)

    pdef, plan_id = _plan_row_by_code(getattr(c, "billing_plan_code", None))
    if not pdef:
        pdef = SAAS_BILLING_PLANS[0]
        plan_id = 1

    plan = _serialize_plan(plan_id, pdef)
    pay_type = (getattr(c, "payment_type", None) or "monthly").strip().lower()
    if pay_type not in ("monthly", "quarterly", "half_yearly", "yearly"):
        pay_type = "monthly"

    billing_cycle = "monthly"
    if pay_type == "quarterly":
        billing_cycle = "quarterly"
    elif pay_type in ("half_yearly", "yearly"):
        billing_cycle = "yearly"

    amt = getattr(c, "payment_amount", None) or Decimal("0")
    try:
        price = float(amt)
    except Exception:
        price = float(plan["price_monthly"])

    cancel_flag = bool(getattr(c, "subscription_cancel_at_period_end", False))

    body = {
        "id": c.id,
        "company_id": c.id,
        "plan_id": plan_id,
        "plan": plan,
        "status": "active",
        "billing_cycle": billing_cycle,
        "price": price,
        "trial_start_date": _serialize_date(getattr(c, "payment_start_date", None)),
        "trial_end_date": None,
        "current_period_start": _serialize_date(getattr(c, "payment_start_date", None)),
        "current_period_end": _serialize_date(getattr(c, "payment_end_date", None)),
        "cancel_at_period_end": cancel_flag,
        "cancelled_at": None,
        "limits": {},
        "current_usage": {},
    }
    return JsonResponse(body)


@csrf_exempt
@auth_required
def subscriptions_usage(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = get_company_id(request)
    err = company_context_error_response(request)
    if err:
        return err
    if not cid:
        return JsonResponse({"detail": "No company context"}, status=404)
    c = Company.objects.filter(id=cid, is_deleted=False).first()
    if not c:
        return JsonResponse({"detail": "Company not found"}, status=404)

    users_n = User.objects.filter(company_id=cid, is_active=True).count()
    stations_n = Station.objects.filter(company_id=cid, is_active=True).count()
    pdef, _ = _plan_row_by_code(getattr(c, "billing_plan_code", None))
    limits: dict = {"stations": 999, "users": 999, "storage_gb": 100}
    if pdef and pdef.get("code") == "starter":
        limits = {"stations": 3, "users": 10, "storage_gb": 10}
    elif pdef and pdef.get("code") == "growth":
        limits = {"stations": 25, "users": 50, "storage_gb": 50}

    st = "active"
    if getattr(c, "subscription_cancel_at_period_end", False):
        st = "cancelling"

    return JsonResponse(
        {
            "usage": {"stations": stations_n, "users": users_n},
            "limits": limits,
            "subscription_status": st,
        }
    )


@csrf_exempt
@auth_required
def subscriptions_payments(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = get_company_id(request)
    err = company_context_error_response(request)
    if err:
        return err
    if not cid:
        return JsonResponse({"detail": "No company context"}, status=404)

    qs = (
        SubscriptionLedgerInvoice.objects.filter(company_id=cid)
        .select_related("company")
        .order_by("-invoice_date", "-id")[:100]
    )
    out = []
    for inv in qs:
        j = _invoice_to_json(inv)
        out.append(
            {
                "id": j["id"],
                "payment_number": j.get("payment_number") or j.get("invoice_number") or "",
                "amount": float(j.get("amount") or 0),
                "currency": j.get("currency") or "BDT",
                "status": j.get("status") or "pending",
                "due_date": j.get("due_date") or "",
                "paid_date": j.get("paid_date"),
                "period_start": j.get("period_start") or "",
                "period_end": j.get("period_end") or "",
                "created_at": j.get("created_at") or "",
            }
        )
    return JsonResponse(out, safe=False)


@csrf_exempt
@auth_required
def subscriptions_subscribe(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    body, err = parse_json_body(request)
    if err:
        return err
    cid = get_company_id(request)
    err = company_context_error_response(request)
    if err:
        return err
    if not cid:
        return JsonResponse({"detail": "No company context"}, status=400)
    c = Company.objects.filter(id=cid, is_deleted=False).first()
    if not c:
        return JsonResponse({"detail": "Company not found"}, status=404)

    plan_id = body.get("plan_id")
    pdef, _ = _plan_row_by_id(plan_id)
    if not pdef:
        return JsonResponse({"detail": "Invalid plan_id"}, status=400)

    cycle = (body.get("billing_cycle") or "monthly").strip().lower()
    pay_type = "monthly"
    if cycle == "quarterly":
        pay_type = "quarterly"
    elif cycle == "yearly":
        pay_type = "yearly"

    c.billing_plan_code = pdef["code"]
    c.payment_type = pay_type
    if pay_type == "yearly":
        c.payment_amount = Decimal(str(pdef.get("suggested_yearly") or 0))
    elif pay_type == "quarterly":
        c.payment_amount = Decimal(str(round(float(pdef.get("suggested_monthly") or 0) * 3 * 0.98, 2)))
    else:
        c.payment_amount = Decimal(str(pdef.get("suggested_monthly") or 0))
    c.subscription_cancel_at_period_end = False
    c.save()

    return JsonResponse({"ok": True, "billing_plan_code": c.billing_plan_code})


@csrf_exempt
@auth_required
def subscriptions_my_subscription_cancel(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = get_company_id(request)
    err = company_context_error_response(request)
    if err:
        return err
    if not cid:
        return JsonResponse({"detail": "No company context"}, status=400)
    c = Company.objects.filter(id=cid, is_deleted=False).first()
    if not c:
        return JsonResponse({"detail": "Company not found"}, status=404)
    c.subscription_cancel_at_period_end = True
    c.save(update_fields=["subscription_cancel_at_period_end", "updated_at"])
    return JsonResponse({"ok": True, "cancel_at_period_end": True})


@csrf_exempt
@auth_required
def subscriptions_my_subscription_reactivate(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = get_company_id(request)
    err = company_context_error_response(request)
    if err:
        return err
    if not cid:
        return JsonResponse({"detail": "No company context"}, status=400)
    c = Company.objects.filter(id=cid, is_deleted=False).first()
    if not c:
        return JsonResponse({"detail": "Company not found"}, status=404)
    c.subscription_cancel_at_period_end = False
    c.save(update_fields=["subscription_cancel_at_period_end", "updated_at"])
    return JsonResponse({"ok": True, "cancel_at_period_end": False})
