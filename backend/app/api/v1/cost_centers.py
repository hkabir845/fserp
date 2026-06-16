"""Cost centers (profit / responsibility centers) for departmental reporting."""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.dependencies import get_db, get_current_user, require_tenant_id
from app.modules.accounting.models import CostCenter
from app.modules.tenancy.models import User

router = APIRouter()


class CostCenterCreate(BaseModel):
    code: str = Field(..., min_length=1, max_length=32)
    name: str = Field(..., min_length=1, max_length=256)


class CostCenterPatch(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=256)
    is_active: Optional[bool] = None


class CostCenterResponse(BaseModel):
    id: int
    code: str
    name: str
    is_active: bool

    class Config:
        from_attributes = True


@router.get("", response_model=List[CostCenterResponse])
async def list_cost_centers(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    active_only: bool = True,
):
    q = db.query(CostCenter).filter(CostCenter.tenant_id == tenant_id)
    if active_only:
        q = q.filter(CostCenter.is_active == True)
    return q.order_by(CostCenter.code).all()


@router.post("", response_model=CostCenterResponse)
async def create_cost_center(
    body: CostCenterCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    code = body.code.strip().upper()
    dup = (
        db.query(CostCenter)
        .filter(CostCenter.tenant_id == tenant_id, CostCenter.code == code)
        .first()
    )
    if dup:
        raise HTTPException(status_code=400, detail="Cost center code already exists")
    row = CostCenter(
        tenant_id=tenant_id,
        code=code,
        name=body.name.strip(),
        is_active=True,
        created_by=current_user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{cc_id}", response_model=CostCenterResponse)
async def patch_cost_center(
    cc_id: int,
    body: CostCenterPatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    row = db.query(CostCenter).filter(CostCenter.id == cc_id, CostCenter.tenant_id == tenant_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Cost center not found")
    if body.name is not None:
        row.name = body.name.strip()
    if body.is_active is not None:
        row.is_active = body.is_active
    db.commit()
    db.refresh(row)
    return row
