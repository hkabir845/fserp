"""Django system checks (run with `manage.py check --deploy`)."""

from __future__ import annotations

import os
import sys

from django.conf import settings
from django.core.checks import Warning, register


def _is_pytest() -> bool:
    return "pytest" in sys.modules


def _truthy_env(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes")


@register(deploy=True)
def check_whitenoise_for_gunicorn(app_configs, **kwargs):
    """Gunicorn deployments need static serving unless nginx handles STATIC_ROOT."""
    if _is_pytest():
        return []
    if _truthy_env("FSERP_DISABLE_WHITENOISE"):
        return []
    try:
        import importlib.util

        if importlib.util.find_spec("whitenoise") is not None:
            return []
    except Exception:
        pass
    return [
        Warning(
            "WhiteNoise is not installed; collected static files will not be served by Django/Gunicorn.",
            hint="Run `pip install -r requirements.txt` or set FSERP_DISABLE_WHITENOISE=1 if nginx serves STATIC_ROOT.",
            id="fserp.W004",
        )
    ]


@register(deploy=True)
def check_production_database(app_configs, **kwargs):
    """FSERP requires PostgreSQL via DATABASE_URL (SQLite is not supported)."""
    if _is_pytest():
        return []
    db = settings.DATABASES.get("default") or {}
    engine = str(db.get("ENGINE") or "")
    if "sqlite" not in engine:
        return []
    return [
        Warning(
            "SQLite is active but not supported. Set DATABASE_URL to PostgreSQL.",
            hint="Remove any FSERP_USE_SQLITE setting and configure DATABASE_URL in backend/.env.",
            id="fserp.W001",
        )
    ]


@register(deploy=True)
def check_shared_cache_for_workers(app_configs, **kwargs):
    """LocMem is not shared across Gunicorn/uWSGI workers."""
    if _is_pytest():
        return []
    cache = settings.CACHES.get("default") or {}
    backend = str(cache.get("BACKEND") or "")
    if "LocMemCache" not in backend and "locmem" not in backend.lower():
        return []
    return [
        Warning(
            "Cache backend is in-process (LocMem). Multiple API workers will not share OTP / rate-limit state.",
            hint=(
                "Set DJANGO_CACHE_URL or REDIS_URL for Redis, or omit both so production uses "
                "DatabaseCache (see env.example). Run `manage.py createcachetable` after deploy."
            ),
            id="fserp.W002",
        )
    ]


@register(deploy=True)
def check_smtp_for_password_reset(app_configs, **kwargs):
    if _is_pytest():
        return []
    if (os.environ.get("EMAIL_HOST") or "").strip():
        return []
    if _truthy_env("FSERP_ALLOW_CONSOLE_EMAIL"):
        return []
    return [
        Warning(
            "EMAIL_HOST is not set; Django uses the console email backend and password-reset emails are not delivered.",
            hint=(
                "Configure SMTP in .env (EMAIL_HOST, …) and set FRONTEND_BASE_URL for reset links. "
                "Or set FSERP_ALLOW_CONSOLE_EMAIL=1 to acknowledge console-only email in production."
            ),
            id="fserp.W003",
        )
    ]
