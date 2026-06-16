from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.core.dependencies import get_db, get_current_user, get_tenant_id
from app.modules.catalog.models import Item
from app.modules.catalog.inventory_kind import apply_inventory_rules, infer_inventory_kind
from app.modules.catalog.sku_generator import generate_unique_item_sku
from app.modules.catalog.uom_resolve import resolve_item_uom_id
from app.modules.tenancy.models import User
from pydantic import BaseModel, model_validator
from fastapi import Request

router = APIRouter()


def _item_to_dict(item: Item) -> dict:
    kind = infer_inventory_kind(
        type_value=item.type,
        is_stock_tracked=item.is_stock_tracked,
        stored_kind=getattr(item, "inventory_kind", None),
    )
    return {
        "id": item.id,
        "tenant_id": item.tenant_id,
        "sku": item.sku,
        "name": item.name,
        "type": item.type,
        "inventory_kind": kind,
        "uom_id": item.uom_id,
        "category_id": item.category_id,
        "is_stock_tracked": item.is_stock_tracked,
        "is_active": item.is_active,
        "standard_cost": float(item.standard_cost) if item.standard_cost else None,
        "uom": {
            "id": item.uom.id,
            "code": item.uom.code,
            "name": item.uom.name,
        }
        if item.uom
        else None,
        "category": {
            "id": item.category.id,
            "name": item.category.name,
        }
        if item.category
        else None,
    }


class ItemCreate(BaseModel):
    """``sku`` optional — if omitted or blank, a unique code is generated from product type."""
    sku: str | None = None
    name: str
    type: str
    uom_id: int | None = None
    uom_code: str | None = None
    category_id: int | None = None
    # inventory | non_inventory | service | other — drives type + is_stock_tracked when set
    inventory_kind: str | None = None
    is_stock_tracked: bool = True
    standard_cost: float | None = None

    @model_validator(mode="after")
    def require_uom_reference(self):
        has_id = self.uom_id is not None
        has_code = self.uom_code is not None and str(self.uom_code).strip() != ""
        if not has_id and not has_code:
            raise ValueError("Either uom_id or uom_code is required")
        return self

class ItemResponse(BaseModel):
    id: int
    tenant_id: int
    sku: str
    name: str
    type: str
    inventory_kind: str
    uom_id: int
    category_id: int | None
    is_stock_tracked: bool
    is_active: bool
    standard_cost: float | None = None
    uom: dict | None = None
    category: dict | None = None
    
    class Config:
        from_attributes = True

@router.get("", response_model=List[ItemResponse])
async def list_items(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    skip: int = 0,
    limit: int = 1000,
    include_inactive: bool = True
):
    """List all items for tenant"""
    tenant_id = get_tenant_id(request)
    query = db.query(Item).filter(Item.tenant_id == tenant_id)
    
    if not include_inactive:
        query = query.filter(Item.is_active == True)
    
    items = query.order_by(Item.id).offset(skip).limit(limit).all()

    return [_item_to_dict(item) for item in items]

