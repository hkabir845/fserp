"""
Audit logging and fleet analytics for tenant platform releases (SaaS rollouts).
"""
from __future__ import annotations

from typing import Any

from django.db.models import Q

from api.models import Company, TenantPlatformReleaseEvent
from api.services.tenant_release import get_target_release


def record_release_audit(
    *,
    company_id: int,
    category: str,
    server_target_release: str,
    success: bool,
    actor_user_id: int | None,
    source: str,
    detail: dict[str, Any] | None = None,
    error_message: str = "",
) -> TenantPlatformReleaseEvent:
    return TenantPlatformReleaseEvent.objects.create(
        company_id=company_id,
        category=category[:32],
        server_target_release=(server_target_release or "")[:64],
        success=bool(success),
        error_message=(error_message or "")[:8000],
        actor_user_id=actor_user_id,
        source=(source or "")[:48],
        detail=detail,
    )


def compute_fleet_release_summary() -> dict[str, Any]:
    """
    Aggregate how many non-master tenants match the server's target release tag.
    """
    target = get_target_release()
    master_q = Q(is_master__iexact="true") | Q(is_master="1")
    tenants = Company.objects.filter(is_deleted=False).exclude(master_q)
    total = tenants.count()
    at_target = 0
    unset = 0
    behind_diff_tag = 0
    for c in tenants.only("id", "platform_release"):
        cur = (getattr(c, "platform_release", None) or "").strip()
        if not cur:
            unset += 1
        elif cur == target:
            at_target += 1
        else:
            behind_diff_tag += 1
    not_current = unset + behind_diff_tag
    compliance_pct = round(100.0 * at_target / total, 1) if total else 100.0
    return {
        "server_target_release": target,
        "tenant_count": total,
        "at_target": at_target,
        "behind_different_tag": behind_diff_tag,
        "unset_or_empty_tag": unset,
        "not_at_target": not_current,
        "compliance_pct": compliance_pct,
    }


def list_recent_release_events(
    *,
    company_id: int | None,
    limit: int,
) -> list[dict[str, Any]]:
    limit = max(1, min(limit, 200))
    qs = TenantPlatformReleaseEvent.objects.select_related("company").order_by("-created_at")
    if company_id is not None:
        qs = qs.filter(company_id=company_id)
    rows: list[dict[str, Any]] = []
    for e in qs[:limit]:
        rows.append(
            {
                "id": e.id,
                "company_id": e.company_id,
                "company_name": e.company.name if e.company_id else "",
                "category": e.category,
                "server_target_release": e.server_target_release,
                "success": e.success,
                "error_message": e.error_message or "",
                "actor_user_id": e.actor_user_id,
                "source": e.source,
                "detail": e.detail,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
        )
    return rows
