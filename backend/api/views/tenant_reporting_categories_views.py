"""CRUD for tenant-defined reporting categories (Aquaculture + Fuel station)."""
from __future__ import annotations

from django.db.utils import OperationalError, ProgrammingError
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from api.models import TenantReportingCategory
from api.services.tenant_reporting_categories import (
    APP_AQUACULTURE,
    APP_FUEL_STATION,
    KIND_EXPENSE,
    KIND_INCOME,
    list_map_target_choices,
    merged_fuel_station_expense_category_list_for_api,
    normalize_category_code,
    validate_maps_to,
    validate_tenant_code_not_builtin_conflict,
)
from api.utils.auth import auth_required, get_user_from_request, user_is_super_admin
from api.views.common import parse_json_body, require_company_id


def _db_error_response(exc: Exception) -> JsonResponse:
    msg = str(exc).lower()
    if "tenant_reporting_category" in msg or "does not exist" in msg:
        return JsonResponse(
            {
                "detail": (
                    "Reporting categories database table is missing. "
                    "On the server run: python manage.py migrate"
                )
            },
            status=503,
        )
    return JsonResponse({"detail": "Database error loading reporting categories."}, status=503)


def _api_user(request):
    return getattr(request, "api_user", None) or get_user_from_request(request)


def _is_company_admin(u) -> bool:
    if not u:
        return False
    return (getattr(u, "role", None) or "").lower() == "admin" and getattr(u, "company_id", None)


def _may_manage_reporting_categories(api_user) -> bool:
    if not api_user:
        return False
    if user_is_super_admin(api_user):
        return True
    return _is_company_admin(api_user)


