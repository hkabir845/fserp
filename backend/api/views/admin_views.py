"""Admin API (Super Admin): stats, companies, users. Replaces FastAPI app.api.admin."""
import json
import logging

from django.db import transaction
from django.db.models import Case, IntegerField, Q, Sum, When
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from api.utils.auth import auth_required, get_user_from_request, user_is_super_admin
from api.models import User, Company, Customer, Vendor, Station, Invoice
from api.services.master_push import run_master_push
from api.services.tenant_backup import RESTORE_CONFIRM_PHRASE, delete_station_operational_data
from api.services.tenant_release import apply_platform_release, get_target_release

logger = logging.getLogger(__name__)


def _super_admin_required(view_func):
    """Decorator: require auth and role super_admin. Use after @auth_required so request.api_user is set."""
    def wrapped(request, *args, **kwargs):
        user = getattr(request, "api_user", None) or get_user_from_request(request)
        if not user:
            return JsonResponse({"detail": "Authentication required"}, status=401)
        if not user_is_super_admin(user):
            return JsonResponse({"detail": "Super Admin access required"}, status=403)
        return view_func(request, *args, **kwargs)
    return wrapped


@csrf_exempt
@require_GET
@auth_required
@_super_admin_required
def admin_stats(request):
    """GET /api/admin/stats - platform-wide statistics."""
    total_companies = Company.objects.filter(is_deleted=False).count()
    active_companies = Company.objects.filter(is_deleted=False, is_active=True).count()
    inactive_companies = Company.objects.filter(is_deleted=False, is_active=False).count()
    total_users = User.objects.filter(is_active=True).count()
    total_customers = Customer.objects.count()
    total_vendors = Vendor.objects.count()
    total_stations = Station.objects.count()
    total_invoices = Invoice.objects.count()
    total_sales = float((Invoice.objects.aggregate(s=Sum("total"))["s"]) or 0)
    users_by_role = {}
    for u in User.objects.filter(is_active=True).values_list("role", flat=True).distinct():
        users_by_role[u or "user"] = User.objects.filter(role=u, is_active=True).count()
    return JsonResponse({
        "total_companies": total_companies,
        "active_companies": active_companies,
        "inactive_companies": inactive_companies,
        "total_users": total_users,
        "total_customers": total_customers,
        "total_vendors": total_vendors,
        "total_stations": total_stations,
        "total_sales": total_sales,
        "total_invoices": total_invoices,
        "users_by_role": users_by_role,
    })


@csrf_exempt
@require_GET
@auth_required
@_super_admin_required
def admin_companies(request):
    """GET /api/admin/companies - list all companies with user count."""
    skip = int(request.GET.get("skip", 0))
    limit = min(int(request.GET.get("limit", 200)), 500)
    # Master tenants first so the first page always includes dev baseline even with many companies
    qs = (
        Company.objects.filter(is_deleted=False)
        .annotate(
            _master_first=Case(
                When(is_master="true", then=0),
                default=1,
                output_field=IntegerField(),
            )
        )
        .order_by("_master_first", "id")[skip : skip + limit]
    )
    target_release = get_target_release()
    result = []
    for c in qs:
        user_count = User.objects.filter(company_id=c.id, is_active=True).count()
        current_release = (getattr(c, "platform_release", None) or "").strip()
        release_behind = current_release != target_release
        applied = getattr(c, "platform_release_applied_at", None)
        result.append({
            "id": c.id,
            "name": c.name,
            "legal_name": c.legal_name or "",
            "email": c.email or "",
            "phone": c.phone or "",
            "subdomain": c.subdomain or "",
            "custom_domain": c.custom_domain or "",
            "currency": c.currency or "BDT",
            "is_active": c.is_active,
            "is_master": getattr(c, "is_master", "false") or "false",
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "user_count": user_count,
            "station_count": 0,
            "customer_count": 0,
            "contact_person": getattr(c, "contact_person", "") or "",
            "payment_type": getattr(c, "payment_type", "") or "",
            "payment_start_date": c.payment_start_date.isoformat() if getattr(c, "payment_start_date", None) and c.payment_start_date else None,
            "payment_end_date": c.payment_end_date.isoformat() if getattr(c, "payment_end_date", None) and c.payment_end_date else None,
            "payment_amount": str(c.payment_amount) if getattr(c, "payment_amount", None) is not None else None,
            "billing_plan_code": (getattr(c, "billing_plan_code", None) or "").strip().lower(),
            "date_format": getattr(c, "date_format", None) or "YYYY-MM-DD",
            "time_format": getattr(c, "time_format", None) or "HH:mm",
            "platform_release": current_release,
            "platform_target_release": target_release,
            "platform_release_applied_at": applied.isoformat() if applied else None,
            "release_behind": release_behind,
        })
    return JsonResponse(result, safe=False)


