"""Shared helpers for API views: JSON serialization, company scoping."""
import json
from datetime import date, datetime
from decimal import Decimal
from django.http import JsonResponse

from api.utils.auth import company_context_error_response, get_company_id, get_user_from_request


def parse_json_body(request):
    """Parse request body as JSON; return (data, None) or (None, error_response)."""
    try:
        body = json.loads(request.body) if request.body else {}
    except json.JSONDecodeError:
        return None, JsonResponse({"detail": "Invalid JSON"}, status=400)
    return (body if isinstance(body, dict) else {}), None


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
