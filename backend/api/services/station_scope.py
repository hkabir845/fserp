"""Resolve which station filters apply for the current user (home station vs optional context)."""
from __future__ import annotations

from django.http import JsonResponse

from api.models import Station, User
from api.services.permission_service import normalize_role_key


def enforce_pos_home_station(
    company_id: int, sale_station_id: int | None, api_user
) -> tuple[int | None, JsonResponse | None]:
    """
    If the user has a home station, the sale must post to that station's stock and registers.
    Returns (possibly adjusted sale_station_id, error response).
    """
    if not api_user:
        return sale_station_id, None
    uid = getattr(api_user, "id", None) or getattr(api_user, "pk", None)
    if not uid:
        return sale_station_id, None
    u = User.objects.filter(pk=uid).only("home_station_id").first()
    hid = int(u.home_station_id) if u and u.home_station_id else None
    if not hid:
        return sale_station_id, None
    st = Station.objects.filter(pk=hid, company_id=company_id, is_active=True).first()
    if not st:
        return None, JsonResponse(
            {
                "detail": "Your user account’s home station is missing or inactive. "
                "Ask a company admin to set Home station in Users, or clear it to use the default site."
            },
            status=403,
        )
    if sale_station_id is not None and int(sale_station_id) != int(hid):
        return None, JsonResponse(
            {
                "detail": f"Sales must be posted to your assigned station (ID {hid}, {st.station_name or 'home'}). "
                "Switch the register / station in the POS, or use an account that is not limited to a single site."
            },
            status=400,
        )
    return int(hid), None


def effective_report_station_id(request, company_id: int) -> tuple[int | None, JsonResponse | None]:
    """
    Station filter for company-scoped reports: None = all sites.
    Users with home_station in DB are always filtered to that station (header/query ignored for scope).
    """
    api = getattr(request, "api_user", None)
    if not api:
        return None, None
    u = (
        User.objects.select_related("home_station", "custom_role")
        .filter(pk=getattr(api, "pk", None) or api.id)
        .first()
    )
    if not u:
        return None, None
    hid = getattr(u, "home_station_id", None)
    if hid:
        st = Station.objects.filter(pk=hid, company_id=company_id, is_active=True).first()
        if not st:
            return None, JsonResponse(
                {
                    "detail": "Your account’s home station is invalid. Ask a company admin to update Users → Home station."
                },
                status=403,
            )
        return int(hid), None

    rk = normalize_role_key(getattr(u, "role", None))
    n_active = Station.objects.filter(company_id=company_id, is_active=True).count()
    if rk in ("cashier", "operator") and n_active == 0:
        return None, JsonResponse(
            {
                "detail": (
                    "No active site is set up for this company. Add a station under Sites, then try again."
                )
            },
            status=403,
        )
    # Site staff must be tied to a site when the tenant has more than one; otherwise they could see all stations.
    if rk in ("cashier", "operator") and n_active > 1:
        return None, JsonResponse(
            {
                "detail": (
                    "A home station is required to run this report when the company has more than one site. "
                    "Ask a company admin to set Home station for your user, or use a company admin / accountant account."
                ),
            },
            status=403,
        )
    if rk in ("cashier", "operator") and n_active == 1:
        one = Station.objects.filter(company_id=company_id, is_active=True).only("id").order_by("id").first()
        if one:
            return int(one.id), None

    raw = (request.GET.get("station_id") or request.META.get("HTTP_X_SELECTED_STATION_ID") or "").strip()
    if not raw or raw.lower() in ("0", "all", "none"):
        return None, None
    try:
        sid = int(raw)
    except (TypeError, ValueError):
        return None, JsonResponse(
            {"detail": "station_id must be a positive integer, or omit for all stations."},
            status=400,
        )
    if sid <= 0:
        return None, None
    if not Station.objects.filter(pk=sid, company_id=company_id, is_active=True).exists():
        return None, JsonResponse(
            {"detail": "Unknown or inactive station_id for this company."},
            status=400,
        )
    return sid, None
