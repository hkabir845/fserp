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
from pathlib import Path

from django.conf import settings

_RELEASE_FILE = Path(__file__).resolve().parent.parent / ".env.release"


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def _release_file_values() -> dict[str, str]:
    """Last stamp written by deploy-vps.sh. Used when PM2 reload leaves stale process env."""
    try:
        text = _RELEASE_FILE.read_text(encoding="utf-8")
    except OSError:
        return {}
    out: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        out[key.strip()] = value.strip().strip('"').strip("'")
    return out


def current_app_version() -> str:
    file_vals = _release_file_values()
    return (
        file_vals.get("FSERP_APP_VERSION")
        or _env("FSERP_APP_VERSION", _env("RELEASE_VERSION", "0.0.0-dev"))
        or "0.0.0-dev"
    )


def current_git_commit() -> str | None:
    file_vals = _release_file_values()
    raw = file_vals.get("GIT_COMMIT_SHA") or _env("GIT_COMMIT_SHA", _env("SOURCE_VERSION", ""))
    return (raw or "")[:12] or None


APP_VERSION = current_app_version()
GIT_COMMIT = current_git_commit()
# Optional one-line or short multi-line notes for operators (shown in Super Admin platform release panel).
RELEASE_NOTES = (_env("FSERP_RELEASE_NOTES", "") or "")[:4000]


def health_payload() -> dict:
    """Minimal fields for load balancers and uptime monitors."""
    return {
        "status": "healthy",
        "backend": "django",
        "version": current_app_version(),
    }


def version_payload() -> dict:
    """Extended, still non-sensitive — for deploy verification and diagnostics."""
    from django.utils import timezone

    payload = {
        "application": "FSERP",
        "backend": "django",
        "version": current_app_version(),
        "commit": current_git_commit(),
        "time_utc": timezone.now().isoformat(),
        "debug": bool(getattr(settings, "DEBUG", True)),
    }
    if bool(getattr(settings, "DEBUG", False)):
        payload["python"] = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    return payload
