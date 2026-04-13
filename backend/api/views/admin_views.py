"""Admin API (Super Admin): stats, companies, users. Replaces FastAPI app.api.admin."""
import json
import logging

from django.db.models import Case, IntegerField, Q, Sum, When
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from api.utils.auth import auth_required, get_user_from_request, user_is_super_admin
from api.models import User, Company, Customer, Vendor, Station, Invoice
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


@csrf_exempt
@auth_required
@_super_admin_required
def admin_master_company_push_updates(request):
    """POST /api/admin/master-company/push-updates — legacy stub; use per-tenant apply-release instead."""
    return JsonResponse(
        {
            "ok": True,
            "message": (
                "Use POST /api/admin/companies/<id>/apply-release/ for manual per-tenant rollout. "
                "Set FSERP_PLATFORM_RELEASE at deploy to define the target tag."
            ),
            "target_release": get_target_release(),
        }
    )


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
