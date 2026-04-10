"""Vendors API: list, create, get, update, delete (company-scoped)."""
from datetime import date
from decimal import Decimal
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id
from api.models import Vendor
from api.services.contact_ledgers import build_vendor_ledger, ledger_query_dates


def _serialize_date(d):
    if d is None:
        return None
    return d.isoformat() if hasattr(d, "isoformat") else str(d)


def _vendor_to_json(v):
    return {
        "id": v.id,
        "vendor_number": v.vendor_number or "",
        "company_name": v.company_name,
        "display_name": v.display_name or v.company_name,
        "contact_person": v.contact_person or "",
        "email": v.email or "",
        "phone": v.phone or "",
        "billing_address_line1": v.billing_address_line1 or "",
        "bank_account_number": v.bank_account_number or "",
        "bank_name": v.bank_name or "",
        "bank_branch": v.bank_branch or "",
        "bank_routing_number": v.bank_routing_number or "",
        "opening_balance": str(v.opening_balance),
        "opening_balance_date": _serialize_date(v.opening_balance_date),
        "current_balance": str(v.current_balance),
        "is_active": v.is_active,
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
        s = str(val).split("T")[0]
        return date.fromisoformat(s)
    except Exception:
        return None


@csrf_exempt
@auth_required
@require_company_id
def vendors_list_or_create(request):
    if request.method == "GET":
        qs = Vendor.objects.filter(company_id=request.company_id).order_by("id")
        return JsonResponse([_vendor_to_json(v) for v in qs], safe=False)

    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        company_name = (body.get("company_name") or "").strip()
        if not company_name:
            return JsonResponse({"detail": "company_name is required"}, status=400)
        v = Vendor(
            company_id=request.company_id,
            company_name=company_name,
            display_name=body.get("display_name") or company_name,
            contact_person=body.get("contact_person") or "",
            email=body.get("email") or "",
            phone=body.get("phone") or "",
            billing_address_line1=body.get("billing_address_line1") or "",
            bank_account_number=(body.get("bank_account_number") or "")[:100],
            bank_name=(body.get("bank_name") or "")[:200],
            bank_branch=(body.get("bank_branch") or "")[:200],
            bank_routing_number=(body.get("bank_routing_number") or "")[:64],
            opening_balance=_decimal(body.get("opening_balance")),
            opening_balance_date=_parse_date(body.get("opening_balance_date")),
            current_balance=_decimal(body.get("current_balance"), _decimal(body.get("opening_balance"))),
            is_active=body.get("is_active", True),
        )
        v.save()
        if not v.vendor_number:
            v.vendor_number = f"VND-{v.id}"
            Vendor.objects.filter(pk=v.pk).update(vendor_number=v.vendor_number)
        return JsonResponse(_vendor_to_json(v), status=201)

    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def vendor_detail(request, vendor_id: int):
    v = Vendor.objects.filter(id=vendor_id, company_id=request.company_id).first()
    if not v:
        return JsonResponse({"detail": "Vendor not found"}, status=404)

    if request.method == "GET":
        return JsonResponse(_vendor_to_json(v))

    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err
        if body.get("company_name") is not None:
            v.company_name = (body.get("company_name") or "").strip() or v.company_name
        if "display_name" in body:
            v.display_name = (body.get("display_name") or "")[:200]
        if "contact_person" in body:
            v.contact_person = (body.get("contact_person") or "")[:200]
        if "email" in body:
            v.email = (body.get("email") or "")[:150]
        if "phone" in body:
            v.phone = (body.get("phone") or "")[:30]
        if "billing_address_line1" in body:
            v.billing_address_line1 = (body.get("billing_address_line1") or "")[:300]
        if "bank_account_number" in body:
            v.bank_account_number = (body.get("bank_account_number") or "")[:100]
        if "bank_name" in body:
            v.bank_name = (body.get("bank_name") or "")[:200]
        if "bank_branch" in body:
            v.bank_branch = (body.get("bank_branch") or "")[:200]
        if "bank_routing_number" in body:
            v.bank_routing_number = (body.get("bank_routing_number") or "")[:64]
        if "opening_balance" in body:
            v.opening_balance = _decimal(body.get("opening_balance"), v.opening_balance)
        if "opening_balance_date" in body:
            v.opening_balance_date = _parse_date(body.get("opening_balance_date"))
        if "current_balance" in body:
            v.current_balance = _decimal(body.get("current_balance"), v.current_balance)
        if "is_active" in body:
            v.is_active = bool(body["is_active"])
        v.save()
        return JsonResponse(_vendor_to_json(v))

    if request.method == "DELETE":
        v.delete()
        return JsonResponse({"detail": "Deleted"}, status=200)

    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def vendor_ledger(request, vendor_id: int):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    start_d, end_d = ledger_query_dates(request)
    data = build_vendor_ledger(
        request.company_id, vendor_id, start_date=start_d, end_date=end_d
    )
    if data.get("detail") == "Vendor not found":
        return JsonResponse(data, status=404)
    return JsonResponse(data)
