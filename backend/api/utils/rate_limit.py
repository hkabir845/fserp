"""Cache-backed rate limits for unauthenticated auth endpoints (LocMem or Redis)."""
from __future__ import annotations

import os

from django.core.cache import cache


def auth_rate_limits_enabled() -> bool:
    """
    Set FSERP_DISABLE_AUTH_RATELIMIT=1 in pytest (see tests/conftest.py): the Django test client
    uses one IP for every test, so per-IP limits would flake after dozens of logins.
    """
    raw = os.environ.get("FSERP_DISABLE_AUTH_RATELIMIT", "").strip().lower()
    return raw not in ("1", "true", "yes")


def client_ip(request) -> str:
    """Client IP, honoring X-Forwarded-For when present (first hop)."""
    xff = (request.META.get("HTTP_X_FORWARDED_FOR") or "").strip()
    if xff:
        return (xff.split(",")[0].strip() or "unknown")[:45]
    return ((request.META.get("REMOTE_ADDR") or "").strip() or "unknown")[:45]


def rate_limit_exceeded(*, key: str, limit: int, period_seconds: int) -> bool:
    """
    Count one attempt for ``key``. Return True if the limit is already reached (reject with 429).

    Compatible with Django LocMemCache and RedisCache.
    """
    n = cache.get(key)
    if n is None:
        cache.set(key, 1, period_seconds)
        return False
    try:
        n_int = int(n)
    except (TypeError, ValueError):
        n_int = 0
    if n_int >= limit:
        return True
    cache.incr(key)
    return False
