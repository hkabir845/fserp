"""Vendors API: list, create, get, update, delete (company-scoped)."""
from datetime import date
from decimal import Decimal

from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.utils.auth import auth_required
from api.utils.pagination import json_paged, parse_skip_limit, wants_paged_response
from api.views.common import parse_json_body, require_company_id
from api.models import Vendor
from api.services.coa_gl_defaults import ALLOWED_BILL_EXPENSE_DEBIT, parse_optional_chart_account_id
from api.services.reference_code import assign_string_code_if_empty, user_supplied_code_or_auto
from api.services.station_defaults import parse_optional_pond_fk, parse_optional_station_fk
from api.services.contact_ledgers import build_vendor_ledger, ledger_dates_and_search
from api.utils.transaction_filters import filter_json_transactions


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
        "default_station_id": v.default_station_id,
        "default_station_name": (
            (v.default_station.station_name or "").strip()
            if getattr(v, "default_station_id", None) and getattr(v, "default_station", None)
            else ""
        ),
        "default_aquaculture_pond_id": v.default_aquaculture_pond_id,
        "default_aquaculture_pond_name": (
            (v.default_aquaculture_pond.name or "").strip()
            if getattr(v, "default_aquaculture_pond_id", None) and getattr(v, "default_aquaculture_pond", None)
            else ""
        ),
        "default_expense_account_id": getattr(v, "default_expense_account_id", None),
        "default_expense_account_code": (
            (v.default_expense_account.account_code or "").strip()
            if getattr(v, "default_expense_account_id", None) and getattr(v, "default_expense_account", None)
            else ""
        ),
        "default_expense_account_name": (
            (v.default_expense_account.account_name or "").strip()
            if getattr(v, "default_expense_account_id", None) and getattr(v, "default_expense_account", None)
            else ""
        ),
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


def _vendor_apply_q(qs, raw_q: str):
    q = (raw_q or "").strip()
    if not q:
        return qs
    return qs.filter(
        Q(company_name__icontains=q)
        | Q(display_name__icontains=q)
        | Q(vendor_number__icontains=q)
        | Q(email__icontains=q)
        | Q(phone__icontains=q)
        | Q(contact_person__icontains=q)
        | Q(default_station__station_name__icontains=q)
        | Q(default_aquaculture_pond__name__icontains=q)
    )


def _vendor_apply_sort(qs, request):
    sort_key = (request.GET.get("sort") or "id").strip()
    desc = (request.GET.get("dir") or "asc").strip().lower() == "desc"
    prefix = "-" if desc else ""
    mapping = {
        "id": "id",
        "company_name": "company_name",
        "display_name": "display_name",
        "vendor_number": "vendor_number",
        "current_balance": "current_balance",
        "is_active": "is_active",
        "email": "email",
        "phone": "phone",
    }
    field = mapping.get(sort_key, "id")
    order = [f"{prefix}{field}"]
    if sort_key != "id":
        order.append("id")
    return qs.order_by(*order)


