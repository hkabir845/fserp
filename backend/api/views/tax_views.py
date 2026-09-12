"""Taxes API: list, create, get, update, delete, rates CRUD, init-bangladesh (company-scoped)."""
from datetime import date
from decimal import Decimal, InvalidOperation
from django.core.exceptions import ValidationError
from django.core.validators import DecimalValidator
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id, require_permission
from api.models import Tax, TaxRate


def _serialize_date(d):
    if d is None:
        return None
    return d.isoformat() if hasattr(d, "isoformat") else str(d)


def _tax_to_json(t):
    rates = list(t.rates.all().order_by("-effective_from")[:10])
    return {
        "id": t.id,
        "name": t.name,
        "description": t.description or "",
        "is_active": t.is_active,
        "rates": [
            {
                "id": r.id,
                "rate": str(r.rate),
                "effective_from": _serialize_date(r.effective_from),
                "effective_to": _serialize_date(r.effective_to),
            }
            for r in rates
        ],
    }


def _parse_date(val):
    if not val:
        return None
    try:
        return date.fromisoformat(str(val).split("T")[0])
    except Exception:
        return None


@csrf_exempt
@auth_required
@require_company_id
@require_permission("app.page.tax", methods=("POST",))
def taxes_list_or_create(request):
    if request.method == "GET":
        qs = Tax.objects.filter(company_id=request.company_id).prefetch_related("rates").order_by("id")
        return JsonResponse([_tax_to_json(t) for t in qs], safe=False)
    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        name = (body.get("name") or "").strip()
        if not name:
            return JsonResponse({"detail": "name is required"}, status=400)
        if Tax.objects.filter(company_id=request.company_id, name__iexact=name).exists():
            return JsonResponse(
                {"detail": f"A tax named '{name}' already exists for this company."},
                status=409,
            )
        t = Tax(
            company_id=request.company_id,
            name=name,
            description=body.get("description") or "",
            is_active=body.get("is_active", True),
        )
        t.save()
        return JsonResponse(_tax_to_json(t), status=201)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
@require_permission("app.page.tax", methods=("PUT", "PATCH", "DELETE",))
def tax_detail(request, tax_id: int):
    t = Tax.objects.filter(id=tax_id, company_id=request.company_id).prefetch_related("rates").first()
    if not t:
        return JsonResponse({"detail": "Tax not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_tax_to_json(t))
    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err
        if body.get("name"):
            new_name = (body.get("name") or "").strip() or t.name
            if (
                new_name
                and Tax.objects.filter(company_id=request.company_id, name__iexact=new_name)
                .exclude(id=t.id)
                .exists()
            ):
                return JsonResponse(
                    {"detail": f"A tax named '{new_name}' already exists for this company."},
                    status=409,
                )
            t.name = new_name
        if "description" in body:
            t.description = body.get("description") or ""
        if "is_active" in body:
            t.is_active = bool(body["is_active"])
        t.save()
        return JsonResponse(_tax_to_json(t))
    if request.method == "DELETE":
        t.delete()
        return JsonResponse({"detail": "Deleted"}, status=200)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
@require_permission("app.page.tax")
def tax_rates_create(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    body, err = parse_json_body(request)
    if err:
        return err
    raw_tax_id = body.get("tax_id")
    try:
        if isinstance(raw_tax_id, bool) or not isinstance(raw_tax_id, (int, str)):
            raise ValueError
        tax_id = int(raw_tax_id)
        if not 0 < tax_id <= 9223372036854775807:
            raise ValueError
    except (TypeError, ValueError):
        return JsonResponse({"detail": "Valid tax_id required"}, status=400)
    if not Tax.objects.filter(id=tax_id, company_id=request.company_id).exists():
        return JsonResponse({"detail": "Valid tax_id required"}, status=400)

    try:
        rate = Decimal(str(body.get("rate")))
        if not rate.is_finite() or not Decimal("0") <= rate <= Decimal("100"):
            raise ValueError
        DecimalValidator(max_digits=7, decimal_places=4)(rate)
    except (InvalidOperation, ValueError, ValidationError):
        return JsonResponse(
            {"detail": "Rate must be between 0 and 100 with at most 4 decimal places."}, status=400,
        )

    dates = {}
    for field in ("effective_from", "effective_to"):
        value = body.get(field)
        dates[field] = _parse_date(value)
        if value not in (None, "") and dates[field] is None:
            return JsonResponse({"detail": f"{field} must be a valid date."}, status=400)
    if dates["effective_from"] and dates["effective_to"] and dates["effective_to"] < dates["effective_from"]:
        return JsonResponse({"detail": "effective_to must not precede effective_from."}, status=400)
    r = TaxRate(
        tax_id=tax_id,
        rate=rate,
        **dates,
    )
    r.save()
    return JsonResponse({"id": r.id, "rate": str(r.rate), "effective_from": _serialize_date(r.effective_from), "effective_to": _serialize_date(r.effective_to)}, status=201)


@csrf_exempt
@auth_required
@require_company_id
@require_permission("app.page.tax")
def tax_rate_delete(request, rate_id: int):
    if request.method != "DELETE":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    r = TaxRate.objects.filter(id=rate_id, tax__company_id=request.company_id).first()
    if not r:
        return JsonResponse({"detail": "Tax rate not found"}, status=404)
    r.delete()
    return JsonResponse({"detail": "Deleted"}, status=200)


@csrf_exempt
@auth_required
@require_company_id
@require_permission("app.page.tax")
def tax_init_bangladesh(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    t, _ = Tax.objects.get_or_create(
        company_id=request.company_id,
        name="VAT",
        defaults={"description": "Value Added Tax (Bangladesh)", "is_active": True},
    )
    if not t.rates.exists():
        TaxRate.objects.create(tax=t, rate=Decimal("15.0000"), effective_from=date.today())
    return JsonResponse(_tax_to_json(t))
