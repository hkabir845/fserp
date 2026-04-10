"""Customers API: list, create, get, update, delete, add-dummy (company-scoped)."""
from datetime import date
from decimal import Decimal
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id
from api.models import Customer
from api.services.contact_ledgers import build_customer_ledger, ledger_query_dates


def _serialize_date(d):
    if d is None:
        return None
    return d.isoformat() if hasattr(d, "isoformat") else str(d)


def _customer_to_json(c):
    return {
        "id": c.id,
        "customer_number": c.customer_number or "",
        "display_name": c.display_name or (c.company_name or c.first_name or ""),
        "first_name": c.first_name or "",
        "company_name": c.company_name or "",
        "email": c.email or "",
        "phone": c.phone or "",
        "billing_address_line1": c.billing_address_line1 or "",
        "billing_city": c.billing_city or "",
        "billing_state": c.billing_state or "",
        "billing_country": c.billing_country or "",
        "bank_account_number": c.bank_account_number or "",
        "bank_name": c.bank_name or "",
        "bank_branch": c.bank_branch or "",
        "bank_routing_number": c.bank_routing_number or "",
        "opening_balance": str(c.opening_balance),
        "opening_balance_date": _serialize_date(c.opening_balance_date),
        "current_balance": str(c.current_balance),
        "is_active": c.is_active,
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
def customers_list(request):
    if request.method == "GET":
        qs = Customer.objects.filter(company_id=request.company_id).order_by("id")
        skip = int(request.GET.get("skip", 0))
        limit = int(request.GET.get("limit", 10000))
        qs = qs[skip : skip + limit]
        return JsonResponse([_customer_to_json(c) for c in qs], safe=False)
    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        display_name = (body.get("display_name") or "").strip()
        company_name = (body.get("company_name") or "").strip()
        first_name = (body.get("first_name") or "").strip()
        if not display_name and not company_name and not first_name:
            return JsonResponse(
                {
                    "detail": "At least one of display_name, company_name, or first_name (contact) is required"
                },
                status=400,
            )
        c = Customer(
            company_id=request.company_id,
            display_name=display_name or company_name or first_name,
            first_name=first_name,
            company_name=company_name,
            email=(body.get("email") or "")[:150],
            phone=(body.get("phone") or "")[:30],
            billing_address_line1=(body.get("billing_address_line1") or "")[:300],
            billing_city=(body.get("billing_city") or "")[:100],
            billing_state=(body.get("billing_state") or "")[:100],
            billing_country=(body.get("billing_country") or "")[:100],
            bank_account_number=(body.get("bank_account_number") or "")[:100],
            bank_name=(body.get("bank_name") or "")[:200],
            bank_branch=(body.get("bank_branch") or "")[:200],
            bank_routing_number=(body.get("bank_routing_number") or "")[:64],
            opening_balance=_decimal(body.get("opening_balance")),
            opening_balance_date=_parse_date(body.get("opening_balance_date")),
            current_balance=_decimal(
                body.get("current_balance"), _decimal(body.get("opening_balance"))
            ),
            is_active=bool(body.get("is_active", True)),
        )
        c.save()
        if not c.customer_number:
            c.customer_number = f"CUST-{c.id}"
            Customer.objects.filter(pk=c.pk).update(customer_number=c.customer_number)
        return JsonResponse(_customer_to_json(c), status=201)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def customers_add_dummy(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    try:
        company_id = request.company_id
        count = Customer.objects.filter(company_id=company_id).count()
        c = Customer(
            company_id=company_id,
            customer_number=f"CUST-{count + 1}",
            display_name=f"Customer {count + 1}",
            company_name=f"Company {count + 1}",
            current_balance=Decimal("0"),
            is_active=True,
        )
        c.save()
        # Frontend expects an array (e.g. for "Added N dummy customers")
        return JsonResponse([_customer_to_json(c)], status=201, safe=False)
    except Exception as e:
        return JsonResponse(
            {"detail": "Failed to add dummy customer", "error": str(e)},
            status=500,
        )


@csrf_exempt
@auth_required
@require_company_id
def customer_detail(request, customer_id: int):
    c = Customer.objects.filter(id=customer_id, company_id=request.company_id).first()
    if not c:
        return JsonResponse({"detail": "Customer not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_customer_to_json(c))
    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err
        if "display_name" in body:
            c.display_name = (body.get("display_name") or "")[:200]
        if "first_name" in body:
            c.first_name = (body.get("first_name") or "")[:100]
        if "company_name" in body:
            c.company_name = (body.get("company_name") or "")[:200]
        if "email" in body:
            c.email = (body.get("email") or "")[:150]
        if "phone" in body:
            c.phone = (body.get("phone") or "")[:30]
        if "billing_address_line1" in body:
            c.billing_address_line1 = (body.get("billing_address_line1") or "")[:300]
        if "billing_city" in body:
            c.billing_city = (body.get("billing_city") or "")[:100]
        if "billing_state" in body:
            c.billing_state = (body.get("billing_state") or "")[:100]
        if "billing_country" in body:
            c.billing_country = (body.get("billing_country") or "")[:100]
        if "bank_account_number" in body:
            c.bank_account_number = (body.get("bank_account_number") or "")[:100]
        if "bank_name" in body:
            c.bank_name = (body.get("bank_name") or "")[:200]
        if "bank_branch" in body:
            c.bank_branch = (body.get("bank_branch") or "")[:200]
        if "bank_routing_number" in body:
            c.bank_routing_number = (body.get("bank_routing_number") or "")[:64]
        if "opening_balance" in body:
            c.opening_balance = _decimal(body.get("opening_balance"), c.opening_balance)
        if "opening_balance_date" in body:
            c.opening_balance_date = _parse_date(body.get("opening_balance_date"))
        if "current_balance" in body:
            c.current_balance = _decimal(body.get("current_balance"), c.current_balance)
        if "is_active" in body:
            c.is_active = bool(body["is_active"])
        c.save()
        return JsonResponse(_customer_to_json(c))
    if request.method == "DELETE":
        c.delete()
        return JsonResponse({"detail": "Deleted"}, status=200)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def customer_ledger(request, customer_id: int):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    start_d, end_d = ledger_query_dates(request)
    data = build_customer_ledger(
        request.company_id, customer_id, start_date=start_d, end_date=end_d
    )
    if data.get("detail") == "Customer not found":
        return JsonResponse(data, status=404)
    return JsonResponse(data)
