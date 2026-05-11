"""Django system checks (e.g. `manage.py check --deploy`)."""

from django.conf import settings
from django.core.checks import Warning, register

W_FSERP_LOCMEM_PRODUCTION = "fserp.W001"


@register(deploy=True)
def check_locmem_cache_with_debug_off(app_configs, **kwargs):
    if settings.DEBUG:
        return []
    backend = settings.CACHES.get("default", {}).get("BACKEND", "")
    if "LocMemCache" not in backend:
        return []
    return [
        Warning(
            "LocMemCache is used while DEBUG is False. Set DJANGO_CACHE_URL or REDIS_URL when "
            "running multiple Gunicorn/uWSGI workers so OTP, rate limits, and similar features "
            "stay consistent across processes. Single-worker deployments may silence this with "
            "FSERP_SILENCED_SYSTEM_CHECKS=fserp.W001.",
            id=W_FSERP_LOCMEM_PRODUCTION,
        )
    ]