def _serialize_row(r: TenantReportingCategory) -> dict:
    return {
        "id": r.id,
        "company_id": r.company_id,
        "application": r.application,
        "kind": r.kind,
        "code": r.code,
        "label": r.label,
        "maps_to_code": r.maps_to_code,
        "is_active": r.is_active,
        "sort_order": r.sort_order,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


@csrf_exempt
@auth_required
@require_http_methods(["GET"])
@require_company_id
def reporting_category_map_targets(request):
    """Allowed maps_to_code values for the create form (built-ins or fuel rollup keys)."""
    api = _api_user(request)
    if not api or not _may_manage_reporting_categories(api):
        return JsonResponse({"detail": "Permission denied"}, status=403)
    app = (request.GET.get("application") or "").strip().lower()
    kind = (request.GET.get("kind") or "").strip().lower()
    if app not in (APP_AQUACULTURE, APP_FUEL_STATION):
        return JsonResponse({"detail": "application must be aquaculture or fuel_station"}, status=400)
    if kind not in (KIND_EXPENSE, KIND_INCOME):
        return JsonResponse({"detail": "kind must be expense or income"}, status=400)
    cid = request.company_id
    return JsonResponse(
        {
            "map_targets": list_map_target_choices(
                application=app, kind=kind, company_id=cid
            )
        }
    )


@csrf_exempt
@auth_required
@require_http_methods(["GET", "POST"])
@require_company_id
def reporting_categories_list_or_create(request):
    api = _api_user(request)
    cid = request.company_id
    if request.method == "GET":
        app = (request.GET.get("application") or "").strip().lower()
        kind = (request.GET.get("kind") or "").strip().lower()
        qs = TenantReportingCategory.objects.filter(company_id=cid)
        if app in (APP_AQUACULTURE, APP_FUEL_STATION):
            qs = qs.filter(application=app)
        if kind in (KIND_EXPENSE, KIND_INCOME):
            qs = qs.filter(kind=kind)
        qs = qs.order_by("application", "kind", "sort_order", "code")
        try:
            rows = [_serialize_row(r) for r in qs]
        except (ProgrammingError, OperationalError) as exc:
            return _db_error_response(exc)
        return JsonResponse(rows, safe=False)

    if not _may_manage_reporting_categories(api):
        return JsonResponse({"detail": "Permission denied"}, status=403)
    body, err = parse_json_body(request)
    if err:
        return err
    app = (body.get("application") or "").strip().lower()
    kind = (body.get("kind") or "").strip().lower()
    if app not in (APP_AQUACULTURE, APP_FUEL_STATION):
        return JsonResponse({"detail": "application must be aquaculture or fuel_station"}, status=400)
    if kind not in (KIND_EXPENSE, KIND_INCOME):
        return JsonResponse({"detail": "kind must be expense or income"}, status=400)
    code, cerr = normalize_category_code(body.get("code"))
    if cerr:
        return JsonResponse({"detail": cerr}, status=400)
    assert code is not None
    conflict = validate_tenant_code_not_builtin_conflict(application=app, kind=kind, code=code)
    if conflict:
        return JsonResponse({"detail": conflict}, status=400)
    label = (body.get("label") or "").strip()
    if not label:
        return JsonResponse({"detail": "label is required"}, status=400)
    maps_to = (body.get("maps_to_code") or "").strip()
    merr = validate_maps_to(application=app, kind=kind, maps_to_code=maps_to)
    if merr:
        return JsonResponse({"detail": merr}, status=400)
    if TenantReportingCategory.objects.filter(
        company_id=cid, application=app, kind=kind, code__iexact=code
    ).exists():
        return JsonResponse({"detail": "A category with this code already exists for this application and kind."}, status=400)
    r = TenantReportingCategory(
        company_id=cid,
        application=app,
        kind=kind,
        code=code,
        label=label[:200],
        maps_to_code=maps_to,
        is_active=bool(body.get("is_active", True)),
        sort_order=int(body.get("sort_order") or 0),
    )
    r.save()
    return JsonResponse(_serialize_row(r), status=201)


@csrf_exempt
@auth_required
@require_http_methods(["GET", "PUT", "DELETE"])
@require_company_id
def reporting_category_detail(request, category_id: int):
    api = _api_user(request)
    cid = request.company_id
    try:
        r = TenantReportingCategory.objects.filter(pk=category_id, company_id=cid).first()
    except (ProgrammingError, OperationalError) as exc:
        return _db_error_response(exc)
    if not r:
        return JsonResponse({"detail": "Not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_serialize_row(r))
    if not _may_manage_reporting_categories(api):
        return JsonResponse({"detail": "Permission denied"}, status=403)
    if request.method == "DELETE":
        r.delete()
        return JsonResponse({"detail": "Deleted"}, status=200)
    body, err = parse_json_body(request)
    if err:
        return err
    if "label" in body:
        lab = (body.get("label") or "").strip()
        if not lab:
            return JsonResponse({"detail": "label cannot be empty"}, status=400)
        r.label = lab[:200]
    if "maps_to_code" in body:
        maps_to = (body.get("maps_to_code") or "").strip()
        merr = validate_maps_to(application=r.application, kind=r.kind, maps_to_code=maps_to)
        if merr:
            return JsonResponse({"detail": merr}, status=400)
        r.maps_to_code = maps_to
    if "is_active" in body:
        r.is_active = bool(body.get("is_active"))
    if "sort_order" in body:
        try:
            r.sort_order = int(body.get("sort_order") or 0)
        except (TypeError, ValueError):
            return JsonResponse({"detail": "sort_order must be an integer"}, status=400)
    r.save()
    return JsonResponse(_serialize_row(r))


@csrf_exempt
@require_http_methods(["GET"])
@auth_required
@require_company_id
def fuel_station_expense_categories(request):
    """Merged built-in + tenant fuel-station expense categories for vendor bills."""
    try:
        rows = merged_fuel_station_expense_category_list_for_api(request.company_id)
    except (ProgrammingError, OperationalError) as exc:
        return _db_error_response(exc)
    return JsonResponse(rows, safe=False)
