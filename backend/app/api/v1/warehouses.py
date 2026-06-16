from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.core.dependencies import get_db, get_current_user, get_tenant_id
from app.modules.inventory.models import Warehouse
from app.modules.tenancy.models import User
from pydantic import BaseModel
from fastapi import Request

router = APIRouter()

class WarehouseCreate(BaseModel):
    name: str
    address: str | None = None

class WarehouseResponse(BaseModel):
    id: int
    name: str
    address: str | None
    is_active: bool
    
    class Config:
        from_attributes = True

@router.get("", response_model=List[WarehouseResponse])
async def list_warehouses(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all warehouses for tenant"""
    tenant_id = get_tenant_id(request)
    warehouses = db.query(Warehouse).filter(
        Warehouse.tenant_id == tenant_id,
        Warehouse.is_active == True
    ).all()
    return warehouses

@router.post("", response_model=WarehouseResponse)
async def create_warehouse(
    warehouse_data: WarehouseCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new warehouse"""
    tenant_id = get_tenant_id(request)
    
    warehouse = Warehouse(
        tenant_id=tenant_id,
        name=warehouse_data.name,
        address=warehouse_data.address,
        created_by=current_user.id
    )
    db.add(warehouse)
    db.commit()
    db.refresh(warehouse)
    return warehouse

