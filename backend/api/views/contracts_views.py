"""Contracts API (Super Admin): list, create, get, update, delete."""
import json
from datetime import date
from decimal import Decimal
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import csrf_exempt

from api.utils.auth import auth_required, get_user_from_request, user_is_super_admin
from api.models import Contract, Company


def _super_admin_required(view_func):
    def wrapped(request, *args, **kwargs):
        user = getattr(request, "api_user", None) or get_user_from_request(request)
        if not user:
            return JsonResponse({"detail": "Authentication required"}, status=401)
        if not user_is_super_admin(user):
            return JsonResponse({"detail": "Super Admin access required"}, status=403)
        return view_func(request, *args, **kwargs)
    return wrapped


def _company_has_other_active_contract(company_id: int, exclude_contract_id: int | None = None) -> bool:
    """True if company already has another contract that is active (commercially in force)."""
    qs = Contract.objects.filter(
        company_id=company_id,
        status__iexact="active",
        is_active=True,
    )
    if exclude_contract_id is not None:
        qs = qs.exclude(id=exclude_contract_id)
    return qs.exists()


def _next_contract_number():
    """Generate next contract number: CON-YYYY-NNNN."""
    today = date.today()
    prefix = f"CON-{today.year}-"
    last = Contract.objects.filter(contract_number__startswith=prefix).order_by("-contract_number").first()
    if not last:
        num = 1
    else:
        try:
            num = int(last.contract_number.split("-")[-1]) + 1
        except (IndexError, ValueError):
            num = 1
    return f"{prefix}{num:04d}"


