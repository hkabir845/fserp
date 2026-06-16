from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.dependencies import get_db, get_current_user, get_tenant_id
from app.modules.livestock.models import Species, HerdFlock
from app.modules.tenancy.models import User

router = APIRouter()


class SpeciesResponse(BaseModel):
    id: int
    name: str
    category: str
    description: Optional[str] = None

    class Config:
        from_attributes = True


class HerdResponse(BaseModel):
    id: int
    name: str
    species_id: int
    species_name: Optional[str] = None
    purpose: str
    start_date: datetime
    initial_qty: float
    current_qty: float

    class Config:
        from_attributes = True


@router.get("/species", response_model=List[SpeciesResponse])
async def list_species(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List species for the current tenant."""
    tenant_id = get_tenant_id(request)
    rows = (
        db.query(Species)
        .filter(Species.tenant_id == tenant_id)
        .order_by(Species.name)
        .all()
    )
    return rows


@router.get("/herds", response_model=List[HerdResponse])
async def list_herds(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List herd/flock groups for the current tenant."""
    tenant_id = get_tenant_id(request)
    rows = (
        db.query(HerdFlock)
        .filter(HerdFlock.tenant_id == tenant_id)
        .order_by(HerdFlock.name)
        .all()
    )
    out: List[HerdResponse] = []
    for h in rows:
        sn = None
        try:
            if h.species:
                sn = h.species.name
        except Exception:
            sn = None
        out.append(
            HerdResponse(
                id=h.id,
                name=h.name,
                species_id=h.species_id,
                species_name=sn,
                purpose=h.purpose,
                start_date=h.start_date,
                initial_qty=float(h.initial_qty or 0),
                current_qty=float(h.current_qty or 0),
            )
        )
    return out
