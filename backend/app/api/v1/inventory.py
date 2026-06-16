from collections import defaultdict
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from app.core.dependencies import get_db, get_current_user, get_tenant_id
from app.modules.inventory.stock_service import StockService
from app.modules.tenancy.models import User, Tenant
from pydantic import BaseModel
from fastapi import Request

router = APIRouter()

# Synthetic warehouse id for fuel held in station tanks (not warehouse stock ledger).
FUEL_STATION_WAREHOUSE_ID = -1


class StockResponse(BaseModel):
    item_id: int
    item_name: str
    warehouse_id: int
    warehouse_name: str
    current_stock: float
    tenant_id: Optional[int] = None
    tenant_name: Optional[str] = None
    stock_source: str = "warehouse"  # warehouse | fuel_tank

    class Config:
        from_attributes = True


def _tenant_label(db: Session, tenant_id: int) -> str:
    t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not t:
        return str(tenant_id)
    return t.name or t.domain or str(tenant_id)


def _stock_positions_for_tenant(db: Session, tenant_id: int) -> List[dict]:
    """All item×warehouse positions with on-hand > 0 for one tenant."""
    from app.modules.catalog.models import Item
    from app.modules.inventory.models import Warehouse
    from app.modules.fuel_station.models import FuelTank

    label = _tenant_label(db, tenant_id)
    items = db.query(Item).filter(Item.tenant_id == tenant_id, Item.is_stock_tracked == True).all()
    warehouses = db.query(Warehouse).filter(Warehouse.tenant_id == tenant_id).all()

    result: List[dict] = []
    for item in items:
        # Fuel SKUs are shown only via tank aggregation below; ledger uses a synthetic warehouse.
        if getattr(item, "type", None) == "fuel":
            continue
        for warehouse in warehouses:
            stock = StockService.get_current_stock(db, tenant_id, item.id, warehouse.id)
            if stock > 0:
                result.append(
                    {
                        "item_id": item.id,
                        "item_name": item.name,
                        "warehouse_id": warehouse.id,
                        "warehouse_name": warehouse.name,
                        "current_stock": float(stock),
                        "tenant_id": tenant_id,
                        "tenant_name": label,
                        "stock_source": "warehouse",
                    }
                )

    # Fuel catalog items: add aggregated liters in filling-station tanks (parallel to warehouse ledger).
    tanks = db.query(FuelTank).filter(FuelTank.tenant_id == tenant_id).all()
    liters_by_item: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    for t in tanks:
        liters_by_item[t.fuel_item_id] += t.current_stock_liters or Decimal("0")
    for item_id, liters in liters_by_item.items():
        if liters <= 0:
            continue
        item = (
            db.query(Item)
            .filter(Item.id == item_id, Item.tenant_id == tenant_id, Item.type == "fuel")
            .first()
        )
        if not item:
            continue
        result.append(
            {
                "item_id": item.id,
                "item_name": item.name,
                "warehouse_id": FUEL_STATION_WAREHOUSE_ID,
                "warehouse_name": "Fuel station tanks (aggregated)",
                "current_stock": float(liters),
                "tenant_id": tenant_id,
                "tenant_name": label,
                "stock_source": "fuel_tank",
            }
        )

    return result


@router.get("/stock", response_model=List[StockResponse])
async def get_current_stock(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    item_id: Optional[int] = None,
    warehouse_id: Optional[int] = None,
):
    """Get current stock levels for the resolved tenant (including domain 'master' for dev/demo)."""
    from app.modules.catalog.models import Item
    from app.modules.inventory.models import Warehouse

    tenant_id = get_tenant_id(request)
    if tenant_id is None:
        raise HTTPException(
            status_code=400,
            detail="Tenant context required for inventory stock (select a tenant or use tenant header).",
        )

    label = _tenant_label(db, tenant_id)

    # If specific item and warehouse requested
    if item_id and warehouse_id:
        stock = StockService.get_current_stock(db, tenant_id, item_id, warehouse_id)
        item = db.query(Item).filter(Item.id == item_id, Item.tenant_id == tenant_id).first()
        warehouse = db.query(Warehouse).filter(Warehouse.id == warehouse_id, Warehouse.tenant_id == tenant_id).first()

        if not item or not warehouse:
            raise HTTPException(status_code=404, detail="Item or warehouse not found")

        return [
            {
                "item_id": item.id,
                "item_name": item.name,
                "warehouse_id": warehouse.id,
                "warehouse_name": warehouse.name,
                "current_stock": float(stock),
                "tenant_id": tenant_id,
                "tenant_name": label,
                "stock_source": "warehouse",
            }
        ]

    return _stock_positions_for_tenant(db, tenant_id)


@router.get("/stock/{item_id}", response_model=dict)
async def get_item_stock(
    item_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    warehouse_id: Optional[int] = None,
    context_tenant_id: Optional[int] = Query(
        None,
        description="Optional override: tenant that owns this item (defaults to resolved request tenant).",
    ),
):
    """Get stock for a specific item."""
    tenant_id = context_tenant_id if context_tenant_id is not None else get_tenant_id(request)
    if tenant_id is None:
        raise HTTPException(
            status_code=400,
            detail="Tenant context required for inventory stock (select a tenant or use tenant header).",
        )

    stock = StockService.get_current_stock(db, tenant_id, item_id, warehouse_id)

    return {
        "item_id": item_id,
        "tenant_id": tenant_id,
        "warehouse_id": warehouse_id,
        "current_stock": float(stock),
    }

