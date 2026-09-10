"""Cache-backed rate limits for unauthenticated auth endpoints (LocMem, Redis, or DB)."""
from __future__ import annotations

import logging
import os

from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)


def auth_rate_limits_enabled() -> bool:
    """
    Set FSERP_DISABLE_AUTH_RATELIMIT=1 in pytest (see tests/conftest.py): the Django test client
    uses one IP for every test, so per-IP limits would flake after dozens of logins.
    """
    raw = os.environ.get("FSERP_DISABLE_AUTH_RATELIMIT", "").strip().lower()
    return raw not in ("1", "true", "yes")


def _trusted_proxy_count() -> int:
    """
    How many reverse-proxy hops sit in front of the app.

    Only the client address at that depth is trusted. Spoofed leading X-Forwarded-For
    values from the browser are ignored when the app is not behind a configured proxy.
    Default 0 = use REMOTE_ADDR only (safest for direct exposure).
    """
    raw = getattr(settings, "NUM_PROXIES", None)
    if raw is None:
        raw = os.environ.get("FSERP_NUM_PROXIES", "0")
    try:
        n = int(raw)
    except (TypeError, ValueError):
        n = 0
    return max(0, n)


def client_ip(request) -> str:
    """
    Client IP for rate limiting.

    When ``NUM_PROXIES`` / ``FSERP_NUM_PROXIES`` is 0, ignore X-Forwarded-For (clients can
    spoof it). When N>0, take the address N hops from the right of the XFF chain
    (the original client as seen by the outermost trusted proxy).
    """
    remote = ((request.META.get("REMOTE_ADDR") or "").strip() or "unknown")[:45]
    proxies = _trusted_proxy_count()
    if proxies <= 0:
        return remote
    xff = (request.META.get("HTTP_X_FORWARDED_FOR") or "").strip()
    if not xff:
        return remote
    parts = [p.strip() for p in xff.split(",") if p.strip()]
    if not parts:
        return remote
    # Rightmost proxies entries are added by trusted proxies; client is just before them.
    idx = len(parts) - proxies - 1
    if idx < 0:
        idx = 0
    return (parts[idx] or remote)[:45]


def rate_limit_count(key: str) -> int:
    """Current counter value for ``key`` (0 if missing or cache error)."""
    try:
        n = cache.get(key)
        if n is None:
            return 0
        return int(n)
    except Exception:
        return 0


def rate_limit_exceeded(*, key: str, limit: int, period_seconds: int) -> bool:
    """
    Count one attempt for ``key``. Return True if the limit is already reached (reject with 429).

    Compatible with LocMemCache, RedisCache and DatabaseCache. Fails **closed for auth
    failure counters** when the key starts with ``rl:loginfail_`` — an unreachable cache
    must not enable unlimited credential stuffing. Other keys still fail open so a cache
    outage does not lock every user out of login.
    """
    fail_closed = key.startswith("rl:loginfail_")
    try:
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
    except Exception:
        logger.warning(
            "Rate limit cache unavailable; %s request for %s",
            "blocking" if fail_closed else "allowing",
            key,
            exc_info=True,
        )
        return bool(fail_closed)


def account_login_failure_key(username: str) -> str:
    u = (username or "").strip().lower()[:150]
    return f"rl:loginfail_user:v1:{u or '_'}"
