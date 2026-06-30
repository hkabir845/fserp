"""
Feed Manufacturing API Endpoints
BOM/Feed Formulation module
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional, Dict
from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel
from fastapi import Request

from app.core.dependencies import get_db, get_current_user, get_tenant_id
from app.modules.tenancy.models import User
from app.modules.feed_manufacturing.models import (
    FeedProduct, Ingredient, FeedBom, FeedBomLine,
    ProductionOrder, ProductionOrderLine, BatchQC,
    BOMStatus, ProductionStatus, InclusionBasis, Silo, SiloTransaction,
)
from app.modules.feed_manufacturing.silo_service import SiloService
from app.modules.feed_manufacturing.production_rollback_service import (
    ProductionRollbackError,
    rollback_production_order,
)
from app.modules.feed_manufacturing.bom_service import BomService
from app.modules.catalog.models import Item, UOM
from app.modules.inventory.models import Warehouse
from app.modules.inventory.models import StockBalance, StockLedger
from app.modules.inventory.stock_service import StockService

router = APIRouter()

# ==================== Pydantic Models ====================

class FeedProductCreate(BaseModel):
    item_id: int
    category: str
    subtype: Optional[str] = None
    stage: Optional[str] = None
    pellet_size_mm: Optional[float] = None
    packaging: Optional[str] = None
    target_protein_pct: Optional[float] = None
    target_fat_pct: Optional[float] = None
    target_fiber_pct: Optional[float] = None
    target_moisture_pct: Optional[float] = None
    target_ash_pct: Optional[float] = None
    target_energy_kcal: Optional[float] = None
    requires_grinding: bool = False
    requires_extrusion: bool = False
    requires_pelleting: bool = False
    requires_drying: bool = False
    requires_coating: bool = False

class FeedProductResponse(BaseModel):
    id: int
    item_id: int
    category: str
    subtype: Optional[str]
    stage: Optional[str]
    pellet_size_mm: Optional[float]
    packaging: Optional[str]
    
    class Config:
        from_attributes = True

class IngredientCreate(BaseModel):
    item_id: int
    ingredient_type: str
    cost_method: str = "weighted_average"
    protein_pct: Optional[float] = None
    fat_pct: Optional[float] = None
    fiber_pct: Optional[float] = None
    ash_pct: Optional[float] = None
    moisture_pct: Optional[float] = None
    energy_kcal: Optional[float] = None
    is_premix: bool = False
    premix_unit: Optional[str] = None

class IngredientResponse(BaseModel):
    id: int
    item_id: int
    ingredient_type: str
    is_premix: bool
    
    class Config:
        from_attributes = True

class BomLineCreate(BaseModel):
    ingredient_id: int
    sequence: int = 0
    inclusion_basis: str  # percent, kg_per_ton, g_per_ton
    inclusion_value: float
    loss_factor_pct: float = 0.0
    phase: Optional[str] = None
    min_percent: Optional[float] = None
    max_percent: Optional[float] = None

class BomLineUpdate(BaseModel):
    sequence: Optional[int] = None
    inclusion_basis: Optional[str] = None
    inclusion_value: Optional[float] = None
    loss_factor_pct: Optional[float] = None
    phase: Optional[str] = None
    min_percent: Optional[float] = None
    max_percent: Optional[float] = None

class FeedBomCreate(BaseModel):
    bom_code: str
    product_id: int
    version: str = "1.0"
    default_batch_size_ton: float = 1.0
    process_type: str
    pellet_size_mm: Optional[float] = None
    is_floating: bool = False
    target_protein_pct: Optional[float] = None
    target_fat_pct: Optional[float] = None
    target_fiber_pct: Optional[float] = None
    target_moisture_pct: Optional[float] = None
    target_ash_pct: Optional[float] = None
    effective_from: Optional[str] = None
    notes: Optional[str] = None
    lines: List[BomLineCreate] = []

class FeedBomUpdate(BaseModel):
    default_batch_size_ton: Optional[float] = None
    process_type: Optional[str] = None
    pellet_size_mm: Optional[float] = None
    is_floating: Optional[bool] = None
    target_protein_pct: Optional[float] = None
    target_fat_pct: Optional[float] = None
    target_fiber_pct: Optional[float] = None
    target_moisture_pct: Optional[float] = None
    target_ash_pct: Optional[float] = None
    notes: Optional[str] = None

class FeedBomResponse(BaseModel):
    id: int
    bom_code: str
    product_id: int
    version: str
    status: str
    default_batch_size_ton: float
    process_type: str
    
    class Config:
        from_attributes = True

class BomLineResponse(BaseModel):
    id: int
    bom_id: int
    ingredient_id: int
    sequence: int
    inclusion_basis: str
    inclusion_value: float
    computed_kg: Optional[float]
    computed_percent: Optional[float]
    loss_factor_pct: float
    phase: Optional[str]
    
    class Config:
        from_attributes = True

class BomTotalsResponse(BaseModel):
    total_percent: float
    total_kg: float
    premix_total_g: float
    premix_total_kg: float
    is_valid: bool
    errors: List[str]

class BomCostResponse(BaseModel):
    total_cost: float
    cost_per_ton: float
    cost_per_kg: float
    ingredients: List[Dict]

class ProductionOrderCreate(BaseModel):
    bom_id: int
    batch_size_ton: float
    planned_date: Optional[str] = None
    warehouse_id: int
    notes: Optional[str] = None

class ProductionOrderUpdate(BaseModel):
    batch_size_ton: Optional[float] = None
    planned_date: Optional[str] = None
    warehouse_id: Optional[int] = None
    notes: Optional[str] = None

class ProductionOrderResponse(BaseModel):
    id: int
    order_number: str
    bom_id: int
    batch_size_ton: float
    status: str
    planned_output_kg: float
    actual_output_kg: Optional[float]
    
    class Config:
        from_attributes = True

class ProductionOrderLineResponse(BaseModel):
    id: int
    ingredient_id: int
    ingredient_item_id: Optional[int] = None
    ingredient_name: Optional[str] = None
    required_qty_kg: float
    required_qty_with_loss_kg: float
    consumed_qty_kg: Optional[float] = None
    unit_cost: Optional[float] = None
    total_cost: Optional[float] = None
    silo_id: Optional[int] = None
    silo_name: Optional[str] = None
    silo_consumed_kg: Optional[float] = None

    class Config:
        from_attributes = True

class ProductionOrderMetaResponse(BaseModel):
    order_id: int
    warehouse_id: int
    warehouse_name: Optional[str] = None
    finished_item_id: int
    finished_item_name: Optional[str] = None

class BatchQCCreate(BaseModel):
    actual_protein_pct: Optional[float] = None
    actual_fat_pct: Optional[float] = None
    actual_fiber_pct: Optional[float] = None
    actual_moisture_pct: Optional[float] = None
    actual_ash_pct: Optional[float] = None
    actual_energy_kcal: Optional[float] = None
    test_date: Optional[str] = None
    tested_by: Optional[str] = None
    notes: Optional[str] = None

# ==================== Feed Products ====================

@router.get("/feed-products", response_model=List[FeedProductResponse])
async def list_feed_products(
    request: Request,
    category: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List feed products"""
    tenant_id = get_tenant_id(request)
    query = db.query(FeedProduct).filter(FeedProduct.tenant_id == tenant_id)
    
    if category:
        query = query.filter(FeedProduct.category == category)
    
    return query.all()

