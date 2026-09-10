"""Origin allow-list helpers for credentialed browser auth (cookie refresh)."""
from __future__ import annotations

import re
from urllib.parse import urlparse

from django.conf import settings


def request_origin(request) -> str:
    """Prefer Origin; fall back to Referer scheme+netloc (no path)."""
    origin = (request.META.get("HTTP_ORIGIN") or "").strip()
    if origin:
        return origin.rstrip("/")
    referer = (request.META.get("HTTP_REFERER") or "").strip()
    if not referer:
        return ""
    try:
        p = urlparse(referer)
        if not p.scheme or not p.netloc:
            return ""
        return f"{p.scheme}://{p.netloc}".rstrip("/")
    except Exception:
        return ""


def origin_is_allowed(origin: str) -> bool:
    """True when origin matches CORS_ALLOWED_ORIGINS or CORS_ALLOWED_ORIGIN_REGEXES."""
    o = (origin or "").strip().rstrip("/")
    if not o:
        return False
    allowed = getattr(settings, "CORS_ALLOWED_ORIGINS", None) or []
    for a in allowed:
        if o == str(a).rstrip("/"):
            return True
    for rx in getattr(settings, "CORS_ALLOWED_ORIGIN_REGEXES", None) or []:
        try:
            if re.fullmatch(str(rx), o):
                return True
        except re.error:
            continue
    return False


def cookie_refresh_origin_error(request, *, used_cookie: bool) -> str | None:
    """
    When the refresh token is taken from the HttpOnly cookie (not the JSON body),
    require a browser Origin/Referer that is on the CORS allow-list.

    Native / Capacitor clients send the token in the body (or X-Auth-Client: native)
    and are not subject to this check.
    """
    if not used_cookie:
        return None
    client = (request.META.get("HTTP_X_AUTH_CLIENT") or "").strip().lower()
    if client == "native":
        return None
    origin = request_origin(request)
    if not origin:
        return "Origin required for cookie-based token refresh"
    if not origin_is_allowed(origin):
        return "Origin not allowed for cookie-based token refresh"
    return None
