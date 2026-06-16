"""
Sent platform broadcasts visible to the current tenant (ERP users).
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user, get_db, require_tenant_id
from app.modules.platform.models import PlatformBroadcast
from app.modules.tenancy.models import Tenant, User

router = APIRouter()


class TenantAnnouncementResponse(BaseModel):
    id: int
    title: str
    message: str
    priority: str
    sent_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


def _applies_to_domain(targets: Optional[list], domain: str) -> bool:
    """Empty/None target list means all tenants; otherwise domain must be listed."""
    if targets is None or targets == []:
        return True
    if not isinstance(targets, list):
        return False
    d = (domain or "").strip()
    return bool(d) and d in [str(x) for x in targets]


@router.get("/announcements", response_model=List[TenantAnnouncementResponse])
async def list_sent_announcements_for_tenant(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    skip: int = 0,
    limit: int = 100,
):
    """Platform broadcasts with status=sent targeting this tenant or all tenants."""
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        return []
    domain = (tenant.domain or "").strip()

    rows = (
        db.query(PlatformBroadcast)
        .filter(PlatformBroadcast.status == "sent")
        .order_by(PlatformBroadcast.created_at.desc())
        .all()
    )

    matched: List[TenantAnnouncementResponse] = []
    for r in rows:
        if not _applies_to_domain(r.target_tenant_domains, domain):
            continue
        matched.append(
            TenantAnnouncementResponse(
                id=r.id,
                title=r.title,
                message=r.message,
                priority=r.priority,
                sent_at=r.sent_at,
                created_at=r.created_at,
            )
        )
    return matched[skip : skip + min(limit, 300)]
