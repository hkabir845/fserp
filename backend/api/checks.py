"""Django system checks (run with `manage.py check --deploy`)."""

from __future__ import annotations

import os
import sys

from django.conf import settings
from django.core.checks import Warning, register


def _explicit_sqlite_demo() -> bool:
    return os.environ.get("FSERP_USE_SQLITE", "").strip().lower() in ("1", "true", "yes")


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
    """Prefer PostgreSQL when deploying; SQLite is for local / tiny demos."""
    if _is_pytest():
        return []
    db = settings.DATABASES.get("default") or {}
    engine = str(db.get("ENGINE") or "")
    if "sqlite" not in engine:
        return []
    if _explicit_sqlite_demo():
        return []
    return [
        Warning(
            "SQLite is active. Use PostgreSQL via DATABASE_URL for production deployments.",
            hint=(
                "For intentional SQLite-only setups, set FSERP_USE_SQLITE=1 in the environment "
                "(see env.example)."
            ),
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
            hint="Set DJANGO_CACHE_URL or REDIS_URL to a Redis URL for production (see env.example).",
            id="fserp.W002",
        )
    ]


@register(deploy=True)
def check_smtp_for_password_reset(app_configs, **kwargs):
    if _is_pytest():
        return []
    if (os.environ.get("EMAIL_HOST") or "").strip():
        return []
    return [
        Warning(
            "EMAIL_HOST is not set; Django uses the console email backend and password-reset emails are not delivered.",
            hint="Configure SMTP in .env (EMAIL_HOST, …) and set FRONTEND_BASE_URL for reset links.",
            id="fserp.W003",
        )
    ]