@csrf_exempt
@require_GET
@auth_required
@_super_admin_required
def admin_users(request):
    """GET /api/admin/users - list all users (Super Admin), including inactive.

    Inactive users are included so the panel matches create-user uniqueness
    (inactive rows still block duplicate username) and admins can re-enable them.
    """
    skip = int(request.GET.get("skip", 0))
    limit = min(int(request.GET.get("limit", 500)), 500)
    # Super admins first (case-insensitive role), then by id
    qs = (
        User.objects.annotate(
            _saas_sort=Case(
                When(Q(role__iexact="super_admin"), then=0),
                default=1,
                output_field=IntegerField(),
            )
        )
        .order_by("_saas_sort", "id")[skip : skip + limit]
    )
    result = []
    for u in qs:
        company_name = ""
        if u.company_id:
            co = Company.objects.filter(id=u.company_id).first()
            if co:
                company_name = co.name
        created = getattr(u, "created_at", None)
        result.append({
            "id": u.id,
            "username": u.username,
            "email": u.email or "",
            "full_name": u.full_name or "",
            "role": getattr(u, "role", "user") or "user",
            "company_id": u.company_id,
            "company_name": company_name,
            "is_active": u.is_active,
            "created_at": created.isoformat() if created else None,
        })
    return JsonResponse(result, safe=False)


@csrf_exempt
@auth_required
@_super_admin_required
def admin_master_company_protection_status(request):
    """GET /api/admin/master-company/protection-status - stub."""
    return JsonResponse({"enabled": False, "message": "Protection status not configured"})


def _parse_bool(val, default: bool = False) -> bool:
    if val is None:
        return default
    if isinstance(val, bool):
        return val
    s = str(val).strip().lower()
    if s in ("true", "1", "yes", "on"):
        return True
    if s in ("false", "0", "no", "off", ""):
        return False
    return default


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@_super_admin_required
def admin_master_company_push_updates(request):
    """
    POST /api/admin/master-company/push-updates/

    Apply platform release and/or copy template data from the Master company to one or all tenants.

    JSON body:
      - scope: "all_tenants" | "selected" (default all_tenants)
      - company_ids: list[int] — required when scope is selected (non-master companies only)
      - apply_platform_release: bool (default true)
      - sync_chart_of_accounts, sync_items, sync_tax_codes, sync_company_settings: bool (default false)

    Query string (legacy, optional): same keys as booleans for sync_* and apply_platform_release.
    """
    try:
        body = json.loads(request.body) if request.body else {}
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)

    def _from_body_or_get(key: str, default):
        if key in body:
            return body.get(key)
        return request.GET.get(key)

    scope = (body.get("scope") or request.GET.get("scope") or "all_tenants").strip()
    raw_ids = body.get("company_ids")
    if raw_ids is None and request.GET.get("company_ids"):
        raw = request.GET.get("company_ids", "")
        company_ids = [int(x) for x in raw.replace(",", " ").split() if x.strip().isdigit()]
    elif isinstance(raw_ids, list):
        company_ids = raw_ids
    elif raw_ids is None:
        company_ids = None
    else:
        return JsonResponse({"detail": "company_ids must be a list of integers"}, status=400)

    apply_platform_release_flag = _parse_bool(
        _from_body_or_get("apply_platform_release", True), True
    )
    sync_chart = _parse_bool(_from_body_or_get("sync_chart_of_accounts", False), False)
    sync_items = _parse_bool(_from_body_or_get("sync_items", False), False)
    sync_tax = _parse_bool(_from_body_or_get("sync_tax_codes", False), False)
    sync_settings = _parse_bool(_from_body_or_get("sync_company_settings", False), False)

    try:
        result = run_master_push(
            scope=scope,
            company_ids=company_ids,
            apply_platform_release_flag=apply_platform_release_flag,
            sync_chart_of_accounts=sync_chart,
            sync_items=sync_items,
            sync_tax_codes=sync_tax,
            sync_company_settings=sync_settings,
        )
    except ValueError as e:
        return JsonResponse({"detail": str(e)}, status=400)
    except Exception as e:
        logger.exception("run_master_push failed")
        return JsonResponse({"detail": "Push failed", "error": str(e)}, status=500)

    result["target_release"] = get_target_release()
    return JsonResponse(result)