@router.post("", response_model=ItemResponse)
async def create_item(
    item_data: ItemCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new item"""
    tenant_id = get_tenant_id(request)

    resolved_uom_id = resolve_item_uom_id(
        db,
        tenant_id,
        uom_id=item_data.uom_id,
        uom_code=item_data.uom_code,
        user_id=current_user.id,
    )

    kind = item_data.inventory_kind
    if not kind or not str(kind).strip():
        kind = infer_inventory_kind(
            type_value=item_data.type,
            is_stock_tracked=item_data.is_stock_tracked,
            stored_kind=None,
        )
    else:
        kind = str(kind).strip()

    try:
        final_type, final_tracked = apply_inventory_rules(kind, type_value=item_data.type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    requested_sku = (item_data.sku or "").strip()
    if requested_sku:
        existing = db.query(Item).filter(
            Item.tenant_id == tenant_id,
            Item.sku == requested_sku,
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="SKU already exists")
        final_sku = requested_sku
    else:
        final_sku = generate_unique_item_sku(db, tenant_id, final_type)

    item = Item(
        tenant_id=tenant_id,
        sku=final_sku,
        name=item_data.name,
        type=final_type,
        uom_id=resolved_uom_id,
        category_id=item_data.category_id,
        is_stock_tracked=final_tracked,
        inventory_kind=kind,
        standard_cost=item_data.standard_cost,
        created_by=current_user.id
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _item_to_dict(item)

class ItemUpdate(BaseModel):
    sku: str | None = None
    name: str | None = None
    type: str | None = None
    inventory_kind: str | None = None
    uom_id: int | None = None
    uom_code: str | None = None
    category_id: int | None = None
    is_stock_tracked: bool | None = None
    is_active: bool | None = None
    standard_cost: float | None = None

@router.get("/{item_id}", response_model=ItemResponse)
async def get_item(
    item_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get item by ID"""
    tenant_id = get_tenant_id(request)
    item = db.query(Item).filter(
        Item.id == item_id,
        Item.tenant_id == tenant_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    return _item_to_dict(item)

@router.patch("/{item_id}", response_model=ItemResponse)
async def update_item(
    item_id: int,
    item_data: ItemUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update an item"""
    tenant_id = get_tenant_id(request)
    item = db.query(Item).filter(
        Item.id == item_id,
        Item.tenant_id == tenant_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    # Update fields — SKU: ignore blank PATCH bodies (do not clear to empty)
    if item_data.sku is not None and str(item_data.sku).strip():
        new_sku = str(item_data.sku).strip()
        if new_sku != item.sku:
            taken = db.query(Item).filter(
                Item.tenant_id == tenant_id,
                Item.sku == new_sku,
            ).first()
            if taken:
                raise HTTPException(status_code=400, detail="SKU already exists")
        item.sku = new_sku
    if item_data.name is not None:
        item.name = item_data.name

    if item_data.inventory_kind is not None and str(item_data.inventory_kind).strip():
        kind = str(item_data.inventory_kind).strip()
        try:
            wt, wtr = apply_inventory_rules(
                kind,
                type_value=item_data.type if item_data.type is not None else item.type,
            )
            item.type = wt
            item.is_stock_tracked = wtr
            item.inventory_kind = kind
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
    elif item_data.type is not None:
        item.type = item_data.type
        if item_data.type == "service":
            item.is_stock_tracked = False
            item.inventory_kind = "service"
        else:
            item.inventory_kind = infer_inventory_kind(
                type_value=item.type,
                is_stock_tracked=item.is_stock_tracked,
                stored_kind=getattr(item, "inventory_kind", None),
            )
    if item_data.uom_code is not None and str(item_data.uom_code).strip():
        item.uom_id = resolve_item_uom_id(
            db,
            tenant_id,
            uom_id=None,
            uom_code=item_data.uom_code,
            user_id=current_user.id,
        )
    elif item_data.uom_id is not None:
        item.uom_id = resolve_item_uom_id(
            db,
            tenant_id,
            uom_id=item_data.uom_id,
            uom_code=None,
            user_id=current_user.id,
        )
    if item_data.category_id is not None:
        item.category_id = item_data.category_id
    kind_was_set = item_data.inventory_kind is not None and str(item_data.inventory_kind).strip() != ""
    if not kind_was_set and item_data.is_stock_tracked is not None:
        item.is_stock_tracked = item_data.is_stock_tracked
        if item.type == "service":
            item.inventory_kind = "service"
        else:
            item.inventory_kind = infer_inventory_kind(
                type_value=item.type,
                is_stock_tracked=item.is_stock_tracked,
                stored_kind=getattr(item, "inventory_kind", None),
            )
    if item_data.is_active is not None:
        item.is_active = item_data.is_active
    if item_data.standard_cost is not None:
        from decimal import Decimal
        item.standard_cost = Decimal(str(item_data.standard_cost)) if item_data.standard_cost else None
    
    db.commit()
    db.refresh(item)
    
    return _item_to_dict(item)

@router.delete("/{item_id}")
async def delete_item(
    item_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Deactivate an item (soft delete: is_active=False). Rolls back if persistence fails."""
    tenant_id = get_tenant_id(request)
    try:
        item = db.query(Item).filter(
            Item.id == item_id,
            Item.tenant_id == tenant_id
        ).first()
        if not item:
            raise HTTPException(status_code=404, detail="Item not found")

        item.is_active = False
        db.commit()
        return {"message": "Item deleted successfully", "id": item_id, "is_active": False}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise

