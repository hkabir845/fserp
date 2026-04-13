"""JWT helpers for API auth."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import jwt
from django.conf import settings
from django.http import JsonResponse
from api.models import Company, User

logger = logging.getLogger(__name__)


def create_tokens(user):
    """Return access_token and refresh_token for user."""
    secret = settings.SECRET_KEY
    now = datetime.now(timezone.utc)
    sub = str(user.username) if user.username is not None else ""
    payload_access = {
        "sub": sub,
        "type": "access",
        "exp": now + timedelta(minutes=60),
    }
    payload_refresh = {
        "sub": sub,
        "type": "refresh",
        "exp": now + timedelta(days=7),
    }
    access_token = jwt.encode(payload_access, secret, algorithm="HS256")
    refresh_token = jwt.encode(payload_refresh, secret, algorithm="HS256")
    if hasattr(access_token, "decode"):
        access_token = access_token.decode("utf-8")
        refresh_token = refresh_token.decode("utf-8")
    return access_token, refresh_token


def get_user_from_request(request):
    """Get User from Authorization Bearer token or return None."""
    auth = (request.META.get("HTTP_AUTHORIZATION") or "").strip()
    parts = auth.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    if not token:
        return None
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=["HS256"],
            leeway=60,
        )
        if payload.get("type") != "access":
            return None
        username = payload.get("sub")
        if username is None or username == "":
            return None
        if not isinstance(username, str):
            username = str(username)
        return User.objects.filter(username__iexact=username, is_active=True).first()
    except Exception:
        return None


def auth_required(view_func):
    """Decorator: return 401 JsonResponse if no valid user."""
    def wrapped(request, *args, **kwargs):
        try:
            user = get_user_from_request(request)
            if not user:
                return JsonResponse({"detail": "Authentication required"}, status=401)
            if not tenant_company_allows_access(user):
                return JsonResponse(
                    {
                        "detail": "This company account is inactive. Contact your administrator.",
                    },
                    status=403,
                )
            request.api_user = user
            return view_func(request, *args, **kwargs)
        except Exception as e:
            return JsonResponse({"detail": "Authentication or request failed", "error": str(e)}, status=500)
    return wrapped


def user_is_super_admin(user) -> bool:
    """True if user is platform super admin (tolerant of spacing/casing in role string)."""
    r = (getattr(user, "role", None) or "").strip().lower().replace(" ", "_").replace("-", "_")
    return r in ("super_admin", "superadmin")


def tenant_company_allows_access(user) -> bool:
    """
    Non-super-admin users tied to a company may not use the API when that company is
    inactive or deleted. Super admins are unaffected so they can open the tenant and reactivate.
    """
    if not user or user_is_super_admin(user):
        return True
    cid = getattr(user, "company_id", None)
    if cid is None:
        return True
    return Company.objects.filter(id=cid, is_deleted=False, is_active=True).exists()


def _subdomain_from_request(request) -> str | None:
    """
    Tenant slug from X-Tenant-Subdomain (set by the Next.js client from the browser hostname).

    Host-based routing can be added later; header keeps API and deployment flexible.
    """
    raw = (request.META.get("HTTP_X_TENANT_SUBDOMAIN") or "").strip()
    if not raw:
        return None
    return raw.lower()[:100]


def company_context_error_response(request):
    """
    Call after get_company_id() returns None to surface tenant subdomain failures.

    Returns JsonResponse for invalid/forbidden subdomain, or None if missing company is a generic case.
    """
    if getattr(request, "tenant_subdomain_invalid", False):
        return JsonResponse({"detail": "Unknown tenant subdomain."}, status=404)
    if getattr(request, "tenant_subdomain_forbidden", False):
        return JsonResponse(
            {"detail": "This account is not authorized for this tenant."},
            status=403,
        )
    return None


def get_company_id(request):
    """
    Resolve company ID for tenant scoping.

    When ``X-Tenant-Subdomain`` is present, resolve the company by ``Company.subdomain``:
    - Super admin: ``X-Selected-Company-Id`` still wins if valid; otherwise use the subdomain company.
    - Other users: must belong to that company (``user.company_id`` matches).

    When the header is absent, behavior is unchanged (user's company, super-admin switcher, fallbacks).

    Sets ``request.tenant_subdomain_invalid`` or ``request.tenant_subdomain_forbidden`` on hard failures.
    """
    from api.models import Company

    request.tenant_subdomain_invalid = False
    request.tenant_subdomain_forbidden = False

    user = getattr(request, "api_user", None) or get_user_from_request(request)
    if not user:
        return None

    sub = _subdomain_from_request(request)
    if sub:
        co = Company.objects.filter(subdomain__iexact=sub, is_deleted=False).first()
        if not co:
            request.tenant_subdomain_invalid = True
            return None
        if user_is_super_admin(user):
            header = request.META.get("HTTP_X_SELECTED_COMPANY_ID", "").strip()
            if header:
                try:
                    cid = int(header)
                    if Company.objects.filter(id=cid, is_deleted=False).exists():
                        return cid
                except (ValueError, TypeError):
                    pass
            return co.id
        uid = getattr(user, "company_id", None)
        if uid is not None and int(uid) == co.id:
            return co.id
        request.tenant_subdomain_forbidden = True
        return None

    # No tenant subdomain hint — legacy behavior
    if user_is_super_admin(user):
        header = request.META.get("HTTP_X_SELECTED_COMPANY_ID", "").strip()
        if header:
            try:
                cid = int(header)
                if Company.objects.filter(id=cid, is_deleted=False).exists():
                    return cid
            except (ValueError, TypeError):
                pass

    if getattr(user, "company_id", None):
        if Company.objects.filter(id=user.company_id, is_deleted=False).exists():
            return user.company_id
    first = Company.objects.filter(is_deleted=False).order_by("id").first()
    if first:
        return first.id
    if user_is_super_admin(user):
        default_company = Company.objects.create(
            name="Master Filling Station",
            legal_name="Master Filling Station (Development)",
            currency="BDT",
            is_active=True,
            is_master="true",
        )
        try:
            from api.chart_templates.fuel_station import seed_fuel_station_if_empty

            seed_fuel_station_if_empty(default_company.id, profile="full")
        except Exception as exc:
            logger.warning(
                "Could not seed chart of accounts for master company %s: %s",
                default_company.id,
                exc,
            )
        return default_company.id
    return None