@csrf_exempt
@require_GET
@auth_required
@_super_admin_required
def admin_platform_release(request):
    """GET /api/admin/platform-release/ — current deploy target tag for manual tenant rollout."""
    from fsms.release_info import APP_VERSION

    return JsonResponse(
        {
            "target_release": get_target_release(),
            "app_version": APP_VERSION,
            "manual_rollout": True,
            "hint": (
                "Test on Master Filling Station, then apply the same release tag to each tenant "
                "when ready — no automatic all-tenant upgrade."
            ),
        }
    )


@csrf_exempt
@auth_required
@_super_admin_required
def admin_company_apply_release(request, company_id: int):
    """POST /api/admin/companies/<id>/apply-release/ — promote one tenant to the platform target release."""
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    try:
        body = json.loads(request.body) if request.body else {}
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)
    override = (body.get("release") or body.get("platform_release") or "").strip()
    company = Company.objects.filter(id=company_id, is_deleted=False).first()
    if not company:
        return JsonResponse({"detail": "Company not found"}, status=404)
    try:
        result = apply_platform_release(company, override if override else None)
    except ValueError as e:
        return JsonResponse({"detail": str(e)}, status=400)
    except Exception as e:
        logger.exception("apply_platform_release failed company_id=%s", company_id)
        return JsonResponse({"detail": "Apply release failed", "error": str(e)}, status=500)
    return JsonResponse(result)


def _is_master_company_row(company: Company) -> bool:
    return str(getattr(company, "is_master", "") or "").strip().lower() in ("true", "1", "yes")


@csrf_exempt
@require_GET
@auth_required
@_super_admin_required
def admin_company_stations(request, company_id: int):
    """GET /api/admin/companies/<id>/stations/ — list stations for SaaS station purge UI."""
    company = Company.objects.filter(id=company_id, is_deleted=False).first()
    if not company:
        return JsonResponse({"detail": "Company not found"}, status=404)
    rows = []
    for s in Station.objects.filter(company_id=company_id).order_by("id"):
        rows.append(
            {
                "id": s.id,
                "station_number": getattr(s, "station_number", "") or "",
                "station_name": s.station_name or "",
                "is_active": bool(getattr(s, "is_active", True)),
            }
        )
    return JsonResponse(
        {
            "company_id": company.id,
            "company_name": company.name,
            "is_master": _is_master_company_row(company),
            "stations": rows,
        }
    )


@csrf_exempt
@require_http_methods(["POST"])
@auth_required
@_super_admin_required
def admin_company_station_purge(request, company_id: int, station_id: int):
    """
    POST /api/admin/companies/<company_id>/stations/<station_id>/purge/

    JSON body:
      - confirm_phrase: must match RESTORE_CONFIRM_PHRASE (same as tenant restore / full delete).
      - remove_station_record: optional bool (default true). If false, clears forecourt data but
        keeps the station row for re-setup.
    """
    company = Company.objects.filter(id=company_id, is_deleted=False).first()
    if not company:
        return JsonResponse({"detail": "Company not found"}, status=404)

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
                    "Station purge requires confirm_phrase in the JSON body matching "
                    f"{RESTORE_CONFIRM_PHRASE!r}."
                ),
                "expected_confirm_phrase": RESTORE_CONFIRM_PHRASE,
            },
            status=400,
        )

    remove_station = body.get("remove_station_record")
    if remove_station is None:
        remove_station = True
    elif not isinstance(remove_station, bool):
        return JsonResponse({"detail": "remove_station_record must be a boolean"}, status=400)

    actor = getattr(request, "api_user", None) or get_user_from_request(request)
    actor_id = getattr(actor, "id", None)

    try:
        with transaction.atomic():
            counts = delete_station_operational_data(
                company_id,
                station_id,
                remove_station_record=remove_station,
            )
    except ValueError as e:
        return JsonResponse({"detail": str(e)}, status=404)
    except Exception as e:
        logger.exception(
            "admin station purge failed company_id=%s station_id=%s actor_id=%s",
            company_id,
            station_id,
            actor_id,
        )
        return JsonResponse({"detail": "Station purge failed", "error": str(e)}, status=500)

    logger.info(
        "admin station purge ok company_id=%s station_id=%s actor_id=%s remove_station=%s counts=%s",
        company_id,
        station_id,
        actor_id,
        remove_station,
        counts,
    )

    return JsonResponse(
        {
            "detail": "Station operational data removed.",
            "company_id": company_id,
            "station_id": station_id,
            "remove_station_record": remove_station,
            "deleted": counts,
        }
    )
