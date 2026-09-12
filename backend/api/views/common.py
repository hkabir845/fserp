"""Shared helpers for API views: JSON serialization, company scoping."""
import json
from datetime import date, datetime
from decimal import Decimal
from django.http import JsonResponse

from api.utils.auth import company_context_error_response, get_company_id
from api.utils.measured_quantity import format_measured_quantity_for_api


def query_include_inactive(request) -> bool:
    """True when list endpoints should return inactive (soft-deleted) rows."""
    return (request.GET.get("include_inactive") or "").strip().lower() in ("true", "1", "yes")


def query_include_internal(request) -> bool:
    """True when list endpoints should also return internal trading parties (pond identities)."""
    return (request.GET.get("include_internal") or "").strip().lower() in ("true", "1", "yes")


def parse_json_body(request):
    """Parse request body as JSON; return (data, None) or (None, error_response)."""
    try:
        body = json.loads(request.body) if request.body else {}
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None, JsonResponse({"detail": "Invalid JSON"}, status=400)
    if not isinstance(body, dict):
        return None, JsonResponse({"detail": "JSON body must be an object"}, status=400)
    return body, None


def _serialize_date(d):
    if d is None:
        return None
    if isinstance(d, date) and not isinstance(d, datetime):
        return d.isoformat()
    if isinstance(d, datetime):
        return d.date().isoformat() if hasattr(d, "date") else d.isoformat()
    return str(d)


def _serialize_datetime(dt):
    if dt is None:
        return None
    if hasattr(dt, "isoformat"):
        return dt.isoformat()
    return str(dt)


def _serialize_decimal(d):
    if d is None:
        return None
    return str(d)


def _serialize_quantity(d):
    """Measuring units (inventory qty, kg, L, etc.) — always two fractional digits in JSON."""
    if d is None:
        return None
    if isinstance(d, Decimal):
        return format_measured_quantity_for_api(d)
    return format_measured_quantity_for_api(Decimal(str(d)))


def parse_optional_company_station_id(request_get, company_id: int):
    """
    Parse optional ``station_id`` from a query dict (e.g. request.GET) for tenant-scoped
    GL statements and similar. Returns ``(station_id_or_None, JsonResponse_error_or_None)``.
    """
    from api.models import Station

    raw = request_get.get("station_id")
    if raw is None or str(raw).strip() == "":
        return None, None
    try:
        sid = int(raw)
    except (TypeError, ValueError):
        return None, JsonResponse({"detail": "station_id must be an integer."}, status=400)
    if not Station.objects.filter(pk=sid, company_id=company_id).exists():
        return None, JsonResponse({"detail": "Station not found for this company."}, status=404)
    return sid, None


def require_company_id(view_func):
    """Decorator that resolves company_id and returns 403 if missing (for tenant-scoped resources)."""
    def wrapped(request, *args, **kwargs):
        cid = get_company_id(request)
        err = company_context_error_response(request)
        if err:
            return err
        if cid is None:
            return JsonResponse({"detail": "Company context required"}, status=403)
        request.company_id = cid
        return view_func(request, *args, **kwargs)
    return wrapped


def require_permission(*need: str, methods: tuple[str, ...] | None = None):
    """
    Require the authenticated user to hold at least one of ``need`` (permission catalog ids).

    Stack after ``@auth_required`` (and usually ``@require_company_id``). Parent app keys
    (e.g. ``app.sales``) already grant their ``app.page.*`` children via ``has_permission``.

    When ``methods`` is set (e.g. ``("POST", "PUT", "DELETE")``), only those HTTP methods
    are gated — useful for list_or_create endpoints that stay readable to any company user
    while writes stay role-scoped. Prefer gating all methods on sensitive modules.
    """

    def decorator(view_func):
        def wrapped(request, *args, **kwargs):
            if methods is not None:
                m = (getattr(request, "method", "") or "").upper()
                if m not in {x.upper() for x in methods}:
                    return view_func(request, *args, **kwargs)
            from api.services.permission_service import has_permission, resolve_user_permissions

            user = getattr(request, "api_user", None)
            if not has_permission(resolve_user_permissions(user), *need):
                return JsonResponse({"detail": "Permission denied"}, status=403)
            return view_func(request, *args, **kwargs)

        return wrapped

    return decorator
