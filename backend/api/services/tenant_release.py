"""
Manual per-tenant platform release rollout (SaaS).

Deploy sets FSERP_PLATFORM_RELEASE (or it falls back to FSERP_APP_VERSION).
Super Admin promotes each tenant when ready — no automatic all-tenant push.

Add idempotent data backfills in TENANT_RELEASE_HOOKS below as you ship features.
"""
from __future__ import annotations

import logging
from typing import Any, Callable

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from api.models import Company

logger = logging.getLogger(__name__)

# (company_id,) -> None; must be safe to run multiple times for the same tenant/release.
TENANT_RELEASE_HOOKS: list[Callable[[int], Any]] = []


def get_target_release() -> str:
    """Platform release tag operators should promote tenants toward (env / settings)."""
    raw = getattr(settings, "PLATFORM_TARGET_RELEASE", None) or ""
    return str(raw).strip()[:64] or "0.0.0-dev"


def tenant_needs_release(company: Company, target: str | None = None) -> bool:
    t = (target or get_target_release()).strip()
    cur = (getattr(company, "platform_release", None) or "").strip()
    return cur != t


@transaction.atomic
def apply_platform_release(company: Company, target: str | None = None) -> dict[str, Any]:
    """
    Mark tenant as upgraded to `target` and run registered hooks.

    Raises ValueError on invalid input.
    """
    tgt = (target or get_target_release()).strip()[:64]
    if not tgt:
        raise ValueError("Target release is empty. Set PLATFORM_TARGET_RELEASE or FSERP_APP_VERSION.")

    allowed = get_target_release()
    if tgt != allowed:
        raise ValueError(
            f"Release must match the configured platform target ({allowed!r}). "
            "Change FSERP_PLATFORM_RELEASE at deploy, then promote tenants."
        )

    cur = (company.platform_release or "").strip()
    if cur == tgt:
        return {
            "ok": True,
            "skipped": True,
            "company_id": company.id,
            "release": tgt,
            "message": "Already at this release.",
        }

    messages: list[str] = []

    for hook in TENANT_RELEASE_HOOKS:
        try:
            hook(company.id)
        except Exception as e:
            logger.exception("tenant release hook failed company_id=%s", company.id)
            raise ValueError(f"Release hook failed: {e}") from e

    now = timezone.now()
    company.platform_release = tgt
    company.platform_release_applied_at = now
    company.save(update_fields=["platform_release", "platform_release_applied_at", "updated_at"])
    messages.append("Tenant release tag updated.")

    logger.info(
        "platform release applied company_id=%s release=%s",
        company.id,
        tgt,
    )

    return {
        "ok": True,
        "skipped": False,
        "company_id": company.id,
        "release": tgt,
        "applied_at": now.isoformat(),
        "messages": messages,
    }
