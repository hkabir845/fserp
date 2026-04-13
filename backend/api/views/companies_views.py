"""Companies API: current company (GET), and CRUD for super admin (POST/PUT/DELETE /companies/)."""
import json
import logging
from datetime import date
from decimal import Decimal
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from django.views.decorators.csrf import csrf_exempt
from api.utils.auth import (
    auth_required,
    company_context_error_response,
    get_user_from_request,
    get_company_id,
    user_is_super_admin,
)
from api.models import Company, User
from api.chart_templates.fuel_station import seed_fuel_station_if_empty
from api.services.tenant_backup import RESTORE_CONFIRM_PHRASE, delete_tenant_company_data
from api.services.tenant_release import get_target_release

logger = logging.getLogger(__name__)

ALLOWED_DATE_FORMATS = frozenset({"YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "DD-MM-YYYY"})
ALLOWED_TIME_FORMATS = frozenset({"HH:mm", "hh:mm A"})


def _normalize_subdomain(val) -> str:
    s = (val or "").strip().lower()
    return s[:100] if s else ""


def _normalize_custom_domain(val) -> str:
    s = (val or "").strip().lower()
    return s[:255] if s else ""


def _subdomain_taken(subdomain: str, exclude_company_id: int | None = None) -> bool:
    if not subdomain:
        return False
    qs = Company.objects.filter(is_deleted=False, subdomain__iexact=subdomain)
    if exclude_company_id is not None:
        qs = qs.exclude(id=exclude_company_id)
    return qs.exists()


def _custom_domain_taken(domain: str, exclude_company_id: int | None = None) -> bool:
    if not domain:
        return False
    qs = Company.objects.filter(is_deleted=False, custom_domain__iexact=domain)
    if exclude_company_id is not None:
        qs = qs.exclude(id=exclude_company_id)
    return qs.exists()


def _coerce_date_format(value) -> str:
    s = str(value or "").strip()
    return s if s in ALLOWED_DATE_FORMATS else "YYYY-MM-DD"


def _coerce_time_format(value) -> str:
    s = str(value or "").strip()
    return s if s in ALLOWED_TIME_FORMATS else "HH:mm"


def _is_master_company(c: Company) -> bool:
    return str(getattr(c, "is_master", "") or "").strip().lower() in ("true", "1", "yes")


def _role_normalized(user: User) -> str:
    return (getattr(user, "role", None) or "").strip().lower().replace(" ", "_").replace("-", "_")


def _maybe_reclaim_admin_username(admin_email: str) -> tuple[JsonResponse | None, bool]:
    """
    If the admin login is taken only by leftover tenant users (soft-deleted company or missing
    company row), purge that data so a new company can be created with the same email.

    Returns (error JsonResponse or None, reclaimed_bool).
    """
    existing = User.objects.filter(username__iexact=admin_email).first()
    if not existing:
        return None, False

    if _role_normalized(existing) in ("super_admin", "superadmin"):
        return (
            JsonResponse(
                {
                    "detail": (
                        f"The login '{admin_email}' is already used by a platform super admin. "
                        "Choose a different administrator email for the new company."
                    ),
                },
                status=400,
            ),
            False,
        )

    cid = getattr(existing, "company_id", None)
    if cid is None:
        return (
            JsonResponse(
                {
                    "detail": (
                        f"A user with login '{admin_email}' already exists without a tenant. "
                        "Use a different administrator email or remove that user first."
                    ),
                },
                status=400,
            ),
            False,
        )

    co = Company.objects.filter(id=cid).first()
    if co is None:
        deleted_n, _ = User.objects.filter(company_id=cid).delete()
        logger.info(
            "reclaim admin username: removed %s orphan user row(s) for missing company_id=%s",
            deleted_n,
            cid,
        )
        return None, True

    if getattr(co, "is_deleted", False):
        if _is_master_company(co):
            return (
                JsonResponse(
                    {
                        "detail": "That login belongs to a soft-deleted master company record; it cannot be auto-removed.",
                    },
                    status=400,
                ),
                False,
            )
        try:
            delete_tenant_company_data(cid)
        except Exception as e:
            logger.exception("reclaim admin username: delete_tenant_company_data failed for company_id=%s", cid)
            return (
                JsonResponse(
                    {
                        "detail": "Could not clear leftover data from a previously deleted company. Try again or contact support.",
                        "error": str(e),
                    },
                    status=500,
                ),
                False,
            )
        logger.info(
            "reclaim admin username: purged soft-deleted tenant company_id=%s for reuse of %s",
            cid,
            admin_email,
        )
        return None, True

    return (
        JsonResponse(
            {
                "detail": (
                    f"A user with login '{admin_email}' already exists for an active company "
                    "(ID {cid}). Use another administrator email, remove that user, or permanently delete the tenant first."
                ),
            },
            status=400,
        ),
        False,
    )


def _super_admin_required(view_func):
    def wrapped(request, *args, **kwargs):
        user = getattr(request, "api_user", None) or get_user_from_request(request)
        if not user:
            return JsonResponse({"detail": "Authentication required"}, status=401)
        if not user_is_super_admin(user):
            return JsonResponse({"detail": "Super Admin access required"}, status=403)
        return view_func(request, *args, **kwargs)
    return wrapped


def _company_to_json(c: Company) -> dict:
    def _date_iso(attr):
        val = getattr(c, attr, None)
        return val.isoformat() if val else None
    def _decimal_str(attr):
        val = getattr(c, attr, None)
        return str(val) if val is not None else None
    parts = [getattr(c, "address_line1", "") or "", getattr(c, "city", "") or "", getattr(c, "state", "") or "", getattr(c, "postal_code", "") or "", getattr(c, "country", "") or ""]
    address = ", ".join(p for p in parts if p).strip() or None
    return {
        "id": c.id,
        "name": c.name,
        "company_name": c.name,
        "legal_name": c.legal_name or "",
        "tax_id": getattr(c, "tax_id", "") or "",
        "email": c.email or "",
        "phone": c.phone or "",
        "address": address,
        "address_line1": getattr(c, "address_line1", "") or "",
        "address_line2": getattr(c, "address_line2", "") or "",
        "city": getattr(c, "city", "") or "",
        "state": getattr(c, "state", "") or "",
        "postal_code": getattr(c, "postal_code", "") or "",
        "country": getattr(c, "country", "") or "",
        "fiscal_year_start": (getattr(c, "fiscal_year_start", None) or "01-01")[:5],
        "subdomain": c.subdomain or "",
        "custom_domain": c.custom_domain or "",
        "currency": c.currency or "BDT",
        "is_active": c.is_active,
        "is_master": getattr(c, "is_master", "false") or "false",
        "contact_person": getattr(c, "contact_person", "") or "",
        "payment_type": getattr(c, "payment_type", "") or "",
        "payment_start_date": _date_iso("payment_start_date"),
        "payment_end_date": _date_iso("payment_end_date"),
        "payment_amount": _decimal_str("payment_amount"),
        "billing_plan_code": (getattr(c, "billing_plan_code", None) or "").strip().lower(),
        "date_format": _coerce_date_format(getattr(c, "date_format", None)),
        "time_format": _coerce_time_format(getattr(c, "time_format", None)),
    }


@auth_required
@require_GET
def companies_current(request):
    """Return tenant-scoped company: same rules as ERP APIs (X-Selected-Company-Id for super_admin)."""
    cid = get_company_id(request)
    err = company_context_error_response(request)
    if err:
        return err
    company = Company.objects.filter(id=cid, is_deleted=False).first() if cid else None
    if not company:
        return JsonResponse({
            "id": 1,
            "name": "Default Company",
            "company_name": "Default Company",
            "currency": "BDT",
            "date_format": "YYYY-MM-DD",
            "time_format": "HH:mm",
        })
    return JsonResponse(_company_to_json(company))


@csrf_exempt
@auth_required
@_super_admin_required
def companies_list_or_create(request):
    """POST /api/companies/ - create company (super admin only). GET not supported here; use /api/admin/companies/."""
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    try:
        body = json.loads(request.body) if request.body else {}
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)
    name = (body.get("company_name") or body.get("name") or "").strip()
    if not name:
        return JsonResponse({"detail": "Company name is required"}, status=400)

    admin_email = (body.get("admin_email") or body.get("company_admin_email") or "").strip()
    admin_password = body.get("admin_password") or body.get("company_admin_password") or ""
    admin_full_name = (body.get("admin_full_name") or body.get("company_admin_full_name") or "").strip()

    if not admin_email:
        return JsonResponse(
            {"detail": "Company administrator email is required (used as login username)."},
            status=400,
        )
    if not admin_password or len(str(admin_password)) < 6:
        return JsonResponse(
            {"detail": "Company administrator password is required (minimum 6 characters)."},
            status=400,
        )

    display_name = admin_full_name or (body.get("contact_person") or "").strip() or name

    skip_coa = bool(
        body.get("skip_chart_of_accounts")
        or body.get("skip_chart_of_accounts_template")
    )
    coa_profile = (body.get("chart_of_accounts_profile") or body.get("coa_profile") or "full").strip().lower()
    if coa_profile not in ("full", "retail"):
        coa_profile = "full"

    sub_norm = _normalize_subdomain(body.get("subdomain"))
    dom_norm = _normalize_custom_domain(body.get("custom_domain"))
    if sub_norm and _subdomain_taken(sub_norm):
        return JsonResponse(
            {"detail": f"Subdomain '{sub_norm}' is already used by another company."},
            status=409,
        )
    if dom_norm and _custom_domain_taken(dom_norm):
        return JsonResponse(
            {"detail": f"Custom domain '{dom_norm}' is already used by another company."},
            status=409,
        )

    reclaim_err, reclaimed_stale = _maybe_reclaim_admin_username(admin_email)
    if reclaim_err:
        return reclaim_err

    try:
        with transaction.atomic():
            c = Company(
                name=name,
                legal_name=body.get("legal_name") or "",
                email=(body.get("email") or "")[:100],
                phone=body.get("phone") or "",
                subdomain=sub_norm,
                custom_domain=dom_norm,
                currency=body.get("currency") or "BDT",
                is_active=body.get("is_active", True),
                contact_person=body.get("contact_person") or "",
                payment_type=body.get("payment_type") or "",
            )
            if body.get("payment_start_date"):
                try:
                    c.payment_start_date = date.fromisoformat(body["payment_start_date"].split("T")[0])
                except (TypeError, ValueError):
                    pass
            if body.get("payment_end_date"):
                try:
                    c.payment_end_date = date.fromisoformat(body["payment_end_date"].split("T")[0])
                except (TypeError, ValueError):
                    pass
            if body.get("payment_amount") is not None and body.get("payment_amount") != "":
                try:
                    c.payment_amount = Decimal(str(body["payment_amount"]))
                except (TypeError, ValueError):
                    pass
            if "billing_plan_code" in body:
                c.billing_plan_code = (str(body.get("billing_plan_code") or "").strip().lower())[:32]
            c.platform_release = get_target_release()[:64]
            c.save()

            chart_of_accounts_result = None
            if not skip_coa:
                chart_of_accounts_result = seed_fuel_station_if_empty(c.id, profile=coa_profile)

            owner = User(
                username=admin_email,
                email=admin_email,
                full_name=display_name[:255],
                role="admin",
                company_id=c.id,
                is_active=True,
            )
            owner.set_password(str(admin_password))
            owner.save()

        payload = _company_to_json(c)
        payload["company_admin"] = {
            "email": admin_email,
            "full_name": display_name,
            "role": "admin",
            "message": "Company owner can log in with this email, then add Cashiers, Accountants, and change passwords.",
        }
        if reclaimed_stale:
            payload["reclaimed_stale_tenant"] = True
        if chart_of_accounts_result is not None:
            payload["chart_of_accounts"] = chart_of_accounts_result
        return JsonResponse(payload, status=201)
    except Exception as e:
        logger.exception("create company with admin failed")
        return JsonResponse(
            {"detail": "Failed to create company", "error": str(e)},
            status=500,
        )


@csrf_exempt
@auth_required
def company_detail(request, company_id: int):
    """GET /api/companies/<id>/ - get one. PUT - update. DELETE - permanent removal (requires confirm_phrase). Super admin for create/delete; super admin or own company for update."""
    company = Company.objects.filter(id=company_id).first()
    if not company:
        return JsonResponse({"detail": "Company not found"}, status=404)
    if company.is_deleted:
        return JsonResponse({"detail": "Company not found"}, status=404)

    if request.method == "GET":
        return JsonResponse(_company_to_json(company))

    if request.method == "PUT":
        user = getattr(request, "api_user", None) or get_user_from_request(request)
        if not user:
            return JsonResponse({"detail": "Authentication required"}, status=401)
        is_super = user_is_super_admin(user)
        if not is_super and getattr(user, "company_id", None) != company_id:
            return JsonResponse({"detail": "Permission denied"}, status=403)
        try:
            body = json.loads(request.body) if request.body else {}
        except json.JSONDecodeError:
            return JsonResponse({"detail": "Invalid JSON"}, status=400)
        if not isinstance(body, dict):
            body = {}
        try:
            if "company_name" in body:
                company.name = (body["company_name"] or "").strip() or company.name
            if "name" in body:
                company.name = (body["name"] or "").strip() or company.name
            if "legal_name" in body:
                company.legal_name = (body["legal_name"] or "")[:200]
            if "tax_id" in body:
                company.tax_id = (str(body.get("tax_id") or ""))[:50]
            if "address_line1" in body:
                company.address_line1 = (str(body.get("address_line1") or ""))[:200]
            if "address_line2" in body:
                company.address_line2 = (str(body.get("address_line2") or ""))[:200]
            if "city" in body:
                company.city = (str(body.get("city") or ""))[:100]
            if "state" in body:
                company.state = (str(body.get("state") or ""))[:50]
            if "postal_code" in body:
                company.postal_code = (str(body.get("postal_code") or ""))[:20]
            if "country" in body:
                company.country = (str(body.get("country") or ""))[:50]
            if "fiscal_year_start" in body:
                fy = (str(body.get("fiscal_year_start") or "01-01")).strip()[:5]
                company.fiscal_year_start = fy if fy else "01-01"
            if "email" in body:
                company.email = (body["email"] or "")[:100]
            if "phone" in body:
                company.phone = (body["phone"] or "")[:20]
            if "subdomain" in body:
                sub_norm = _normalize_subdomain(body.get("subdomain"))
                if sub_norm and _subdomain_taken(sub_norm, exclude_company_id=company.id):
                    return JsonResponse(
                        {"detail": f"Subdomain '{sub_norm}' is already used by another company."},
                        status=409,
                    )
                company.subdomain = sub_norm
            if "custom_domain" in body:
                dom_norm = _normalize_custom_domain(body.get("custom_domain"))
                if dom_norm and _custom_domain_taken(dom_norm, exclude_company_id=company.id):
                    return JsonResponse(
                        {"detail": f"Custom domain '{dom_norm}' is already used by another company."},
                        status=409,
                    )
                company.custom_domain = dom_norm
            if "currency" in body:
                company.currency = (body["currency"] or "BDT")[:3]
            if "date_format" in body:
                company.date_format = _coerce_date_format(body.get("date_format"))[:32]
            if "time_format" in body:
                company.time_format = _coerce_time_format(body.get("time_format"))[:32]
            if "is_active" in body:
                company.is_active = bool(body["is_active"])
            if "contact_person" in body:
                company.contact_person = (body["contact_person"] or "")[:200]
            if "payment_type" in body:
                company.payment_type = (body["payment_type"] or "")[:32]
            if "payment_start_date" in body:
                if body["payment_start_date"]:
                    try:
                        company.payment_start_date = date.fromisoformat(str(body["payment_start_date"]).split("T")[0])
                    except (TypeError, ValueError):
                        pass
                else:
                    company.payment_start_date = None
            if "payment_end_date" in body:
                if body["payment_end_date"]:
                    try:
                        company.payment_end_date = date.fromisoformat(str(body["payment_end_date"]).split("T")[0])
                    except (TypeError, ValueError):
                        pass
                else:
                    company.payment_end_date = None
            if "payment_amount" in body:
                if body["payment_amount"] is not None and body["payment_amount"] != "":
                    try:
                        company.payment_amount = Decimal(str(body["payment_amount"]))
                    except (TypeError, ValueError):
                        pass
                else:
                    company.payment_amount = None
            if "billing_plan_code" in body:
                company.billing_plan_code = (str(body.get("billing_plan_code") or "").strip().lower())[:32]
            company.save()
            return JsonResponse(_company_to_json(company))
        except Exception as e:
            return JsonResponse(
                {"detail": "Failed to update company", "error": str(e)},
                status=500,
            )

    if request.method == "DELETE":
        user = getattr(request, "api_user", None) or get_user_from_request(request)
        if not user:
            return JsonResponse({"detail": "Authentication required"}, status=401)
        if not user_is_super_admin(user):
            return JsonResponse({"detail": "Super Admin access required"}, status=403)
        if _is_master_company(company):
            return JsonResponse(
                {"detail": "The master company cannot be permanently deleted."},
                status=403,
            )
        try:
            body = json.loads(request.body) if request.body else {}
        except json.JSONDecodeError:
            return JsonResponse({"detail": "Invalid JSON"}, status=400)
        if not isinstance(body, dict):
            body = {}
        phrase = (body.get("confirm_phrase") or body.get("confirm") or "").strip()
        if phrase != RESTORE_CONFIRM_PHRASE:
            return JsonResponse(
                {
                    "detail": (
                        "Permanent removal requires confirm_phrase in the JSON body matching "
                        f"{RESTORE_CONFIRM_PHRASE!r}. Prefer deactivating the company (POST .../deactivate/) "
                        "to suspend access without deleting data."
                    ),
                    "expected_confirm_phrase": RESTORE_CONFIRM_PHRASE,
                },
                status=400,
            )
        try:
            with transaction.atomic():
                delete_tenant_company_data(company_id)
        except Exception as e:
            logger.exception("permanent company delete failed")
            return JsonResponse(
                {"detail": "Failed to remove company data", "error": str(e)},
                status=500,
            )
        return JsonResponse(
            {
                "detail": "Company and all related data were permanently removed.",
                "removed_company_id": company_id,
            },
            status=200,
        )

    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
def company_deactivate(request, company_id: int):
    """POST — set company inactive (suspend tenant); does not delete data. Super admin only."""
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    user = getattr(request, "api_user", None) or get_user_from_request(request)
    if not user or not user_is_super_admin(user):
        return JsonResponse({"detail": "Super Admin access required"}, status=403)
    company = Company.objects.filter(id=company_id, is_deleted=False).first()
    if not company:
        return JsonResponse({"detail": "Company not found"}, status=404)
    if _is_master_company(company):
        return JsonResponse(
            {"detail": "The master company cannot be deactivated."},
            status=403,
        )
    company.is_active = False
    company.save(update_fields=["is_active", "updated_at"])
    return JsonResponse({**_company_to_json(company), "detail": "Company deactivated."})


@csrf_exempt
@auth_required
def company_activate(request, company_id: int):
    """POST — re-enable a deactivated company. Super admin only."""
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    user = getattr(request, "api_user", None) or get_user_from_request(request)
    if not user or not user_is_super_admin(user):
        return JsonResponse({"detail": "Super Admin access required"}, status=403)
    company = Company.objects.filter(id=company_id, is_deleted=False).first()
    if not company:
        return JsonResponse({"detail": "Company not found"}, status=404)
    company.is_active = True
    company.save(update_fields=["is_active", "updated_at"])
    return JsonResponse({**_company_to_json(company), "detail": "Company activated."})

