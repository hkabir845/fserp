"""
Manual per-tenant platform release rollout (SaaS).

Deploy sets FSERP_APP_VERSION (see PLATFORM_TARGET_RELEASE in Django settings).
Super Admin promotes each tenant when ready — no automatic all-tenant push.

Add idempotent data backfills in TENANT_RELEASE_HOOKS below as you ship features.
Bump PLATFORM_HOOKS_VERSION when hooks change so existing tenants re-run them.
"""
from __future__ import annotations

import logging
from typing import Any, Callable

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from api.models import Company

logger = logging.getLogger(__name__)

# Bump when TENANT_RELEASE_HOOKS gain or change behavior (fleet + new tenants).
PLATFORM_HOOKS_VERSION = 1

# (company_id,) -> None; must be safe to run multiple times for the same tenant/release.
TENANT_RELEASE_HOOKS: list[Callable[[int], Any]] = []

# Register idempotent backfills (Aquaculture Data Bank, COA, org shell, payroll, etc.)
from api.services.tenant_release_hooks import TENANT_RELEASE_HOOKS as _REGISTERED_RELEASE_HOOKS  # noqa: E402

TENANT_RELEASE_HOOKS.extend(_REGISTERED_RELEASE_HOOKS)


def release_hook_catalog() -> list[dict[str, str]]:
    from api.services.tenant_release_hooks import release_hook_catalog as _catalog

    return _catalog()

# (company_id, from_release, to_release) -> None; optional reverse of forward hooks — keep empty if not needed.
TENANT_RELEASE_ROLLBACK_HOOKS: list[Callable[[int, str, str], Any]] = []


def get_target_release() -> str:
    """Platform release tag operators should promote tenants toward (env / settings)."""
    raw = getattr(settings, "PLATFORM_TARGET_RELEASE", None) or ""
    return str(raw).strip()[:64] or "0.0.0-dev"


def tenant_hooks_version(company: Company) -> int:
    return int(getattr(company, "platform_hooks_version", None) or 0)


def tenant_needs_hooks(company: Company) -> bool:
    return tenant_hooks_version(company) < PLATFORM_HOOKS_VERSION


def tenant_needs_release(company: Company, target: str | None = None) -> bool:
    t = (target or get_target_release()).strip()
    cur = (getattr(company, "platform_release", None) or "").strip()
    return cur != t or tenant_needs_hooks(company)


def run_tenant_release_hooks(company_id: int) -> None:
    """Run all registered idempotent tenant backfills (safe to call repeatedly)."""
    for hook in TENANT_RELEASE_HOOKS:
        try:
            hook(company_id)
        except Exception as e:
            logger.exception("tenant release hook failed company_id=%s", company_id)
            raise ValueError(f"Release hook failed: {e}") from e


@transaction.atomic
def provision_new_tenant(company: Company) -> dict[str, Any]:
    """
    Apply full tenant feature hooks for a newly created company.

    New tenants are tagged at the current platform release on create; without this,
    Apply release would skip hooks because the release tag already matches.
    """
    run_tenant_release_hooks(company.id)
    now = timezone.now()
    tgt = get_target_release()[:64]
    company.platform_hooks_version = PLATFORM_HOOKS_VERSION
    if not (company.platform_release or "").strip():
        company.platform_release = tgt
    company.platform_release_applied_at = now
    company.save(
        update_fields=[
            "platform_hooks_version",
            "platform_release",
            "platform_release_applied_at",
            "updated_at",
        ]
    )
    return {
        "ok": True,
        "company_id": company.id,
        "hooks_version": PLATFORM_HOOKS_VERSION,
        "hook_count": len(TENANT_RELEASE_HOOKS),
        "message": f"Provisioned tenant with {len(TENANT_RELEASE_HOOKS)} upgrade hook(s).",
    }


@transaction.atomic
def apply_platform_release(company: Company, target: str | None = None) -> dict[str, Any]:
    """
    Mark tenant as upgraded to `target` and run registered hooks when needed.

    Hooks run when the release tag changes OR platform_hooks_version is behind PLATFORM_HOOKS_VERSION.

    Raises ValueError on invalid input.
    """
    tgt = (target or get_target_release()).strip()[:64]
    if not tgt:
        raise ValueError("Target release is empty. Set PLATFORM_TARGET_RELEASE or FSERP_APP_VERSION.")

    allowed = get_target_release()
    if tgt != allowed:
        raise ValueError(
            f"Release must match the configured platform target ({allowed!r}). "
            "Change FSERP_APP_VERSION at deploy, then promote tenants."
        )

    cur = (company.platform_release or "").strip()
    needs_tag = cur != tgt
    needs_hooks = tenant_needs_hooks(company)

    if not needs_tag and not needs_hooks:
        return {
            "ok": True,
            "skipped": True,
            "company_id": company.id,
            "release": tgt,
            "hooks_version": tenant_hooks_version(company),
            "message": "Already at this release with current upgrade hooks.",
        }

    messages: list[str] = []

    if needs_hooks:
        run_tenant_release_hooks(company.id)
        if TENANT_RELEASE_HOOKS:
            messages.append(f"Ran {len(TENANT_RELEASE_HOOKS)} tenant upgrade hook(s).")

    now = timezone.now()
    update_fields = ["platform_hooks_version", "platform_release_applied_at", "updated_at"]

    company.platform_hooks_version = PLATFORM_HOOKS_VERSION
    company.platform_release_applied_at = now

    if needs_tag:
        company.platform_release_previous = cur[:64]
        company.platform_release = tgt
        update_fields.extend(["platform_release_previous", "platform_release"])
        messages.append("Tenant release tag updated.")
    elif needs_hooks:
        messages.append("Tenant upgrade hooks refreshed (release tag unchanged).")

    company.save(update_fields=update_fields)

    logger.info(
        "platform release applied company_id=%s release=%s hooks_only=%s",
        company.id,
        tgt,
        not needs_tag,
    )

    return {
        "ok": True,
        "skipped": False,
        "company_id": company.id,
        "release": tgt if needs_tag else cur,
        "hooks_version": PLATFORM_HOOKS_VERSION,
        "hooks_only": needs_hooks and not needs_tag,
        "applied_at": now.isoformat(),
        "messages": messages,
    }


@transaction.atomic
def rollback_platform_release(company: Company) -> dict[str, Any]:
    """
    Restore the release tag stored in platform_release_previous (one step).
    Clears platform_release_previous after success. Does not undo deployed code — only the stored tag and optional rollback hooks.
    """
    if company.platform_release_previous is None:
        raise ValueError(
            "No recorded release to roll back. This company has not applied a platform upgrade "
            "since rollback tracking was added, or rollback was already used."
        )

    prev = (company.platform_release_previous or "").strip()[:64]
    current = (company.platform_release or "").strip()[:64]

    for hook in TENANT_RELEASE_ROLLBACK_HOOKS:
        try:
            hook(company.id, current, prev)
        except Exception as e:
            logger.exception("tenant release rollback hook failed company_id=%s", company.id)
            raise ValueError(f"Release rollback hook failed: {e}") from e

    now = timezone.now()
    company.platform_release = prev
    company.platform_release_previous = None
    company.platform_release_applied_at = now
    company.save(
        update_fields=["platform_release", "platform_release_previous", "platform_release_applied_at", "updated_at"]
    )

    logger.info(
        "platform release rolled back company_id=%s from=%s to=%s",
        company.id,
        current,
        prev,
    )

    return {
        "ok": True,
        "company_id": company.id,
        "release": prev,
        "rolled_back_from": current,
        "applied_at": now.isoformat(),
    }
