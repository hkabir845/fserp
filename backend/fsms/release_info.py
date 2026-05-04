"""
Build and release metadata for operations, health checks, and support.

Set at deploy time (recommended):
  FSERP_APP_VERSION   e.g. 1.4.2
  GIT_COMMIT_SHA      short or full git SHA (optional)

Set FSERP_APP_VERSION and GIT_COMMIT_SHA at deploy time; verify with GET /api/version/.
"""
from __future__ import annotations

import os
import sys

from django.conf import settings


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


APP_VERSION = _env("FSERP_APP_VERSION", _env("RELEASE_VERSION", "0.0.0-dev")) or "0.0.0-dev"
GIT_COMMIT = (_env("GIT_COMMIT_SHA", _env("SOURCE_VERSION", "")) or "")[:12] or None
# Optional one-line or short multi-line notes for operators (shown in Super Admin platform release panel).
RELEASE_NOTES = (_env("FSERP_RELEASE_NOTES", "") or "")[:4000]


def health_payload() -> dict:
    """Minimal fields for load balancers and uptime monitors."""
    return {
        "status": "healthy",
        "backend": "django",
        "version": APP_VERSION,
    }


def version_payload() -> dict:
    """Extended, still non-sensitive — for deploy verification and diagnostics."""
    from django.utils import timezone

    payload = {
        "application": "FSERP",
        "backend": "django",
        "version": APP_VERSION,
        "commit": GIT_COMMIT,
        "time_utc": timezone.now().isoformat(),
        "debug": bool(getattr(settings, "DEBUG", True)),
    }
    if bool(getattr(settings, "DEBUG", False)):
        payload["python"] = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    return payload