def _contract_to_json(c: Contract) -> dict:
    return {
        "id": c.id,
        "contract_number": c.contract_number,
        "company_id": c.company_id,
        "company_name": c.company.name if c.company_id else "",
        "contract_date": c.contract_date.isoformat() if c.contract_date else "",
        "expiry_date": c.expiry_date.isoformat() if c.expiry_date else "",
        "duration_months": c.duration_months,
        "duration_years": c.duration_years,
        "status": c.status or "draft",
        "license_type": c.license_type or "",
        "billing_period": c.billing_period or "monthly",
        "amount_per_month": float(c.amount_per_month) if c.amount_per_month is not None else None,
        "amount_per_year": float(c.amount_per_year) if c.amount_per_year is not None else None,
        "currency": c.currency or "BDT",
        "total_contract_value": float(c.total_contract_value) if c.total_contract_value is not None else 0,
        "broadcast_message": c.broadcast_message or "",
        "payment_reminder_message": c.payment_reminder_message or "",
        "terms_and_conditions": c.terms_and_conditions or "",
        "notes": c.notes or "",
        "auto_renewal": c.auto_renewal or "false",
        "is_active": c.is_active,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


@csrf_exempt
@auth_required
@_super_admin_required
def contracts_list(request):
    """GET /api/contracts/ - list all contracts."""
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    qs = Contract.objects.select_related("company").order_by("-created_at")
    return JsonResponse([_contract_to_json(c) for c in qs], safe=False)


@csrf_exempt
@auth_required
@_super_admin_required
def contracts_list_or_create(request):
    """GET /api/contracts/ list, POST /api/contracts/ create."""
    if request.method == "GET":
        qs = Contract.objects.select_related("company").order_by("-created_at")
        return JsonResponse([_contract_to_json(c) for c in qs], safe=False)
    if request.method == "POST":
        return _contract_create(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


def _contract_create(request):
    """Create contract (internal, called from contracts_list_or_create)."""
    try:
        body = json.loads(request.body) if request.body else {}
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)
    company_id = body.get("company_id")
    if company_id is None:
        return JsonResponse({"detail": "company_id required"}, status=400)
    company = Company.objects.filter(id=company_id, is_deleted=False).first()
    if not company:
        return JsonResponse({"detail": "Company not found"}, status=404)
    status_in = str(body.get("status") or "draft").strip().lower()
    if status_in == "active" and _company_has_other_active_contract(company_id):
        return JsonResponse(
            {
                "detail": (
                    "This company already has an active contract. "
                    "Set the existing one to renewed, expired, or cancelled before creating another active contract, "
                    "or save this one as draft first."
                )
            },
            status=409,
        )
    contract_number = _next_contract_number()
    total = body.get("total_contract_value")
    if total is not None:
        total = Decimal(str(total))
    else:
        total = Decimal("0")
    c = Contract(
        contract_number=contract_number,
        company_id=company_id,
        contract_date=body.get("contract_date") or date.today().isoformat(),
        expiry_date=body.get("expiry_date") or date.today().isoformat(),
        duration_months=body.get("duration_months"),
        duration_years=body.get("duration_years"),
        status=body.get("status") or "draft",
        license_type=body.get("license_type") or "",
        billing_period=body.get("billing_period") or "monthly",
        amount_per_month=Decimal(str(v)) if (v := body.get("amount_per_month")) is not None else None,
        amount_per_year=Decimal(str(v)) if (v := body.get("amount_per_year")) is not None else None,
        currency=body.get("currency") or "BDT",
        total_contract_value=total,
        broadcast_message=body.get("broadcast_message") or "",
        payment_reminder_message=body.get("payment_reminder_message") or "",
        terms_and_conditions=body.get("terms_and_conditions") or "",
        notes=body.get("notes") or "",
        auto_renewal=body.get("auto_renewal") or "false",
    )
    c.save()
    return JsonResponse(_contract_to_json(c), status=201)


@csrf_exempt
@auth_required
@_super_admin_required
def contract_detail(request, contract_id: int):
    """GET / PUT / PATCH / DELETE /api/contracts/<id>/."""
    c = Contract.objects.filter(id=contract_id).select_related("company").first()
    if not c:
        return JsonResponse({"detail": "Contract not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_contract_to_json(c))
    if request.method in ("PUT", "PATCH"):
        return _contract_update(request, contract_id)
    if request.method == "DELETE":
        return _contract_delete(request, contract_id)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


def _contract_update(request, contract_id: int):
    """Update contract (internal)."""
    c = Contract.objects.filter(id=contract_id).select_related("company").first()
    if not c:
        return JsonResponse({"detail": "Contract not found"}, status=404)
    try:
        body = json.loads(request.body) if request.body else {}
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)
    if "contract_date" in body:
        c.contract_date = body["contract_date"]
    if "expiry_date" in body:
        c.expiry_date = body["expiry_date"]
    if "duration_months" in body:
        c.duration_months = body["duration_months"]
    if "duration_years" in body:
        c.duration_years = body["duration_years"]
    if "status" in body:
        c.status = body["status"]
    if "license_type" in body:
        c.license_type = body["license_type"] or ""
    if "billing_period" in body:
        c.billing_period = body["billing_period"]
    if "amount_per_month" in body:
        c.amount_per_month = Decimal(str(body["amount_per_month"])) if body["amount_per_month"] is not None else None
    if "amount_per_year" in body:
        c.amount_per_year = Decimal(str(body["amount_per_year"])) if body["amount_per_year"] is not None else None
    if "currency" in body:
        c.currency = body["currency"]
    if "total_contract_value" in body:
        c.total_contract_value = Decimal(str(body["total_contract_value"]))
    if "broadcast_message" in body:
        c.broadcast_message = body["broadcast_message"] or ""
    if "payment_reminder_message" in body:
        c.payment_reminder_message = body["payment_reminder_message"] or ""
    if "terms_and_conditions" in body:
        c.terms_and_conditions = body["terms_and_conditions"] or ""
    if "notes" in body:
        c.notes = body["notes"] or ""
    if "auto_renewal" in body:
        c.auto_renewal = body["auto_renewal"] or "false"
    new_status = str(c.status or "draft").strip().lower()
    if new_status == "active" and _company_has_other_active_contract(c.company_id, exclude_contract_id=c.id):
        return JsonResponse(
            {
                "detail": (
                    "This company already has another active contract. "
                    "Close or change the other contract before setting this one to active."
                )
            },
            status=409,
        )
    c.save()
    return JsonResponse(_contract_to_json(c))


def _contract_delete(request, contract_id: int):
    """DELETE /api/contracts/<id>/ - delete contract."""
    c = Contract.objects.filter(id=contract_id).first()
    if not c:
        return JsonResponse({"detail": "Contract not found"}, status=404)
    c.delete()
    return JsonResponse({"detail": "Contract deleted"}, status=200)


@csrf_exempt
@auth_required
@_super_admin_required
def contract_print(request, contract_id: int):
    """GET /api/contracts/<id>/print - return contract data for printing (PDF/stub)."""
    c = Contract.objects.filter(id=contract_id).select_related("company").first()
    if not c:
        return JsonResponse({"detail": "Contract not found"}, status=404)
    return JsonResponse(_contract_to_json(c))