@csrf_exempt
@auth_required
@require_company_id
def vendors_list_or_create(request):
    if request.method == "GET":
        qs = Vendor.objects.filter(company_id=request.company_id).select_related(
            "default_station", "default_aquaculture_pond", "default_expense_account"
        )
        qs = _vendor_apply_q(qs, request.GET.get("q", ""))
        qs = _vendor_apply_sort(qs, request)
        if wants_paged_response(request):
            skip, limit = parse_skip_limit(request, default_limit=50, max_limit=500)
            total = qs.count()
            page = qs[skip : skip + limit]
            return json_paged([_vendor_to_json(v) for v in page], total=total, skip=skip, limit=limit)
        return JsonResponse([_vendor_to_json(v) for v in qs], safe=False)

    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        company_name = (body.get("company_name") or "").strip()
        if not company_name:
            return JsonResponse({"detail": "company_name is required"}, status=400)
        vcode, verr = user_supplied_code_or_auto(
            request.company_id,
            Vendor,
            "vendor_number",
            "VND",
            (body.get("vendor_number") or "").strip() or None,
            None,
        )
        if verr:
            return JsonResponse({"detail": verr}, status=400)
        vst_id = None
        if "default_station_id" in body:
            vst_id, verr2 = parse_optional_station_fk(request.company_id, body.get("default_station_id"))
            if verr2:
                return JsonResponse({"detail": verr2}, status=400)
        pond_id = None
        if "default_aquaculture_pond_id" in body:
            pond_id, perr = parse_optional_pond_fk(request.company_id, body.get("default_aquaculture_pond_id"))
            if perr:
                return JsonResponse({"detail": perr}, status=400)
        def_exp_id = None
        if "default_expense_account_id" in body:
            def_exp_id, ea_err = parse_optional_chart_account_id(
                request.company_id,
                body.get("default_expense_account_id"),
                allowed_normalized_types=ALLOWED_BILL_EXPENSE_DEBIT,
                field_label="default_expense_account_id",
            )
            if ea_err:
                return JsonResponse({"detail": ea_err}, status=400)
        v = Vendor(
            company_id=request.company_id,
            default_station_id=vst_id,
            default_aquaculture_pond_id=pond_id,
            default_expense_account_id=def_exp_id,
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
            vendor_number=vcode or "",
        )
        v.save()
        if not v.vendor_number:
            assigned, aerr = assign_string_code_if_empty(
                request.company_id, Vendor, "vendor_number", "VND", v.pk, None, None
            )
            if aerr:
                v.delete()
                return JsonResponse({"detail": aerr}, status=400)
            v.vendor_number = assigned
            v.save(update_fields=["vendor_number"])
        v2 = (
            Vendor.objects.filter(pk=v.pk, company_id=request.company_id)
            .select_related("default_station", "default_aquaculture_pond", "default_expense_account")
            .first()
        )
        return JsonResponse(_vendor_to_json(v2), status=201)

    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def vendor_detail(request, vendor_id: int):
    v = (
        Vendor.objects.filter(id=vendor_id, company_id=request.company_id)
        .select_related("default_station", "default_aquaculture_pond", "default_expense_account")
        .first()
    )
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
        if "default_station_id" in body:
            vst_id, verr2 = parse_optional_station_fk(request.company_id, body.get("default_station_id"))
            if verr2:
                return JsonResponse({"detail": verr2}, status=400)
            v.default_station_id = vst_id
        if "default_aquaculture_pond_id" in body:
            pond_id, perr = parse_optional_pond_fk(request.company_id, body.get("default_aquaculture_pond_id"))
            if perr:
                return JsonResponse({"detail": perr}, status=400)
            v.default_aquaculture_pond_id = pond_id
        if "default_expense_account_id" in body:
            deid, de_err = parse_optional_chart_account_id(
                request.company_id,
                body.get("default_expense_account_id"),
                allowed_normalized_types=ALLOWED_BILL_EXPENSE_DEBIT,
                field_label="default_expense_account_id",
            )
            if de_err:
                return JsonResponse({"detail": de_err}, status=400)
            v.default_expense_account_id = deid
        v.save()
        if "opening_balance" in body and "current_balance" not in body:
            from api.services.party_balance_sync import refresh_vendor_balance

            refresh_vendor_balance(request.company_id, v.id)
        v = (
            Vendor.objects.filter(pk=v.pk, company_id=request.company_id)
            .select_related("default_station", "default_aquaculture_pond", "default_expense_account")
            .first()
        )
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
    start_d, end_d, q = ledger_dates_and_search(request)
    data = build_vendor_ledger(
        request.company_id, vendor_id, start_date=start_d, end_date=end_d
    )
    if data.get("detail") == "Vendor not found":
        return JsonResponse(data, status=404)
    if q:
        data["transactions"] = filter_json_transactions(data.get("transactions") or [], q)
        data["search_q"] = q
        data["date_range_ignored"] = True
    return JsonResponse(data)
