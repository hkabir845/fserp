from fastapi import APIRouter, Depends, Request, HTTPException
from app.core.dependencies import get_tenant_id
from app.modules.tenancy.models import Tenant
from sqlalchemy.orm import Session
from app.core.dependencies import get_db
from pydantic import BaseModel

router = APIRouter()

class TenantResponse(BaseModel):
    id: int
    name: str
    domain: str
    is_active: bool
    
    class Config:
        from_attributes = True

@router.get("/resolve", response_model=TenantResponse)
async def resolve_tenant(
    request: Request,
    db: Session = Depends(get_db)
):
    """Resolve tenant for current request"""
    tenant_id = get_tenant_id(request)
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return tenant