@router.post("/feed-products", response_model=FeedProductResponse)
async def create_feed_product(
    product_data: FeedProductCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create feed product"""
    tenant_id = get_tenant_id(request)
    
    # Verify item exists
    item = db.query(Item).filter(Item.id == product_data.item_id, Item.tenant_id == tenant_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    product = FeedProduct(
        tenant_id=tenant_id,
        item_id=product_data.item_id,
        category=product_data.category,
        subtype=product_data.subtype,
        stage=product_data.stage,
        pellet_size_mm=Decimal(str(product_data.pellet_size_mm)) if product_data.pellet_size_mm else None,
        packaging=product_data.packaging,
        target_protein_pct=Decimal(str(product_data.target_protein_pct)) if product_data.target_protein_pct else None,
        target_fat_pct=Decimal(str(product_data.target_fat_pct)) if product_data.target_fat_pct else None,
        target_fiber_pct=Decimal(str(product_data.target_fiber_pct)) if product_data.target_fiber_pct else None,
        target_moisture_pct=Decimal(str(product_data.target_moisture_pct)) if product_data.target_moisture_pct else None,
        target_ash_pct=Decimal(str(product_data.target_ash_pct)) if product_data.target_ash_pct else None,
        target_energy_kcal=Decimal(str(product_data.target_energy_kcal)) if product_data.target_energy_kcal else None,
        requires_grinding=product_data.requires_grinding,
        requires_extrusion=product_data.requires_extrusion,
        requires_pelleting=product_data.requires_pelleting,
        requires_drying=product_data.requires_drying,
        requires_coating=product_data.requires_coating,
        created_by=current_user.id
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product

# ==================== Ingredients ====================

@router.get("/ingredients", response_model=List[IngredientResponse])
async def list_ingredients(
    request: Request,
    ingredient_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List ingredients"""
    tenant_id = get_tenant_id(request)
    query = db.query(Ingredient).filter(Ingredient.tenant_id == tenant_id)
    
    if ingredient_type:
        query = query.filter(Ingredient.ingredient_type == ingredient_type)
    
    return query.all()

@router.post("/ingredients", response_model=IngredientResponse)
async def create_ingredient(
    ingredient_data: IngredientCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create ingredient"""
    tenant_id = get_tenant_id(request)
    
    # Verify item exists
    item = db.query(Item).filter(Item.id == ingredient_data.item_id, Item.tenant_id == tenant_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    ingredient = Ingredient(
        tenant_id=tenant_id,
        item_id=ingredient_data.item_id,
        ingredient_type=ingredient_data.ingredient_type,
        cost_method=ingredient_data.cost_method,
        protein_pct=Decimal(str(ingredient_data.protein_pct)) if ingredient_data.protein_pct else None,
        fat_pct=Decimal(str(ingredient_data.fat_pct)) if ingredient_data.fat_pct else None,
        fiber_pct=Decimal(str(ingredient_data.fiber_pct)) if ingredient_data.fiber_pct else None,
        ash_pct=Decimal(str(ingredient_data.ash_pct)) if ingredient_data.ash_pct else None,
        moisture_pct=Decimal(str(ingredient_data.moisture_pct)) if ingredient_data.moisture_pct else None,
        energy_kcal=Decimal(str(ingredient_data.energy_kcal)) if ingredient_data.energy_kcal else None,
        is_premix=ingredient_data.is_premix,
        premix_unit=ingredient_data.premix_unit,
        created_by=current_user.id
    )
    db.add(ingredient)
    db.commit()
    db.refresh(ingredient)
    return ingredient

# ==================== BOM Management ====================

def get_bom_with_access_check(db: Session, bom_id: int, tenant_id: Optional[int]) -> FeedBom:
    """Helper to get BOM scoped to the current tenant."""
    query = db.query(FeedBom).filter(FeedBom.id == bom_id)
    if tenant_id is not None:
        query = query.filter(FeedBom.tenant_id == tenant_id)
    bom = query.first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")
    return bom

def get_production_order_with_access_check(db: Session, order_id: int, tenant_id: Optional[int]) -> ProductionOrder:
    """Helper to get production order scoped to the current tenant."""
    query = db.query(ProductionOrder).filter(ProductionOrder.id == order_id)
    if tenant_id is not None:
        query = query.filter(ProductionOrder.tenant_id == tenant_id)
    order = query.first()
    if not order:
        raise HTTPException(status_code=404, detail="Production order not found")
    return order

@router.get("/feed-boms", response_model=List[FeedBomResponse])
async def list_feed_boms(
    request: Request,
    product_id: Optional[int] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List feed BOMs for the current tenant."""
    tenant_id = get_tenant_id(request)
    import logging

    logger = logging.getLogger(__name__)
    logger.info(f"list_feed_boms: tenant_id={tenant_id}, product_id={product_id}, status={status}")

    query = db.query(FeedBom)
    if tenant_id is not None:
        query = query.filter(FeedBom.tenant_id == tenant_id)
    else:
        logger.warning("list_feed_boms: No tenant_id, returning empty list")
        return []
    
    if product_id:
        query = query.filter(FeedBom.product_id == product_id)
    if status:
        query = query.filter(FeedBom.status == status)
    
    results = query.order_by(FeedBom.bom_code, FeedBom.version).all()
    logger.info(f"list_feed_boms: Returning {len(results)} BOMs")
    return results

@router.post("/feed-boms", response_model=FeedBomResponse)
async def create_feed_bom(
    bom_data: FeedBomCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create feed BOM"""
    tenant_id = get_tenant_id(request)
    
    # Verify product exists
    product = db.query(FeedProduct).filter(
        FeedProduct.id == bom_data.product_id,
        FeedProduct.tenant_id == tenant_id
    ).first()
    if not product:
        raise HTTPException(status_code=404, detail="Feed product not found")
    
    # Check if bom_code + version already exists
    existing = db.query(FeedBom).filter(
        FeedBom.tenant_id == tenant_id,
        FeedBom.bom_code == bom_data.bom_code,
        FeedBom.version == bom_data.version
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"BOM {bom_data.bom_code} version {bom_data.version} already exists")
    
    effective_from = None
    if bom_data.effective_from:
        effective_from = datetime.fromisoformat(bom_data.effective_from)
    
    bom = FeedBom(
        tenant_id=tenant_id,
        bom_code=bom_data.bom_code,
        product_id=bom_data.product_id,
        version=bom_data.version,
        status=BOMStatus.DRAFT.value,
        default_batch_size_ton=Decimal(str(bom_data.default_batch_size_ton)),
        process_type=bom_data.process_type,
        pellet_size_mm=Decimal(str(bom_data.pellet_size_mm)) if bom_data.pellet_size_mm else None,
        is_floating=bom_data.is_floating,
        target_protein_pct=Decimal(str(bom_data.target_protein_pct)) if bom_data.target_protein_pct else None,
        target_fat_pct=Decimal(str(bom_data.target_fat_pct)) if bom_data.target_fat_pct else None,
        target_fiber_pct=Decimal(str(bom_data.target_fiber_pct)) if bom_data.target_fiber_pct else None,
        target_moisture_pct=Decimal(str(bom_data.target_moisture_pct)) if bom_data.target_moisture_pct else None,
        target_ash_pct=Decimal(str(bom_data.target_ash_pct)) if bom_data.target_ash_pct else None,
        effective_from=effective_from,
        notes=bom_data.notes,
        created_by=current_user.id
    )
    db.add(bom)
    db.flush()
    
    # Create BOM lines
    for line_data in bom_data.lines:
        line = FeedBomLine(
            tenant_id=tenant_id,
            bom_id=bom.id,
            ingredient_id=line_data.ingredient_id,
            sequence=line_data.sequence,
            inclusion_basis=line_data.inclusion_basis,
            inclusion_value=Decimal(str(line_data.inclusion_value)),
            loss_factor_pct=Decimal(str(line_data.loss_factor_pct)),
            phase=line_data.phase,
            min_percent=Decimal(str(line_data.min_percent)) if line_data.min_percent else None,
            max_percent=Decimal(str(line_data.max_percent)) if line_data.max_percent else None,
            created_by=current_user.id
        )
        db.add(line)
    
    # Compute totals
    BomService.compute_bom_totals(db, bom.id, bom.default_batch_size_ton)
    
    db.commit()
    db.refresh(bom)
    return bom

@router.get("/feed-boms/{bom_id}", response_model=FeedBomResponse)
async def get_feed_bom(
    bom_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get feed BOM by ID"""
    tenant_id = get_tenant_id(request)
    bom = get_bom_with_access_check(db, bom_id, tenant_id)
    return bom

@router.put("/feed-boms/{bom_id}", response_model=FeedBomResponse)
async def update_feed_bom(
    bom_id: int,
    bom_data: FeedBomUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update feed BOM (only draft BOMs can be updated)"""
    tenant_id = get_tenant_id(request)
    
    bom = get_bom_with_access_check(db, bom_id, tenant_id)
    
    if bom.status == BOMStatus.APPROVED.value:
        raise HTTPException(status_code=400, detail="Cannot modify approved BOM. Clone to create new version.")
    
    if bom.status == BOMStatus.ARCHIVED.value:
        raise HTTPException(status_code=400, detail="Cannot modify archived BOM.")
    
    # Update fields
    if bom_data.default_batch_size_ton is not None:
        bom.default_batch_size_ton = Decimal(str(bom_data.default_batch_size_ton))
    if bom_data.process_type is not None:
        bom.process_type = bom_data.process_type
    if bom_data.pellet_size_mm is not None:
        bom.pellet_size_mm = Decimal(str(bom_data.pellet_size_mm))
    if bom_data.is_floating is not None:
        bom.is_floating = bom_data.is_floating
    if bom_data.target_protein_pct is not None:
        bom.target_protein_pct = Decimal(str(bom_data.target_protein_pct))
    if bom_data.target_fat_pct is not None:
        bom.target_fat_pct = Decimal(str(bom_data.target_fat_pct))
    if bom_data.target_fiber_pct is not None:
        bom.target_fiber_pct = Decimal(str(bom_data.target_fiber_pct))
    if bom_data.target_moisture_pct is not None:
        bom.target_moisture_pct = Decimal(str(bom_data.target_moisture_pct))
    if bom_data.target_ash_pct is not None:
        bom.target_ash_pct = Decimal(str(bom_data.target_ash_pct))
    if bom_data.notes is not None:
        bom.notes = bom_data.notes
    
    db.commit()
    db.refresh(bom)
    return bom

@router.delete("/feed-boms/{bom_id}")
async def delete_feed_bom(
    bom_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete feed BOM (only draft BOMs can be deleted, and only if not used in production orders)"""
    tenant_id = get_tenant_id(request)
    
    bom = get_bom_with_access_check(db, bom_id, tenant_id)
    
    # Check if BOM is used in production orders
    production_orders = db.query(ProductionOrder).filter(
        ProductionOrder.bom_id == bom_id
    ).count()
    
    if production_orders > 0:
        raise HTTPException(
            status_code=400, 
            detail=f"Cannot delete BOM. It is used in {production_orders} production order(s). Archive it instead."
        )
    
    # Only allow deletion of draft BOMs
    if bom.status != BOMStatus.DRAFT.value:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete BOM with status '{bom.status}'. Only draft BOMs can be deleted. Archive it instead."
        )
    
    # Delete BOM lines (cascade should handle this, but being explicit)
    db.query(FeedBomLine).filter(FeedBomLine.bom_id == bom_id).delete()
    
    # Delete BOM
    db.delete(bom)
    db.commit()
    
    return {"message": "BOM deleted successfully"}

@router.get("/feed-boms/{bom_id}/lines", response_model=List[BomLineResponse])
async def get_bom_lines(
    bom_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get BOM lines"""
    tenant_id = get_tenant_id(request)
    
    # First verify BOM exists and user has access
    bom_query = db.query(FeedBom).filter(FeedBom.id == bom_id)
    if tenant_id is not None:
        bom_query = bom_query.filter(FeedBom.tenant_id == tenant_id)

    bom = bom_query.first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")

    lines_query = db.query(FeedBomLine).filter(FeedBomLine.bom_id == bom_id)
    if tenant_id is not None:
        lines_query = lines_query.filter(FeedBomLine.tenant_id == tenant_id)
    
    lines = lines_query.order_by(FeedBomLine.sequence).all()
    
    return lines

@router.post("/feed-boms/{bom_id}/lines", response_model=BomLineResponse)
async def add_bom_line(
    bom_id: int,
    line_data: BomLineCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Add BOM line"""
    tenant_id = get_tenant_id(request)
    
    bom = get_bom_with_access_check(db, bom_id, tenant_id)
    tenant_id = bom.tenant_id

    if bom.status == BOMStatus.APPROVED.value:
        raise HTTPException(status_code=400, detail="Cannot modify approved BOM. Clone to create new version.")
    
    line = FeedBomLine(
        tenant_id=tenant_id,
        bom_id=bom_id,
        ingredient_id=line_data.ingredient_id,
        sequence=line_data.sequence,
        inclusion_basis=line_data.inclusion_basis,
        inclusion_value=Decimal(str(line_data.inclusion_value)),
        loss_factor_pct=Decimal(str(line_data.loss_factor_pct)),
        phase=line_data.phase,
        min_percent=Decimal(str(line_data.min_percent)) if line_data.min_percent else None,
        max_percent=Decimal(str(line_data.max_percent)) if line_data.max_percent else None,
        created_by=current_user.id
    )
    db.add(line)
    
    # Recompute totals
    BomService.compute_bom_totals(db, bom_id, bom.default_batch_size_ton)
    
    db.commit()
    db.refresh(line)
    return line

@router.put("/feed-boms/{bom_id}/lines/{line_id}", response_model=BomLineResponse)
async def update_bom_line(
    bom_id: int,
    line_id: int,
    line_data: BomLineUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update BOM line"""
    tenant_id = get_tenant_id(request)
    
    bom = get_bom_with_access_check(db, bom_id, tenant_id)
    
    if bom.status == BOMStatus.APPROVED.value:
        raise HTTPException(status_code=400, detail="Cannot modify approved BOM. Clone to create new version.")
    
    line_tenant_id = bom.tenant_id
    line = db.query(FeedBomLine).filter(
        FeedBomLine.id == line_id,
        FeedBomLine.bom_id == bom_id,
        FeedBomLine.tenant_id == line_tenant_id
    ).first()
    if not line:
        raise HTTPException(status_code=404, detail="BOM line not found")
    
    if line_data.sequence is not None:
        line.sequence = line_data.sequence
    if line_data.inclusion_basis:
        line.inclusion_basis = line_data.inclusion_basis
    if line_data.inclusion_value is not None:
        line.inclusion_value = Decimal(str(line_data.inclusion_value))
    if line_data.loss_factor_pct is not None:
        line.loss_factor_pct = Decimal(str(line_data.loss_factor_pct))
    if line_data.phase is not None:
        line.phase = line_data.phase
    if line_data.min_percent is not None:
        line.min_percent = Decimal(str(line_data.min_percent))
    if line_data.max_percent is not None:
        line.max_percent = Decimal(str(line_data.max_percent))
    
    # Recompute totals
    BomService.compute_bom_totals(db, bom_id, bom.default_batch_size_ton)
    
    db.commit()
    db.refresh(line)
    return line

@router.delete("/feed-boms/{bom_id}/lines/{line_id}")
async def delete_bom_line(
    bom_id: int,
    line_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete BOM line"""
    tenant_id = get_tenant_id(request)
    
    bom = get_bom_with_access_check(db, bom_id, tenant_id)
    
    if bom.status == BOMStatus.APPROVED.value:
        raise HTTPException(status_code=400, detail="Cannot modify approved BOM. Clone to create new version.")
    
    line_tenant_id = bom.tenant_id
    line = db.query(FeedBomLine).filter(
        FeedBomLine.id == line_id,
        FeedBomLine.bom_id == bom_id,
        FeedBomLine.tenant_id == line_tenant_id
    ).first()
    if not line:
        raise HTTPException(status_code=404, detail="BOM line not found")
    
    db.delete(line)
    
    # Recompute totals
    BomService.compute_bom_totals(db, bom_id, bom.default_batch_size_ton)
    
    db.commit()
    return {"message": "BOM line deleted"}

@router.post("/feed-boms/{bom_id}/compute-totals", response_model=BomTotalsResponse)
async def compute_bom_totals(
    bom_id: int,
    batch_size_ton: Optional[float] = None,
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Compute and validate BOM totals"""
    if request is None:
        raise HTTPException(status_code=400, detail="Request required")
    tenant_id = get_tenant_id(request)
    
    bom = get_bom_with_access_check(db, bom_id, tenant_id)
    
    batch_size = Decimal(str(batch_size_ton)) if batch_size_ton else bom.default_batch_size_ton
    
    result = BomService.compute_bom_totals(db, bom_id, batch_size)
    
    return {
        'total_percent': float(result['total_percent']),
        'total_kg': float(result['total_kg']),
        'premix_total_g': float(result['premix_total_g']),
        'premix_total_kg': float(result['premix_total_kg']),
        'is_valid': result['is_valid'],
        'errors': result['errors']
    }

@router.post("/feed-boms/{bom_id}/approve", response_model=FeedBomResponse)
async def approve_bom(
    bom_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Approve BOM (locks it from editing)"""
    tenant_id = get_tenant_id(request)
    
    bom = get_bom_with_access_check(db, bom_id, tenant_id)
    
    if bom.status == BOMStatus.APPROVED.value:
        raise HTTPException(status_code=400, detail="BOM is already approved")
    
    # Validate totals before approval
    result = BomService.compute_bom_totals(db, bom_id, bom.default_batch_size_ton)
    if not result['is_valid']:
        raise HTTPException(status_code=400, detail=f"BOM validation failed: {', '.join(result['errors'])}")
    
    bom.status = BOMStatus.APPROVED.value
    if not bom.effective_from:
        bom.effective_from = datetime.utcnow()
    
    db.commit()
    db.refresh(bom)
    return bom

@router.post("/feed-boms/{bom_id}/clone", response_model=FeedBomResponse)
async def clone_bom(
    bom_id: int,
    new_version: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Clone BOM to new version"""
    tenant_id = get_tenant_id(request)
    
    original_bom = get_bom_with_access_check(db, bom_id, tenant_id)

    clone_tenant_id = original_bom.tenant_id
    
    # Check if new version already exists
    existing = db.query(FeedBom).filter(
        FeedBom.tenant_id == clone_tenant_id,
        FeedBom.bom_code == original_bom.bom_code,
        FeedBom.version == new_version
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"BOM {original_bom.bom_code} version {new_version} already exists")
    
    # Create new BOM
    new_bom = FeedBom(
        tenant_id=clone_tenant_id,
        bom_code=original_bom.bom_code,
        product_id=original_bom.product_id,
        version=new_version,
        status=BOMStatus.DRAFT.value,
        default_batch_size_ton=original_bom.default_batch_size_ton,
        process_type=original_bom.process_type,
        pellet_size_mm=original_bom.pellet_size_mm,
        is_floating=original_bom.is_floating,
        target_protein_pct=original_bom.target_protein_pct,
        target_fat_pct=original_bom.target_fat_pct,
        target_fiber_pct=original_bom.target_fiber_pct,
        target_moisture_pct=original_bom.target_moisture_pct,
        target_ash_pct=original_bom.target_ash_pct,
        notes=original_bom.notes,
        created_by=current_user.id
    )
    db.add(new_bom)
    db.flush()
    
    # Clone lines
    original_lines = db.query(FeedBomLine).filter(
        FeedBomLine.bom_id == bom_id,
        FeedBomLine.tenant_id == clone_tenant_id
    ).all()
    
    for orig_line in original_lines:
        new_line = FeedBomLine(
            tenant_id=clone_tenant_id,
            bom_id=new_bom.id,
            ingredient_id=orig_line.ingredient_id,
            sequence=orig_line.sequence,
            inclusion_basis=orig_line.inclusion_basis,
            inclusion_value=orig_line.inclusion_value,
            loss_factor_pct=orig_line.loss_factor_pct,
            phase=orig_line.phase,
            min_percent=orig_line.min_percent,
            max_percent=orig_line.max_percent,
            created_by=current_user.id
        )
        db.add(new_line)
    
    # Compute totals
    BomService.compute_bom_totals(db, new_bom.id, new_bom.default_batch_size_ton)
    
    db.commit()
    db.refresh(new_bom)
    return new_bom

@router.get("/feed-boms/{bom_id}/costing", response_model=BomCostResponse)
async def get_bom_costing(
    bom_id: int,
    batch_size_ton: Optional[float] = None,
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get BOM cost breakdown"""
    if request is None:
        raise HTTPException(status_code=400, detail="Request required")
    tenant_id = get_tenant_id(request)
    
    bom = get_bom_with_access_check(db, bom_id, tenant_id)
    
    batch_size = Decimal(str(batch_size_ton)) if batch_size_ton else bom.default_batch_size_ton
    
    result = BomService.calculate_bom_cost(db, bom_id, batch_size)
    
    return {
        'total_cost': float(result['total_cost']),
        'cost_per_ton': float(result['cost_per_ton']),
        'cost_per_kg': float(result['cost_per_kg']),
        'ingredients': result['ingredients']
    }

# ==================== Production Orders ====================

@router.post("/production-orders", response_model=ProductionOrderResponse)
async def create_production_order(
    order_data: ProductionOrderCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create production order from approved BOM"""
    tenant_id = get_tenant_id(request)
    
    # Verify BOM exists and is approved
    bom = db.query(FeedBom).filter(
        FeedBom.id == order_data.bom_id,
        FeedBom.tenant_id == tenant_id
    ).first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")
    
    if bom.status != BOMStatus.APPROVED.value:
        raise HTTPException(status_code=400, detail="BOM must be approved to create production order")
    
    # Verify warehouse
    warehouse = db.query(Warehouse).filter(
        Warehouse.id == order_data.warehouse_id,
        Warehouse.tenant_id == tenant_id
    ).first()
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    
    # Generate batch number (tenant-scoped, sequential, year-based)
    # Format: BATCH-YYYY-000001
    year = datetime.utcnow().strftime('%Y')
    prefix = f"BATCH-{year}-"
    last = (
        db.query(ProductionOrder)
        .filter(ProductionOrder.tenant_id == tenant_id, ProductionOrder.order_number.like(f"{prefix}%"))
        .order_by(ProductionOrder.order_number.desc())
        .first()
    )
    next_seq = 1
    if last and last.order_number:
        try:
            next_seq = int(str(last.order_number).split('-')[-1]) + 1
        except Exception:
            next_seq = 1
    order_number = f"{prefix}{next_seq:06d}"
    
    batch_size_ton = Decimal(str(order_data.batch_size_ton))
    batch_size_kg = batch_size_ton * Decimal("1000")
    
    planned_date = None
    if order_data.planned_date:
        planned_date = datetime.fromisoformat(order_data.planned_date)
    
    # Compute requirements from BOM
    bom_lines = db.query(FeedBomLine).filter(
        FeedBomLine.bom_id == bom.id,
        FeedBomLine.tenant_id == tenant_id
    ).all()
    
    # Recompute totals for the batch size
    BomService.compute_bom_totals(db, bom.id, batch_size_ton)
    
    # Create production order
    order = ProductionOrder(
        tenant_id=tenant_id,
        order_number=order_number,
        bom_id=bom.id,
        batch_size_ton=batch_size_ton,
        batch_size_kg=batch_size_kg,
        status=ProductionStatus.DRAFT.value,
        planned_date=planned_date,
        planned_output_kg=batch_size_kg,  # Assuming 100% yield initially
        warehouse_id=order_data.warehouse_id,
        notes=order_data.notes,
        created_by=current_user.id
    )
    db.add(order)
    db.flush()
    
    # Create order lines (ingredient requirements)
    for bom_line in bom_lines:
        # Get required qty (use computed_kg)
        required_kg = bom_line.computed_kg or Decimal("0")
        
        # Get unit cost from inventory
        from app.modules.catalog.models import Item
        ingredient = db.query(Ingredient).filter(Ingredient.id == bom_line.ingredient_id).first()
        if ingredient:
            item = db.query(Item).filter(Item.id == ingredient.item_id).first()
            unit_cost = item.standard_cost or Decimal("0")
        else:
            unit_cost = Decimal("0")
        
        order_line = ProductionOrderLine(
            tenant_id=tenant_id,
            order_id=order.id,
            ingredient_id=bom_line.ingredient_id,
            bom_line_id=bom_line.id,
            required_qty_kg=required_kg,
            required_qty_with_loss_kg=required_kg,  # Already includes loss in computed_kg
            unit_cost=unit_cost,
            total_cost=required_kg * unit_cost,
            created_by=current_user.id
        )
        db.add(order_line)
    
    # Calculate total material cost
    total_material_cost = sum(line.total_cost for line in order.order_lines if line.total_cost)
    order.material_cost = total_material_cost
    order.total_cost = total_material_cost + (order.overhead_cost or Decimal("0"))
    if batch_size_kg > 0:
        order.cost_per_kg = order.total_cost / batch_size_kg
    
    db.commit()
    db.refresh(order)
    return order

class PostProductionRequest(BaseModel):
    actual_output_kg: float
    yield_pct: Optional[float] = None

@router.post("/production-orders/{order_id}/post", response_model=ProductionOrderResponse)
async def post_production_order(
    order_id: int,
    post_data: PostProductionRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Post production order - consume materials and produce finished goods"""
    tenant_id = get_tenant_id(request)
    
    order = db.query(ProductionOrder).filter(
        ProductionOrder.id == order_id,
        ProductionOrder.tenant_id == tenant_id
    ).first()
    if not order:
        raise HTTPException(status_code=404, detail="Production order not found")
    
    if order.status != ProductionStatus.DRAFT.value:
        raise HTTPException(status_code=400, detail="Order must be in draft status to post")
    
    bom = db.query(FeedBom).filter(FeedBom.id == order.bom_id).first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")
    
    product = db.query(FeedProduct).filter(FeedProduct.id == bom.product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    
    txn_date = datetime.utcnow()
    
    # Consume materials
    order_lines = db.query(ProductionOrderLine).filter(
        ProductionOrderLine.order_id == order_id,
        ProductionOrderLine.tenant_id == tenant_id
    ).all()
    
    for order_line in order_lines:
        ingredient = db.query(Ingredient).filter(Ingredient.id == order_line.ingredient_id).first()
        if not ingredient:
            continue
        
        consumed_qty = order_line.required_qty_with_loss_kg
        
        # Get FIFO cost
        unit_cost = StockService.get_fifo_cost(
            db=db,
            tenant_id=tenant_id,
            item_id=ingredient.item_id,
            warehouse_id=order.warehouse_id,
            qty=consumed_qty
        )
        
        if unit_cost == 0:
            unit_cost = order_line.unit_cost or Decimal("0")
        
        # Post stock out
        StockService.create_stock_move(
            db=db,
            tenant_id=tenant_id,
            item_id=ingredient.item_id,
            warehouse_id=order.warehouse_id,
            qty_in=Decimal("0"),
            qty_out=consumed_qty,
            unit_cost=unit_cost,
            txn_type="issue",
            ref_type="production_consumption",
            ref_id=order.id,
            txn_date=txn_date,
            notes=f"Production Order {order.order_number}",
            created_by=current_user.id
        )

        # Optional silo draw (same kg as warehouse issue; skipped if already recorded via material issue)
        if order_line.silo_id and order_line.silo_consumed_kg is None:
            try:
                SiloService.consume(
                    db=db,
                    tenant_id=tenant_id,
                    silo_id=order_line.silo_id,
                    qty_kg=consumed_qty,
                    ref_type="production_consumption",
                    ref_id=order.id,
                    notes=f"Production Order {order.order_number}",
                    user_id=current_user.id,
                )
                order_line.silo_consumed_kg = consumed_qty
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
        
        # Update order line
        order_line.consumed_qty_kg = consumed_qty
        order_line.unit_cost = unit_cost
        order_line.total_cost = consumed_qty * unit_cost
    
    # Produce finished goods
    actual_output = Decimal(str(post_data.actual_output_kg))
    
    # Calculate cost per kg
    total_material_cost = sum(line.total_cost for line in order_lines if line.total_cost)
    if actual_output > 0:
        cost_per_kg = (total_material_cost + (order.overhead_cost or Decimal("0"))) / actual_output
    else:
        cost_per_kg = Decimal("0")
    
    # Post stock in
    StockService.create_stock_move(
        db=db,
        tenant_id=tenant_id,
        item_id=product.item_id,
        warehouse_id=order.warehouse_id,
        qty_in=actual_output,
        qty_out=Decimal("0"),
        unit_cost=cost_per_kg,
        txn_type="produce",
        ref_type="production_output",
        ref_id=order.id,
        txn_date=txn_date,
        notes=f"Production Order {order.order_number}",
        created_by=current_user.id
    )
    
    # Update order
    order.status = ProductionStatus.COMPLETED.value
    order.start_date = txn_date
    order.end_date = txn_date
    order.actual_output_kg = actual_output
    if post_data.yield_pct:
        order.yield_pct = Decimal(str(post_data.yield_pct))
    else:
        if order.planned_output_kg > 0:
            order.yield_pct = (actual_output / order.planned_output_kg) * Decimal("100")
    
    order.material_cost = total_material_cost
    order.total_cost = total_material_cost + (order.overhead_cost or Decimal("0"))
    order.cost_per_kg = cost_per_kg
    
    db.commit()
    db.refresh(order)
    return order

@router.get("/production-orders", response_model=List[ProductionOrderResponse])
async def list_production_orders(
    request: Request,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List production orders for the current tenant."""
    tenant_id = get_tenant_id(request)

    query = db.query(ProductionOrder)
    if tenant_id is not None:
        query = query.filter(ProductionOrder.tenant_id == tenant_id)
    
    if status:
        query = query.filter(ProductionOrder.status == status)
    
    return query.order_by(ProductionOrder.created_at.desc()).all()

@router.get("/production-orders/{order_id}", response_model=ProductionOrderResponse)
async def get_production_order(
    order_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get production order by ID"""
    tenant_id = get_tenant_id(request)
    
    order = get_production_order_with_access_check(db, order_id, tenant_id)
    return order

@router.put("/production-orders/{order_id}", response_model=ProductionOrderResponse)
async def update_production_order(
    order_id: int,
    order_data: ProductionOrderUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update production order (only draft orders can be updated)"""
    tenant_id = get_tenant_id(request)
    
    order = get_production_order_with_access_check(db, order_id, tenant_id)
    
    # Only allow editing draft orders
    if order.status != ProductionStatus.DRAFT.value:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot modify production order with status '{order.status}'. Only draft orders can be edited."
        )
    
    # Update fields
    if order_data.batch_size_ton is not None:
        order.batch_size_ton = Decimal(str(order_data.batch_size_ton))
        order.batch_size_kg = order.batch_size_ton * Decimal("1000")
        order.planned_output_kg = order.batch_size_kg  # Update planned output
    
    if order_data.planned_date is not None:
        order.planned_date = datetime.fromisoformat(order_data.planned_date) if order_data.planned_date else None
    
    if order_data.warehouse_id is not None:
        # Verify warehouse exists
        warehouse = db.query(Warehouse).filter(
            Warehouse.id == order_data.warehouse_id,
            Warehouse.tenant_id == order.tenant_id
        ).first()
        if not warehouse:
            raise HTTPException(status_code=404, detail="Warehouse not found")
        order.warehouse_id = order_data.warehouse_id
    
    if order_data.notes is not None:
        order.notes = order_data.notes
    
    # Recalculate costs if batch size changed
    if order_data.batch_size_ton is not None:
        # Recompute order lines and costs
        bom_lines = db.query(FeedBomLine).filter(
            FeedBomLine.bom_id == order.bom_id,
            FeedBomLine.tenant_id == order.tenant_id
        ).all()
        
        total_material_cost = Decimal("0")
        for bom_line in bom_lines:
            # Calculate required qty for new batch size
            if bom_line.inclusion_basis == "percent":
                required_kg = (bom_line.inclusion_value / Decimal("100")) * order.batch_size_kg
            elif bom_line.inclusion_basis == "kg_per_ton":
                required_kg = (bom_line.inclusion_value / Decimal("1000")) * order.batch_size_kg
            else:  # g_per_ton
                required_kg = (bom_line.inclusion_value / Decimal("1000000")) * order.batch_size_kg
            
            # Update order line if exists
            order_line = db.query(ProductionOrderLine).filter(
                ProductionOrderLine.order_id == order.id,
                ProductionOrderLine.bom_line_id == bom_line.id
            ).first()
            
            if order_line:
                order_line.required_qty_kg = required_kg.quantize(Decimal("0.001"))
                order_line.required_qty_with_loss_kg = required_kg.quantize(Decimal("0.001"))
                if order_line.unit_cost:
                    order_line.total_cost = order_line.required_qty_kg * order_line.unit_cost
                    total_material_cost += order_line.total_cost
        
        order.material_cost = total_material_cost
        order.total_cost = total_material_cost + (order.overhead_cost or Decimal("0"))
        if order.batch_size_kg > 0:
            order.cost_per_kg = order.total_cost / order.batch_size_kg
    
    db.commit()
    db.refresh(order)
    return order

@router.delete("/production-orders/{order_id}")
async def delete_production_order(
    order_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete production order (only draft orders can be deleted)"""
    tenant_id = get_tenant_id(request)
    
    order = get_production_order_with_access_check(db, order_id, tenant_id)
    
    # Only allow deletion of draft orders
    if order.status != ProductionStatus.DRAFT.value:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete production order with status '{order.status}'. Only draft orders can be deleted. Cancel it instead."
        )
    
    # Delete order lines (cascade should handle this, but being explicit)
    db.query(ProductionOrderLine).filter(ProductionOrderLine.order_id == order_id).delete()
    
    # Delete order
    db.delete(order)
    db.commit()
    
    return {"message": "Production order deleted successfully"}

@router.post("/production-orders/{order_id}/cancel")
async def cancel_production_order(
    order_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Cancel production order (draft or planned orders can be cancelled)"""
    tenant_id = get_tenant_id(request)
    
    order = get_production_order_with_access_check(db, order_id, tenant_id)
    
    # Only allow cancellation of draft or planned orders
    if order.status not in [ProductionStatus.DRAFT.value, ProductionStatus.PLANNED.value]:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel production order with status '{order.status}'. Only draft or planned orders can be cancelled."
        )
    
    order.status = ProductionStatus.CANCELLED.value
    db.commit()
    db.refresh(order)
    
    return {"message": "Production order cancelled successfully", "order": order}

@router.get("/production-orders/{order_id}/lines", response_model=List[ProductionOrderLineResponse])
async def get_production_order_lines(
    order_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get ingredient requirement/consumption lines for a production order"""
    tenant_id = get_tenant_id(request)
    
    order = get_production_order_with_access_check(db, order_id, tenant_id)
    
    lines_query = db.query(ProductionOrderLine).filter(
        ProductionOrderLine.order_id == order_id,
        ProductionOrderLine.tenant_id == order.tenant_id,
    )
    
    lines = lines_query.all()
    
    result: List[Dict] = []
    for line in lines:
        ingredient_item_id = None
        ingredient_name = None
        if line.ingredient and line.ingredient.item:
            ingredient_item_id = line.ingredient.item.id
            ingredient_name = line.ingredient.item.name
        
        silo_name = None
        if line.silo:
            silo_name = line.silo.name

        result.append({
            "id": line.id,
            "ingredient_id": line.ingredient_id,
            "ingredient_item_id": ingredient_item_id,
            "ingredient_name": ingredient_name,
            "required_qty_kg": float(line.required_qty_kg or 0),
            "required_qty_with_loss_kg": float(line.required_qty_with_loss_kg or 0),
            "consumed_qty_kg": float(line.consumed_qty_kg) if line.consumed_qty_kg is not None else None,
            "unit_cost": float(line.unit_cost) if line.unit_cost is not None else None,
            "total_cost": float(line.total_cost) if line.total_cost is not None else None,
            "silo_id": line.silo_id,
            "silo_name": silo_name,
            "silo_consumed_kg": float(line.silo_consumed_kg) if line.silo_consumed_kg is not None else None,
        })
    
    return result

@router.get("/production-orders/{order_id}/meta", response_model=ProductionOrderMetaResponse)
async def get_production_order_meta(
    order_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get derived metadata needed for execution (finished item, warehouse)."""
    tenant_id = get_tenant_id(request)
    
    order = get_production_order_with_access_check(db, order_id, tenant_id)
    
    bom = db.query(FeedBom).filter(FeedBom.id == order.bom_id, FeedBom.tenant_id == tenant_id).first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")
    
    product = db.query(FeedProduct).filter(FeedProduct.id == bom.product_id, FeedProduct.tenant_id == tenant_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Feed product not found")
    
    finished_item = db.query(Item).filter(Item.id == product.item_id, Item.tenant_id == tenant_id).first()
    if not finished_item:
        raise HTTPException(status_code=404, detail="Finished item not found")
    
    warehouse = db.query(Warehouse).filter(Warehouse.id == order.warehouse_id, Warehouse.tenant_id == tenant_id).first()
    return {
        "order_id": order.id,
        "warehouse_id": order.warehouse_id,
        "warehouse_name": warehouse.name if warehouse else None,
        "finished_item_id": finished_item.id,
        "finished_item_name": finished_item.name,
    }


class ProductionOrderLineSiloPatch(BaseModel):
    silo_id: Optional[int] = None


@router.put("/production-orders/{order_id}/lines/{line_id}/silo")
async def patch_production_order_line_silo(
    order_id: int,
    line_id: int,
    body: ProductionOrderLineSiloPatch,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Assign or clear the bulk silo for an ingredient line (draft/planned orders only)."""
    tenant_id = get_tenant_id(request)
    order = get_production_order_with_access_check(db, order_id, tenant_id)
    if order.status not in ["draft", "planned"]:
        raise HTTPException(status_code=400, detail="Can only set silo on draft or planned orders")

    line = (
        db.query(ProductionOrderLine)
        .filter(
            ProductionOrderLine.id == line_id,
            ProductionOrderLine.order_id == order_id,
            ProductionOrderLine.tenant_id == tenant_id,
        )
        .first()
    )
    if not line:
        raise HTTPException(status_code=404, detail="Order line not found")

    if body.silo_id is None:
        line.silo_id = None
        db.commit()
        return {"message": "Silo cleared", "line_id": line.id}

    ingredient = db.query(Ingredient).filter(Ingredient.id == line.ingredient_id, Ingredient.tenant_id == tenant_id).first()
    if not ingredient:
        raise HTTPException(status_code=400, detail="Ingredient not found")

    silo = db.query(Silo).filter(Silo.id == body.silo_id, Silo.tenant_id == tenant_id).first()
    if not silo:
        raise HTTPException(status_code=404, detail="Silo not found")
    if silo.warehouse_id != order.warehouse_id:
        raise HTTPException(status_code=400, detail="Silo must be in the same warehouse as the production order")
    if silo.item_id != ingredient.item_id:
        raise HTTPException(status_code=400, detail="Silo stores a different item than this ingredient")

    line.silo_id = silo.id
    db.commit()
    return {"message": "Silo assigned", "line_id": line.id, "silo_id": silo.id}

# ==================== Quality Control ====================

@router.post("/production-orders/{order_id}/qc", response_model=Dict)
async def save_batch_qc(
    order_id: int,
    qc_data: BatchQCCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Save batch QC results"""
    tenant_id = get_tenant_id(request)
    
    order = db.query(ProductionOrder).filter(
        ProductionOrder.id == order_id,
        ProductionOrder.tenant_id == tenant_id
    ).first()
    if not order:
        raise HTTPException(status_code=404, detail="Production order not found")
    
    bom = db.query(FeedBom).filter(FeedBom.id == order.bom_id).first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")
    
    # Check if QC already exists
    qc = db.query(BatchQC).filter(
        BatchQC.order_id == order_id,
        BatchQC.tenant_id == tenant_id
    ).first()
    
    if not qc:
        qc = BatchQC(
            tenant_id=tenant_id,
            order_id=order_id,
            created_by=current_user.id
        )
        db.add(qc)
    
    # Update QC values
    if qc_data.actual_protein_pct is not None:
        qc.actual_protein_pct = Decimal(str(qc_data.actual_protein_pct))
        if bom.target_protein_pct:
            tolerance = Decimal("0.5")  # 0.5% tolerance
            qc.protein_pass = abs(qc.actual_protein_pct - bom.target_protein_pct) <= tolerance
    
    if qc_data.actual_fat_pct is not None:
        qc.actual_fat_pct = Decimal(str(qc_data.actual_fat_pct))
        if bom.target_fat_pct:
            tolerance = Decimal("0.5")
            qc.fat_pass = abs(qc.actual_fat_pct - bom.target_fat_pct) <= tolerance
    
    if qc_data.actual_fiber_pct is not None:
        qc.actual_fiber_pct = Decimal(str(qc_data.actual_fiber_pct))
        if bom.target_fiber_pct:
            tolerance = Decimal("0.5")
            qc.fiber_pass = abs(qc.actual_fiber_pct - bom.target_fiber_pct) <= tolerance
    
    if qc_data.actual_moisture_pct is not None:
        qc.actual_moisture_pct = Decimal(str(qc_data.actual_moisture_pct))
        if bom.target_moisture_pct:
            tolerance = Decimal("0.5")
            qc.moisture_pass = abs(qc.actual_moisture_pct - bom.target_moisture_pct) <= tolerance
    
    if qc_data.actual_ash_pct is not None:
        qc.actual_ash_pct = Decimal(str(qc_data.actual_ash_pct))
        if bom.target_ash_pct:
            tolerance = Decimal("0.5")
            qc.ash_pass = abs(qc.actual_ash_pct - bom.target_ash_pct) <= tolerance
    
    if qc_data.actual_energy_kcal is not None:
        qc.actual_energy_kcal = Decimal(str(qc_data.actual_energy_kcal))
    
    if qc_data.test_date:
        qc.test_date = datetime.fromisoformat(qc_data.test_date)
    else:
        qc.test_date = datetime.utcnow()
    
    qc.tested_by = qc_data.tested_by
    qc.notes = qc_data.notes
    
    # Determine overall pass
    passes = [
        qc.protein_pass, qc.fat_pass, qc.fiber_pass,
        qc.moisture_pass, qc.ash_pass
    ]
    # If any test was done and all are True, overall pass
    if any(p is not None for p in passes):
        qc.overall_pass = all(p for p in passes if p is not None)
    
    db.commit()
    db.refresh(qc)
    
    return {
        "id": qc.id,
        "order_id": qc.order_id,
        "overall_pass": qc.overall_pass,
        "protein_pass": qc.protein_pass,
        "fat_pass": qc.fat_pass,
        "fiber_pass": qc.fiber_pass,
        "moisture_pass": qc.moisture_pass,
        "ash_pass": qc.ash_pass
    }

@router.get("/production-orders/{order_id}/qc", response_model=Dict)
async def get_batch_qc(
    order_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get batch QC results"""
    tenant_id = get_tenant_id(request)
    
    order = db.query(ProductionOrder).filter(
        ProductionOrder.id == order_id,
        ProductionOrder.tenant_id == tenant_id
    ).first()
    if not order:
        raise HTTPException(status_code=404, detail="Production order not found")
    
    qc = db.query(BatchQC).filter(
        BatchQC.order_id == order_id,
        BatchQC.tenant_id == tenant_id
    ).first()
    
    if not qc:
        return {"message": "QC results not found"}
    
    bom = db.query(FeedBom).filter(FeedBom.id == order.bom_id).first()
    
    return {
        "id": qc.id,
        "order_id": qc.order_id,
        "actual_protein_pct": float(qc.actual_protein_pct) if qc.actual_protein_pct else None,
        "actual_fat_pct": float(qc.actual_fat_pct) if qc.actual_fat_pct else None,
        "actual_fiber_pct": float(qc.actual_fiber_pct) if qc.actual_fiber_pct else None,
        "actual_moisture_pct": float(qc.actual_moisture_pct) if qc.actual_moisture_pct else None,
        "actual_ash_pct": float(qc.actual_ash_pct) if qc.actual_ash_pct else None,
        "actual_energy_kcal": float(qc.actual_energy_kcal) if qc.actual_energy_kcal else None,
        "target_protein_pct": float(bom.target_protein_pct) if bom and bom.target_protein_pct else None,
        "target_fat_pct": float(bom.target_fat_pct) if bom and bom.target_fat_pct else None,
        "target_fiber_pct": float(bom.target_fiber_pct) if bom and bom.target_fiber_pct else None,
        "target_moisture_pct": float(bom.target_moisture_pct) if bom and bom.target_moisture_pct else None,
        "target_ash_pct": float(bom.target_ash_pct) if bom and bom.target_ash_pct else None,
        "protein_pass": qc.protein_pass,
        "fat_pass": qc.fat_pass,
        "fiber_pass": qc.fiber_pass,
        "moisture_pass": qc.moisture_pass,
        "ash_pass": qc.ash_pass,
        "overall_pass": qc.overall_pass,
        "test_date": qc.test_date.isoformat() if qc.test_date else None,
        "tested_by": qc.tested_by,
        "notes": qc.notes
    }

# ==================== Formulation Solver ====================

class FormulationSolveRequest(BaseModel):
    allowed_ingredient_ids: List[int]
    constraints: Dict[int, Dict] = {}  # {ingredient_id: {'min_pct': float, 'max_pct': float}}
    nutrition_targets: Dict = {}  # {'protein_min': float, 'fiber_max': float, etc.}
    price_overrides: Dict[int, float] = {}  # {ingredient_id: price_per_kg}
    group_constraints: List[Dict] = []  # [{'ingredient_ids': [1,2,3], 'max_total_pct': float}]

@router.post("/formulation/solve")
async def solve_formulation(
    solve_data: FormulationSolveRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Solve least-cost formulation"""
    from app.modules.feed_manufacturing.formulation_service import FormulationService
    
    tenant_id = get_tenant_id(request)
    
    # Convert price overrides to Decimal
    price_overrides = {
        k: Decimal(str(v)) for k, v in solve_data.price_overrides.items()
    }
    
    # Convert constraints to Decimal
    constraints = {}
    for ing_id, constr in solve_data.constraints.items():
        constraints[ing_id] = {
            'min_pct': Decimal(str(constr.get('min_pct', 0))),
            'max_pct': Decimal(str(constr.get('max_pct', 100)))
        }
    
    # Convert nutrition targets to Decimal
    nutrition_targets = {
        k: Decimal(str(v)) for k, v in solve_data.nutrition_targets.items()
    }
    
    result = FormulationService.solve_least_cost(
        db, tenant_id, solve_data.allowed_ingredient_ids,
        constraints, nutrition_targets, price_overrides, solve_data.group_constraints
    )
    
    return {
        'success': result['success'],
        'solution': {str(k): float(v) for k, v in result['solution'].items()},
        'cost_per_ton': float(result['cost_per_ton']),
        'nutrition': {k: float(v) for k, v in result['nutrition'].items()},
        'errors': result['errors'],
        'warnings': result['warnings']
    }

@router.post("/formulation/save-as-bom")
async def save_formulation_as_bom(
    bom_data: FeedBomCreate,
    solution: Dict[int, float],  # {ingredient_id: percent}
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Save formulation solution as draft BOM"""
    tenant_id = get_tenant_id(request)
    
    # Create BOM
    bom = FeedBom(
        tenant_id=tenant_id,
        bom_code=bom_data.bom_code,
        product_id=bom_data.product_id,
        version=bom_data.version,
        default_batch_size_kg=Decimal(str(bom_data.default_batch_size_ton)) * Decimal("1000"),
        route_type=bom_data.process_type,
        pellet_size_mm=Decimal(str(bom_data.pellet_size_mm)) if bom_data.pellet_size_mm else None,
        status=BOMStatus.DRAFT.value,
        notes=bom_data.notes,
        created_by=current_user.id
    )
    db.add(bom)
    db.flush()
    
    # Create lines from solution
    sequence = 0
    for ingredient_id, percent in solution.items():
        line = FeedBomLine(
            tenant_id=tenant_id,
            bom_id=bom.id,
            ingredient_id=ingredient_id,
            sequence=sequence,
            inclusion_basis=InclusionBasis.PERCENT,
            inclusion_value=Decimal(str(percent)),
            created_by=current_user.id
        )
        db.add(line)
        sequence += 1
    
    # Normalize and validate
    BomService.normalize_bom_lines(db, bom.id)
    
    db.commit()
    db.refresh(bom)
    return bom

# ==================== BOM Additional Endpoints ====================

@router.post("/feed-boms/{bom_id}/validate")
async def validate_bom(
    bom_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Validate BOM totals and constraints"""
    tenant_id = get_tenant_id(request)
    
    bom = get_bom_with_access_check(db, bom_id, tenant_id)
    
    result = BomService.validate_bom_totals(db, bom_id)
    nutrition = BomService.compute_nutrition(db, bom_id)
    
    return {
        'is_valid': result['is_valid'],
        'total_percent': float(result['total_percent']),
        'deviation': float(result['deviation']),
        'errors': result['errors'],
        'warnings': result['warnings'] + nutrition.get('warnings', []),
        'nutrition': {k: float(v) for k, v in nutrition.items() if k != 'warnings'}
    }

@router.post("/feed-boms/{bom_id}/archive")
async def archive_bom(
    bom_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Archive a BOM"""
    tenant_id = get_tenant_id(request)
    
    bom = get_bom_with_access_check(db, bom_id, tenant_id)
    
    bom.status = BOMStatus.ARCHIVED.value
    db.commit()
    return {"message": "BOM archived successfully"}

@router.get("/feed-boms/{bom_id}/nutrition")
async def get_bom_nutrition(
    bom_id: int,
    batch_size_kg: Optional[float] = None,
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get computed nutrition for BOM"""
    tenant_id = get_tenant_id(request)
    
    bom = get_bom_with_access_check(db, bom_id, tenant_id)
    
    batch_kg = Decimal(str(batch_size_kg)) if batch_size_kg else bom.default_batch_size_kg
    nutrition = BomService.compute_nutrition(db, bom_id, batch_kg)
    
    return {
        'nutrition': {k: float(v) for k, v in nutrition.items() if k != 'warnings'},
        'warnings': nutrition.get('warnings', [])
    }

@router.get("/feed-boms/{bom_id}/compute-for-batch")
async def compute_bom_for_batch(
    bom_id: int,
    batch_size_kg: float,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Compute BOM values for specific batch size"""
    tenant_id = get_tenant_id(request)
    
    bom = get_bom_with_access_check(db, bom_id, tenant_id)
    
    result = BomService.compute_for_batch_size(db, bom_id, Decimal(str(batch_size_kg)))
    return result

# ==================== Production Additional Endpoints ====================

class MaterialIssueRequest(BaseModel):
    material_issues: List[Dict]  # [{'order_line_id': int, 'consumed_qty_kg': float, 'lot_id': Optional[int]}]

@router.post("/production-orders/{order_id}/issue-materials")
async def issue_materials(
    order_id: int,
    issue_data: MaterialIssueRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Issue materials for production (factory-grade: uses stock_balances + legacy stock_ledger)."""
    tenant_id = get_tenant_id(request)
    order = db.query(ProductionOrder).filter(
        ProductionOrder.id == order_id,
        ProductionOrder.tenant_id == tenant_id
    ).first()
    if not order:
        raise HTTPException(status_code=404, detail="Production order not found")

    if order.status not in ["draft", "planned"]:
        raise HTTPException(status_code=400, detail=f"Cannot issue materials. Order status: {order.status}")
    
    errors: List[str] = []
    updated_lines: List[ProductionOrderLine] = []

    for issue in issue_data.material_issues:
        try:
            line_id = int(issue.get("order_line_id"))
            consumed_qty = Decimal(str(issue.get("consumed_qty_kg", 0)))
        except Exception:
            errors.append("Invalid issue payload entry")
            continue

        if consumed_qty <= 0:
            errors.append(f"Consumed qty must be > 0 (line {line_id})")
            continue

        line = db.query(ProductionOrderLine).filter(
            ProductionOrderLine.id == line_id,
            ProductionOrderLine.order_id == order_id,
            ProductionOrderLine.tenant_id == tenant_id
        ).first()
        if not line:
            errors.append(f"Order line {line_id} not found")
            continue

        # tolerance: 10% above required_with_loss
        if line.required_qty_with_loss_kg and consumed_qty > Decimal(str(line.required_qty_with_loss_kg)) * Decimal("1.1"):
            errors.append(f"Consumed qty too high for line {line_id}")
            continue

        ingredient = db.query(Ingredient).filter(Ingredient.id == line.ingredient_id, Ingredient.tenant_id == tenant_id).first()
        if not ingredient:
            errors.append(f"Ingredient not found for line {line_id}")
            continue

        item = db.query(Item).filter(Item.id == ingredient.item_id, Item.tenant_id == tenant_id).first()
        if not item:
            errors.append(f"Ingredient item not found for line {line_id}")
            continue

        # Ensure StockBalance exists (fallback seed from ledger + standard cost)
        balance = db.query(StockBalance).filter(
            StockBalance.tenant_id == tenant_id,
            StockBalance.item_id == item.id,
            StockBalance.warehouse_id == order.warehouse_id,
            StockBalance.lot_id == None
        ).first()
        if not balance:
            current = StockService.get_current_stock(db, tenant_id, item.id, order.warehouse_id)
            unit_cost = item.standard_cost or Decimal("0")
            balance = StockBalance(
                tenant_id=tenant_id,
                item_id=item.id,
                warehouse_id=order.warehouse_id,
                lot_id=None,
                qty_kg=current,
                unit_cost=Decimal(str(unit_cost or 0)),
                total_cost=Decimal(str(current)) * Decimal(str(unit_cost or 0)),
                last_txn_date=datetime.utcnow(),
                created_by=current_user.id
            )
            db.add(balance)
            db.flush()

        if Decimal(str(balance.qty_kg)) < consumed_qty:
            errors.append(f"Insufficient stock for {item.name}. Available: {balance.qty_kg}, required: {consumed_qty}")
            continue

        silo_id = issue.get("silo_id") or line.silo_id
        if silo_id:
            silo = db.query(Silo).filter(Silo.id == int(silo_id), Silo.tenant_id == tenant_id).first()
            if not silo:
                errors.append(f"Silo {silo_id} not found for line {line_id}")
                continue
            if silo.warehouse_id != order.warehouse_id:
                errors.append(f"Silo warehouse must match order warehouse (line {line_id})")
                continue
            if silo.item_id != item.id:
                errors.append(f"Silo material must match ingredient item for line {line_id}")
                continue
            prev_silo = Decimal(str(line.silo_consumed_kg or 0))
            delta = consumed_qty - prev_silo
            try:
                if delta > 0:
                    SiloService.consume(
                        db=db,
                        tenant_id=tenant_id,
                        silo_id=silo.id,
                        qty_kg=delta,
                        ref_type="production_issue",
                        ref_id=order.id,
                        notes=f"Issue for Production Order {order.order_number}",
                        user_id=current_user.id,
                    )
                elif delta < 0:
                    SiloService.fill(
                        db=db,
                        tenant_id=tenant_id,
                        silo_id=silo.id,
                        qty_kg=-delta,
                        ref_type="production_issue_adjust",
                        ref_id=order.id,
                        notes=f"Adjustment for Production Order {order.order_number}",
                        user_id=current_user.id,
                    )
            except ValueError as e:
                errors.append(str(e))
                continue

        unit_cost = Decimal(str(balance.unit_cost))
        line.consumed_qty_kg = consumed_qty
        line.unit_cost = unit_cost
        line.total_cost = (consumed_qty * unit_cost).quantize(Decimal("0.01"))
        if silo_id:
            line.silo_id = int(silo_id)
            line.silo_consumed_kg = consumed_qty
        updated_lines.append(line)

        # Write legacy stock ledger (issue)
        db.add(StockLedger(
            tenant_id=tenant_id,
            item_id=item.id,
            warehouse_id=order.warehouse_id,
            qty_in=Decimal("0"),
            qty_out=consumed_qty,
            unit_cost=unit_cost.quantize(Decimal("0.01")),
            ref_type="production_issue",
            ref_id=order.id,
            txn_date=datetime.utcnow(),
            batch_no=order.order_number,
            notes=f"Issue for Production Order {order.order_number}",
            created_by=current_user.id
        ))

        # Update balance
        balance.qty_kg = Decimal(str(balance.qty_kg)) - consumed_qty
        balance.total_cost = Decimal(str(balance.total_cost)) - (consumed_qty * unit_cost)
        balance.last_txn_date = datetime.utcnow()

    if errors:
        db.rollback()
        raise HTTPException(status_code=400, detail="; ".join(errors))

    # Update order status + costing
    order.status = "in_progress"
    if not order.start_date:
        order.start_date = datetime.utcnow()
    material_cost = sum((Decimal(str(l.total_cost or 0)) for l in updated_lines), Decimal("0"))
    order.material_cost = material_cost
    order.total_cost = material_cost + Decimal(str(order.overhead_cost or 0))
    if order.planned_output_kg and Decimal(str(order.planned_output_kg)) > 0:
        order.cost_per_kg = (Decimal(str(order.total_cost)) / Decimal(str(order.planned_output_kg))).quantize(Decimal("0.0001"))

    db.commit()
    return {"message": "Materials issued successfully", "lines": len(updated_lines)}

class CompleteProductionRequest(BaseModel):
    actual_output_kg: float
    finished_item_id: int
    lot_id: Optional[int] = None

@router.post("/production-orders/{order_id}/complete")
async def complete_production(
    order_id: int,
    complete_data: CompleteProductionRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Complete production batch (factory-grade)."""
    tenant_id = get_tenant_id(request)
    order = db.query(ProductionOrder).filter(
        ProductionOrder.id == order_id,
        ProductionOrder.tenant_id == tenant_id
    ).first()
    if not order:
        raise HTTPException(status_code=404, detail="Production order not found")

    if order.status != "in_progress":
        raise HTTPException(status_code=400, detail=f"Order must be in_progress. Current: {order.status}")

    actual_output = Decimal(str(complete_data.actual_output_kg))
    if actual_output <= 0:
        raise HTTPException(status_code=400, detail="Actual output must be > 0")

    # Resolve finished item from BOM->product->item
    bom = db.query(FeedBom).filter(FeedBom.id == order.bom_id, FeedBom.tenant_id == tenant_id).first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")
    product = db.query(FeedProduct).filter(FeedProduct.id == bom.product_id, FeedProduct.tenant_id == tenant_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Feed product not found")
    finished_item = db.query(Item).filter(Item.id == product.item_id, Item.tenant_id == tenant_id).first()
    if not finished_item:
        raise HTTPException(status_code=404, detail="Finished item not found")

    if complete_data.finished_item_id != finished_item.id:
        # Keep strict to avoid wrong postings
        raise HTTPException(status_code=400, detail="Finished item mismatch for this order/BOM")

    material_cost = Decimal(str(order.material_cost or 0))
    overhead = Decimal(str(order.overhead_cost or 0))
    total_cost = (material_cost + overhead).quantize(Decimal("0.01"))
    unit_cost = (total_cost / actual_output).quantize(Decimal("0.0001"))

    # Stock ledger receipt for finished goods (legacy)
    db.add(StockLedger(
        tenant_id=tenant_id,
        item_id=finished_item.id,
        warehouse_id=order.warehouse_id,
        qty_in=actual_output,
        qty_out=Decimal("0"),
        unit_cost=unit_cost.quantize(Decimal("0.01")),
        ref_type="production_output",
        ref_id=order.id,
        txn_date=datetime.utcnow(),
        batch_no=order.order_number,
        notes=f"Output for Production Order {order.order_number}",
        created_by=current_user.id
    ))

    # Update/create StockBalance
    balance = db.query(StockBalance).filter(
        StockBalance.tenant_id == tenant_id,
        StockBalance.item_id == finished_item.id,
        StockBalance.warehouse_id == order.warehouse_id,
        StockBalance.lot_id == None
    ).first()
    if balance:
        new_qty = Decimal(str(balance.qty_kg)) + actual_output
        new_total_cost = Decimal(str(balance.total_cost)) + total_cost
        balance.qty_kg = new_qty
        balance.total_cost = new_total_cost
        balance.unit_cost = (new_total_cost / new_qty).quantize(Decimal("0.0001")) if new_qty > 0 else Decimal("0")
        balance.last_txn_date = datetime.utcnow()
    else:
        balance = StockBalance(
            tenant_id=tenant_id,
            item_id=finished_item.id,
            warehouse_id=order.warehouse_id,
            lot_id=None,
            qty_kg=actual_output,
            unit_cost=unit_cost,
            total_cost=total_cost,
            last_txn_date=datetime.utcnow(),
            created_by=current_user.id
        )
        db.add(balance)

    # Update order
    order.actual_output_kg = actual_output
    if order.planned_output_kg and Decimal(str(order.planned_output_kg)) > 0:
        order.yield_pct = (actual_output / Decimal(str(order.planned_output_kg)) * Decimal("100")).quantize(Decimal("0.01"))
    order.total_cost = total_cost
    order.cost_per_kg = unit_cost
    order.end_date = datetime.utcnow()
    order.status = "completed"

    db.commit()
    return {"message": "Production completed successfully", "order_id": order_id}

class PackRequest(BaseModel):
    bag_item_id: int
    pack_size_kg: float
    bags_count: int

@router.post("/production-orders/{order_id}/pack")
async def pack_batch(
    order_id: int,
    pack_data: PackRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Pack finished feed into bags (factory-grade)."""
    tenant_id = get_tenant_id(request)
    order = db.query(ProductionOrder).filter(
        ProductionOrder.id == order_id,
        ProductionOrder.tenant_id == tenant_id
    ).first()
    if not order:
        raise HTTPException(status_code=404, detail="Production order not found")

    if order.status != "completed":
        raise HTTPException(status_code=400, detail="Order must be completed before packing")

    bag_item = db.query(Item).filter(Item.id == pack_data.bag_item_id, Item.tenant_id == tenant_id).first()
    if not bag_item:
        raise HTTPException(status_code=404, detail="Bag item not found")

    bags_count = int(pack_data.bags_count)
    if bags_count <= 0:
        raise HTTPException(status_code=400, detail="Bags count must be > 0")

    # Simple factory assumption: each bag consumes 0.05 kg packaging material
    bag_weight_kg = Decimal("0.05")
    bag_qty_kg = (bag_weight_kg * Decimal(str(bags_count))).quantize(Decimal("0.001"))

    balance = db.query(StockBalance).filter(
        StockBalance.tenant_id == tenant_id,
        StockBalance.item_id == bag_item.id,
        StockBalance.warehouse_id == order.warehouse_id,
        StockBalance.lot_id == None
    ).first()
    if not balance or Decimal(str(balance.qty_kg)) < bag_qty_kg:
        raise HTTPException(status_code=400, detail="Insufficient packaging material stock balance")

    unit_cost = Decimal(str(balance.unit_cost))
    bag_cost = (bag_qty_kg * unit_cost).quantize(Decimal("0.01"))

    # Ledger issue for packaging
    db.add(StockLedger(
        tenant_id=tenant_id,
        item_id=bag_item.id,
        warehouse_id=order.warehouse_id,
        qty_in=Decimal("0"),
        qty_out=bag_qty_kg,
        unit_cost=unit_cost.quantize(Decimal("0.01")),
        ref_type="packing_issue",
        ref_id=order.id,
        txn_date=datetime.utcnow(),
        batch_no=order.order_number,
        notes=f"Packing material issue for {order.order_number}",
        created_by=current_user.id
    ))

    balance.qty_kg = Decimal(str(balance.qty_kg)) - bag_qty_kg
    balance.total_cost = Decimal(str(balance.total_cost)) - bag_cost
    balance.last_txn_date = datetime.utcnow()

    # Add packaging cost into overhead_cost (since current schema has no packaging_cost column)
    order.overhead_cost = (Decimal(str(order.overhead_cost or 0)) + bag_cost).quantize(Decimal("0.01"))
    order.total_cost = (Decimal(str(order.material_cost or 0)) + Decimal(str(order.overhead_cost or 0))).quantize(Decimal("0.01"))
    if order.actual_output_kg and Decimal(str(order.actual_output_kg)) > 0:
        order.cost_per_kg = (Decimal(str(order.total_cost)) / Decimal(str(order.actual_output_kg))).quantize(Decimal("0.0001"))

    db.commit()
    return {"message": "Packing completed successfully"}


@router.post("/production-orders/{order_id}/unpost")
async def unpost_production_order(
    order_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Roll back issued/completed production: restore raw materials, remove finished goods
    from warehouse (when still on hand), reset order to draft.
    """
    tenant_id = get_tenant_id(request)
    try:
        order = rollback_production_order(db, tenant_id, order_id, current_user.id)
    except ProductionRollbackError as e:
        raise HTTPException(status_code=409, detail=e.detail)
    return {
        "message": "Production order rolled back to draft; stock movements reversed.",
        "order_id": order.id,
        "status": order.status,
    }


# ==================== Traceability ====================

@router.get("/traceability/finished/{batch_no}")
async def traceability_finished_batch(
    batch_no: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get traceability for finished batch - which raw material lots used"""
    tenant_id = get_tenant_id(request)
    
    order = db.query(ProductionOrder).filter(
        ProductionOrder.batch_no == batch_no,
        ProductionOrder.tenant_id == tenant_id
    ).first()
    if not order:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    # Get production order lines with lots
    lines = db.query(ProductionOrderLine).filter(
        ProductionOrderLine.order_id == order.id,
        ProductionOrderLine.tenant_id == tenant_id
    ).all()
    
    traceability = []
    for line in lines:
        if line.lot_id:
            lot = db.query(InventoryLot).filter(InventoryLot.id == line.lot_id).first()
            traceability.append({
                'ingredient_name': line.ingredient.item.name if line.ingredient.item else 'Unknown',
                'consumed_qty_kg': float(line.consumed_qty_kg),
                'lot_no': lot.lot_no if lot else None,
                'manufacture_date': lot.manufacture_date.isoformat() if lot and lot.manufacture_date else None,
                'expiry_date': lot.expiry_date.isoformat() if lot and lot.expiry_date else None
            })
    
    return {
        'batch_no': batch_no,
        'order_number': order.order_number,
        'finished_item': order.bom.product.item.name if order.bom and order.bom.product and order.bom.product.item else 'Unknown',
        'produced_qty_kg': float(order.actual_output_kg) if order.actual_output_kg else None,
        'raw_materials': traceability
    }

@router.get("/traceability/raw-lot/{lot_no}")
async def traceability_raw_lot(
    lot_no: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get traceability for raw material lot - which finished batches it went into"""
    tenant_id = get_tenant_id(request)
    
    lot = db.query(InventoryLot).filter(
        InventoryLot.lot_no == lot_no,
        InventoryLot.tenant_id == tenant_id
    ).first()
    if not lot:
        raise HTTPException(status_code=404, detail="Lot not found")
    
    # Find production order lines that used this lot
    lines = db.query(ProductionOrderLine).filter(
        ProductionOrderLine.lot_id == lot.id,
        ProductionOrderLine.tenant_id == tenant_id
    ).all()
    
    batches = []
    for line in lines:
        order = line.order
        batches.append({
            'batch_no': order.batch_no,
            'order_number': order.order_number,
            'consumed_qty_kg': float(line.consumed_qty_kg),
            'finished_item': order.bom.product.item.name if order.bom and order.bom.product and order.bom.product.item else 'Unknown',
            'production_date': order.end_date.isoformat() if order.end_date else None
        })
    
    return {
        'lot_no': lot_no,
        'item_name': lot.item.name if lot.item else 'Unknown',
        'current_qty_kg': float(lot.qty_kg),
        'finished_batches': batches
    }

# ==================== QC Targets ====================

class QCTargetCreate(BaseModel):
    product_id: Optional[int] = None
    bom_id: Optional[int] = None
    protein_min_pct: Optional[float] = None
    protein_max_pct: Optional[float] = None
    fat_min_pct: Optional[float] = None
    fat_max_pct: Optional[float] = None
    fiber_max_pct: Optional[float] = None
    moisture_max_pct: Optional[float] = None
    ash_max_pct: Optional[float] = None
    energy_min_kcal: Optional[float] = None

@router.post("/qc/targets")
async def create_qc_target(
    target_data: QCTargetCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create QC target"""
    from app.modules.feed_manufacturing.models import QCTarget
    
    tenant_id = get_tenant_id(request)
    
    target = QCTarget(
        tenant_id=tenant_id,
        product_id=target_data.product_id,
        bom_id=target_data.bom_id,
        protein_min_pct=Decimal(str(target_data.protein_min_pct)) if target_data.protein_min_pct else None,
        protein_max_pct=Decimal(str(target_data.protein_max_pct)) if target_data.protein_max_pct else None,
        fat_min_pct=Decimal(str(target_data.fat_min_pct)) if target_data.fat_min_pct else None,
        fat_max_pct=Decimal(str(target_data.fat_max_pct)) if target_data.fat_max_pct else None,
        fiber_max_pct=Decimal(str(target_data.fiber_max_pct)) if target_data.fiber_max_pct else None,
        moisture_max_pct=Decimal(str(target_data.moisture_max_pct)) if target_data.moisture_max_pct else None,
        ash_max_pct=Decimal(str(target_data.ash_max_pct)) if target_data.ash_max_pct else None,
        energy_min_kcal=Decimal(str(target_data.energy_min_kcal)) if target_data.energy_min_kcal else None
    )
    db.add(target)
    db.commit()
    db.refresh(target)
    return {"message": "QC target created successfully", "target_id": target.id}

@router.get("/qc/targets")
async def get_qc_targets(
    product_id: Optional[int] = None,
    bom_id: Optional[int] = None,
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get QC targets"""
    from app.modules.feed_manufacturing.models import QCTarget
    
    tenant_id = get_tenant_id(request)
    query = db.query(QCTarget).filter(QCTarget.tenant_id == tenant_id)
    
    if product_id:
        query = query.filter(QCTarget.product_id == product_id)
    if bom_id:
        query = query.filter(QCTarget.bom_id == bom_id)
    
    targets = query.all()
    return [{
        'id': t.id,
        'product_id': t.product_id,
        'bom_id': t.bom_id,
        'protein_min_pct': float(t.protein_min_pct) if t.protein_min_pct else None,
        'protein_max_pct': float(t.protein_max_pct) if t.protein_max_pct else None,
        'fiber_max_pct': float(t.fiber_max_pct) if t.fiber_max_pct else None,
        'moisture_max_pct': float(t.moisture_max_pct) if t.moisture_max_pct else None,
    } for t in targets]


# ==================== Silos (bulk storage / PLC–sensor integration) ====================


class SiloCreate(BaseModel):
    warehouse_id: int
    item_id: int
    name: str
    code: Optional[str] = None
    capacity_kg: Optional[float] = None
    current_qty_kg: float = 0
    reorder_min_kg: Optional[float] = None
    integration_source: str = "manual"
    external_device_id: Optional[str] = None
    notes: Optional[str] = None


class SiloUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    capacity_kg: Optional[float] = None
    reorder_min_kg: Optional[float] = None
    integration_source: Optional[str] = None
    external_device_id: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class SiloResponse(BaseModel):
    id: int
    warehouse_id: int
    item_id: int
    name: str
    code: Optional[str]
    capacity_kg: Optional[float]
    current_qty_kg: float
    reorder_min_kg: Optional[float]
    integration_source: str
    external_device_id: Optional[str]
    is_active: bool

    class Config:
        from_attributes = True


class SiloFillRequest(BaseModel):
    qty_kg: float
    notes: Optional[str] = None


class SiloAdjustRequest(BaseModel):
    new_level_kg: float
    notes: Optional[str] = None


class SiloSensorRequest(BaseModel):
    level_kg: float
    notes: Optional[str] = None


@router.get("/silos", response_model=List[SiloResponse])
async def list_silos(
    request: Request,
    warehouse_id: Optional[int] = None,
    item_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    q = db.query(Silo).filter(Silo.tenant_id == tenant_id)
    if warehouse_id is not None:
        q = q.filter(Silo.warehouse_id == warehouse_id)
    if item_id is not None:
        q = q.filter(Silo.item_id == item_id)
    return q.order_by(Silo.name).all()


@router.post("/silos", response_model=SiloResponse)
async def create_silo(
    data: SiloCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    wh = db.query(Warehouse).filter(Warehouse.id == data.warehouse_id, Warehouse.tenant_id == tenant_id).first()
    if not wh:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    item = db.query(Item).filter(Item.id == data.item_id, Item.tenant_id == tenant_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    silo = Silo(
        tenant_id=tenant_id,
        warehouse_id=data.warehouse_id,
        item_id=data.item_id,
        name=data.name,
        code=data.code,
        capacity_kg=Decimal(str(data.capacity_kg)) if data.capacity_kg is not None else None,
        current_qty_kg=Decimal(str(data.current_qty_kg)),
        reorder_min_kg=Decimal(str(data.reorder_min_kg)) if data.reorder_min_kg is not None else None,
        integration_source=data.integration_source or "manual",
        external_device_id=data.external_device_id,
        notes=data.notes,
        is_active=True,
        created_by=current_user.id,
    )
    db.add(silo)
    db.commit()
    db.refresh(silo)
    return silo


@router.get("/silos/reorder-alerts")
async def silo_reorder_alerts(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    rows = (
        db.query(Silo)
        .filter(
            Silo.tenant_id == tenant_id,
            Silo.is_active == True,
            Silo.reorder_min_kg != None,
        )
        .all()
    )
    alerts = []
    for s in rows:
        cur = Decimal(str(s.current_qty_kg or 0))
        mn = Decimal(str(s.reorder_min_kg))
        if cur <= mn:
            alerts.append(
                {
                    "id": s.id,
                    "name": s.name,
                    "code": s.code,
                    "warehouse_id": s.warehouse_id,
                    "item_id": s.item_id,
                    "current_qty_kg": float(cur),
                    "reorder_min_kg": float(mn),
                }
            )
    return {"count": len(alerts), "silos": alerts}


@router.get("/silos/{silo_id}", response_model=SiloResponse)
async def get_silo(
    silo_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    silo = db.query(Silo).filter(Silo.id == silo_id, Silo.tenant_id == tenant_id).first()
    if not silo:
        raise HTTPException(status_code=404, detail="Silo not found")
    return silo


@router.put("/silos/{silo_id}", response_model=SiloResponse)
async def update_silo(
    silo_id: int,
    data: SiloUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    silo = db.query(Silo).filter(Silo.id == silo_id, Silo.tenant_id == tenant_id).first()
    if not silo:
        raise HTTPException(status_code=404, detail="Silo not found")
    if data.name is not None:
        silo.name = data.name
    if data.code is not None:
        silo.code = data.code
    if data.capacity_kg is not None:
        silo.capacity_kg = Decimal(str(data.capacity_kg))
    if data.reorder_min_kg is not None:
        silo.reorder_min_kg = Decimal(str(data.reorder_min_kg))
    if data.integration_source is not None:
        silo.integration_source = data.integration_source
    if data.external_device_id is not None:
        silo.external_device_id = data.external_device_id
    if data.notes is not None:
        silo.notes = data.notes
    if data.is_active is not None:
        silo.is_active = data.is_active
    db.commit()
    db.refresh(silo)
    return silo


@router.delete("/silos/{silo_id}")
async def deactivate_silo(
    silo_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    silo = db.query(Silo).filter(Silo.id == silo_id, Silo.tenant_id == tenant_id).first()
    if not silo:
        raise HTTPException(status_code=404, detail="Silo not found")
    silo.is_active = False
    db.commit()
    return {"message": "Silo deactivated"}


@router.post("/silos/{silo_id}/fill")
async def fill_silo(
    silo_id: int,
    body: SiloFillRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    try:
        SiloService.fill(
            db=db,
            tenant_id=tenant_id,
            silo_id=silo_id,
            qty_kg=Decimal(str(body.qty_kg)),
            ref_type="fill",
            ref_id=None,
            notes=body.notes,
            user_id=current_user.id,
        )
        db.commit()
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    silo = db.query(Silo).filter(Silo.id == silo_id).first()
    return {"message": "Fill recorded", "current_qty_kg": float(silo.current_qty_kg) if silo else None}


@router.post("/silos/{silo_id}/adjust")
async def adjust_silo(
    silo_id: int,
    body: SiloAdjustRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    try:
        SiloService.adjust_level(
            db=db,
            tenant_id=tenant_id,
            silo_id=silo_id,
            new_level_kg=Decimal(str(body.new_level_kg)),
            notes=body.notes,
            user_id=current_user.id,
        )
        db.commit()
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    silo = db.query(Silo).filter(Silo.id == silo_id).first()
    return {"message": "Level adjusted", "current_qty_kg": float(silo.current_qty_kg) if silo else None}


@router.post("/silos/{silo_id}/sensor-read")
async def silo_sensor_read(
    silo_id: int,
    body: SiloSensorRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ingest absolute kg from load cell / PLC (REST hook for automation)."""
    tenant_id = get_tenant_id(request)
    try:
        SiloService.set_level_from_sensor(
            db=db,
            tenant_id=tenant_id,
            silo_id=silo_id,
            reported_level_kg=Decimal(str(body.level_kg)),
            notes=body.notes,
            user_id=current_user.id,
        )
        db.commit()
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    silo = db.query(Silo).filter(Silo.id == silo_id).first()
    return {"message": "Sensor level applied", "current_qty_kg": float(silo.current_qty_kg) if silo else None}


@router.get("/silos/{silo_id}/transactions")
async def list_silo_transactions(
    silo_id: int,
    request: Request,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    silo = db.query(Silo).filter(Silo.id == silo_id, Silo.tenant_id == tenant_id).first()
    if not silo:
        raise HTTPException(status_code=404, detail="Silo not found")
    q = (
        db.query(SiloTransaction)
        .filter(SiloTransaction.silo_id == silo_id, SiloTransaction.tenant_id == tenant_id)
        .order_by(SiloTransaction.id.desc())
        .limit(min(limit, 200))
    )
    txns = q.all()
    return [
        {
            "id": t.id,
            "qty_delta": float(t.qty_delta),
            "ref_type": t.ref_type,
            "ref_id": t.ref_id,
            "notes": t.notes,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in txns
    ]

