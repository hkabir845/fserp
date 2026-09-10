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

    Native / Capacitor clients send the token in the JSON body and return early above —
    they never reach the Origin check.

    ``X-Auth-Client: native`` is deliberately NOT honoured here. A native client cannot hold a
    browser HttpOnly cookie, so a cookie-borne refresh carrying that header is same-origin
    JavaScript, i.e. XSS. Skipping the check for it handed that script a fresh 7-day refresh
    token in the response body — the exact exfiltration the HttpOnly cookie exists to prevent.
    With SameSite=None in production this Origin check is the only CSRF defence on this
    endpoint, so it must not have an opt-out that the caller controls.
    """
    if not used_cookie:
        return None
    origin = request_origin(request)
    if not origin:
        return "Origin required for cookie-based token refresh"
    if not origin_is_allowed(origin):
        return "Origin not allowed for cookie-based token refresh"
    return None
