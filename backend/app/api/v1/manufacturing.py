from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from decimal import Decimal
from app.core.dependencies import get_db, get_current_user, get_tenant_id
from app.modules.manufacturing.models import (
    Bom,
    BomLine,
    ProductionBatch,
    ProductionConsumption,
    ManufacturingProductionOutput,
    Scrap,
)
from app.modules.tenancy.models import User
from app.modules.inventory.stock_service import StockService
from app.modules.accounting.posting_service import PostingService
from app.shared.enums import DocumentStatus, BatchStatus
from pydantic import BaseModel
from fastapi import Request

router = APIRouter()

# BOM Models
class BomLineCreate(BaseModel):
    input_item_id: int
    qty: float
    uom_id: int
    waste_percent: float = 0.0

class BomCreate(BaseModel):
    name: str
    output_item_id: int
    output_qty: float
    version: str | None = None
    effective_from: str | None = None
    lines: List[BomLineCreate]

class BomResponse(BaseModel):
    id: int
    name: str
    output_item_id: int
    output_qty: float
    is_active: bool
    
    class Config:
        from_attributes = True

# Production Batch Models
class BatchCreate(BaseModel):
    bom_id: int
    planned_qty: float
    start_date: str | None = None

class BatchStartRequest(BaseModel):
    consumptions: List[dict]  # [{"item_id": 1, "qty": 100, "warehouse_id": 1}]

class BatchCompleteRequest(BaseModel):
    outputs: List[dict]  # [{"item_id": 1, "qty": 90, "warehouse_id": 1}]
    scraps: List[dict] | None = None  # [{"item_id": 1, "qty": 5, "reason": "..."}]
    end_date: str | None = None

class BatchResponse(BaseModel):
    id: int
    batch_number: str
    bom_id: int
    status: str
    planned_qty: float
    actual_qty: float | None
    
    class Config:
        from_attributes = True

# BOM Endpoints
@router.get("/boms", response_model=List[BomResponse])
async def list_boms(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all BOMs"""
    tenant_id = get_tenant_id(request)
    boms = db.query(Bom).filter(
        Bom.tenant_id == tenant_id,
        Bom.is_active == True
    ).all()
    return boms

@router.post("/boms", response_model=BomResponse)
async def create_bom(
    bom_data: BomCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new BOM"""
    tenant_id = get_tenant_id(request)
    
    effective_from = None
    if bom_data.effective_from:
        effective_from = datetime.fromisoformat(bom_data.effective_from)
    
    bom = Bom(
        tenant_id=tenant_id,
        name=bom_data.name,
        output_item_id=bom_data.output_item_id,
        output_qty=Decimal(str(bom_data.output_qty)),
        version=bom_data.version,
        effective_from=effective_from,
        is_active=True,
        created_by=current_user.id
    )
    db.add(bom)
    db.flush()
    
    # Create BOM lines
    for line_data in bom_data.lines:
        line = BomLine(
            tenant_id=tenant_id,
            bom_id=bom.id,
            input_item_id=line_data.input_item_id,
            qty=Decimal(str(line_data.qty)),
            uom_id=line_data.uom_id,
            waste_percent=Decimal(str(line_data.waste_percent)),
            created_by=current_user.id
        )
        db.add(line)
    
    db.commit()
    db.refresh(bom)
    return bom

@router.get("/boms/{bom_id}", response_model=BomResponse)
async def get_bom(
    bom_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get BOM by ID"""
    tenant_id = get_tenant_id(request)
    bom = db.query(Bom).filter(
        Bom.id == bom_id,
        Bom.tenant_id == tenant_id
    ).first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")
    return bom

# Production Batch Endpoints
@router.post("/batches", response_model=BatchResponse)
async def create_batch(
    batch_data: BatchCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a production batch"""
    tenant_id = get_tenant_id(request)
    
    # Verify BOM exists
    bom = db.query(Bom).filter(
        Bom.id == batch_data.bom_id,
        Bom.tenant_id == tenant_id,
        Bom.is_active == True
    ).first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found or inactive")
    
    # Generate batch number
    batch_number = f"BATCH-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    
    start_date = None
    if batch_data.start_date:
        start_date = datetime.fromisoformat(batch_data.start_date)
    
    batch = ProductionBatch(
        tenant_id=tenant_id,
        batch_number=batch_number,
        bom_id=batch_data.bom_id,
        status=BatchStatus.DRAFT,
        planned_qty=Decimal(str(batch_data.planned_qty)),
        start_date=start_date,
        created_by=current_user.id
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)
    return batch

@router.post("/batches/{batch_id}/start", response_model=BatchResponse)
async def start_batch(
    batch_id: int,
    start_data: BatchStartRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Start production batch - consume materials"""
    tenant_id = get_tenant_id(request)
    
    batch = db.query(ProductionBatch).filter(
        ProductionBatch.id == batch_id,
        ProductionBatch.tenant_id == tenant_id
    ).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    if batch.status != BatchStatus.DRAFT:
        raise HTTPException(status_code=400, detail="Batch can only be started from draft status")
    
    total_cost = Decimal("0")
    txn_date = datetime.utcnow()
    
    # Process consumptions
    for cons_data in start_data.consumptions:
        item_id = cons_data["item_id"]
        qty = Decimal(str(cons_data["qty"]))
        warehouse_id = cons_data["warehouse_id"]
        
        # Get FIFO cost
        unit_cost = StockService.get_fifo_cost(
            db=db,
            tenant_id=tenant_id,
            item_id=item_id,
            warehouse_id=warehouse_id,
            qty=qty
        )
        
        if unit_cost == 0:
            from app.modules.catalog.models import Item
            item = db.query(Item).filter(Item.id == item_id, Item.tenant_id == tenant_id).first()
            unit_cost = item.standard_cost or Decimal("0")
        
        cost = qty * unit_cost
        total_cost += cost
        
        # Create consumption record
        consumption = ProductionConsumption(
            tenant_id=tenant_id,
            batch_id=batch.id,
            item_id=item_id,
            qty=qty,
            warehouse_id=warehouse_id,
            unit_cost=unit_cost,
            created_by=current_user.id
        )
        db.add(consumption)
        
        # Post stock out
        StockService.create_stock_move(
            db=db,
            tenant_id=tenant_id,
            item_id=item_id,
            warehouse_id=warehouse_id,
            qty_in=Decimal("0"),
            qty_out=qty,
            unit_cost=unit_cost,
            txn_type="issue",
            ref_type="production_consumption",
            ref_id=batch.id,
            txn_date=txn_date,
            notes=f"Production Batch {batch.batch_number}",
            created_by=current_user.id
        )
    
    # Update batch status
    batch.status = BatchStatus.IN_PROGRESS
    if not batch.start_date:
        batch.start_date = txn_date
    
    db.commit()
    db.refresh(batch)
    return batch

@router.post("/batches/{batch_id}/complete", response_model=BatchResponse)
async def complete_batch(
    batch_id: int,
    complete_data: BatchCompleteRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Complete production batch - produce outputs and post to accounting"""
    tenant_id = get_tenant_id(request)
    
    batch = db.query(ProductionBatch).filter(
        ProductionBatch.id == batch_id,
        ProductionBatch.tenant_id == tenant_id
    ).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    if batch.status != BatchStatus.IN_PROGRESS:
        raise HTTPException(status_code=400, detail="Batch must be in progress to complete")
    
    # Calculate total consumption cost
    total_consumption_cost = Decimal("0")
    consumptions = db.query(ProductionConsumption).filter(
        ProductionConsumption.batch_id == batch_id,
        ProductionConsumption.tenant_id == tenant_id
    ).all()
    
    for cons in consumptions:
        total_consumption_cost += cons.qty * cons.unit_cost
    
    # Process outputs
    total_output_qty = Decimal("0")
    total_output_cost = Decimal("0")
    txn_date = datetime.utcnow()
    
    for output_data in complete_data.outputs:
        item_id = output_data["item_id"]
        qty = Decimal(str(output_data["qty"]))
        warehouse_id = output_data["warehouse_id"]
        
        # Calculate cost per unit (distribute consumption cost across outputs)
        # For now, use weighted distribution based on planned output qty
        if batch.planned_qty > 0:
            cost_per_unit = total_consumption_cost / batch.planned_qty
        else:
            cost_per_unit = Decimal("0")
        
        unit_cost = cost_per_unit
        total_cost = qty * unit_cost
        total_output_cost += total_cost
        total_output_qty += qty
        
        # Create output record
        output = ManufacturingProductionOutput(
            tenant_id=tenant_id,
            batch_id=batch.id,
            item_id=item_id,
            qty=qty,
            warehouse_id=warehouse_id,
            unit_cost=unit_cost,
            created_by=current_user.id
        )
        db.add(output)
        
        # Post stock in
        StockService.create_stock_move(
            db=db,
            tenant_id=tenant_id,
            item_id=item_id,
            warehouse_id=warehouse_id,
            qty_in=qty,
            qty_out=Decimal("0"),
            unit_cost=unit_cost,
            txn_type="produce",
            ref_type="production_output",
            ref_id=batch.id,
            txn_date=txn_date,
            notes=f"Production Batch {batch.batch_number}",
            created_by=current_user.id
        )
    
    # Process scraps if any
    if complete_data.scraps:
        for scrap_data in complete_data.scraps:
            scrap = Scrap(
                tenant_id=tenant_id,
                batch_id=batch.id,
                item_id=scrap_data["item_id"],
                qty=Decimal(str(scrap_data["qty"])),
                reason=scrap_data.get("reason"),
                created_by=current_user.id
            )
            db.add(scrap)
    
    # Post to accounting: WIP (Dr) → Finished Goods Inventory (Cr)
    # Or direct: Inventory (Dr) → Inventory (Cr) with different accounts
    inventory_account = PostingService.get_account_by_name(db, tenant_id, "Inventory")
    cogs_account = PostingService.get_account_by_name(db, tenant_id, "Cost of Goods Sold")
    
    # For manufacturing, we'll post: Inventory (finished goods) Dr, Inventory (raw materials) Cr
    # This represents the transfer from raw materials to finished goods
    if inventory_account and total_output_cost > 0:
        journal_lines = [
            {
                "account_id": inventory_account.id,
                "debit": float(total_output_cost),
                "credit": 0,
                "memo": f"Finished goods from Batch {batch.batch_number}"
            },
            {
                "account_id": inventory_account.id,
                "debit": 0,
                "credit": float(total_consumption_cost),
                "memo": f"Raw materials consumed in Batch {batch.batch_number}"
            }
        ]
        
        # If there's a difference (scrap/waste), post to expense
        if total_consumption_cost > total_output_cost:
            difference = total_consumption_cost - total_output_cost
            if cogs_account:
                journal_lines.append({
                    "account_id": cogs_account.id,
                    "debit": float(difference),
                    "credit": 0,
                    "memo": f"Waste/Scrap from Batch {batch.batch_number}"
                })
                journal_lines.append({
                    "account_id": inventory_account.id,
                    "debit": 0,
                    "credit": float(difference),
                    "memo": f"Waste/Scrap adjustment"
                })
        
        PostingService.create_journal_entry(
            db=db,
            tenant_id=tenant_id,
            date=txn_date,
            memo=f"Production Batch {batch.batch_number}",
            lines=journal_lines,
            ref_type="production_batch",
            ref_id=batch.id,
            posted_by=current_user.id
        )
    
    # Update batch
    batch.status = BatchStatus.COMPLETED
    batch.actual_qty = total_output_qty
    batch.end_date = datetime.fromisoformat(complete_data.end_date) if complete_data.end_date else txn_date
    
    db.commit()
    db.refresh(batch)
    return batch

@router.get("/batches", response_model=List[BatchResponse])
async def list_batches(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all production batches"""
    tenant_id = get_tenant_id(request)
    batches = db.query(ProductionBatch).filter(
        ProductionBatch.tenant_id == tenant_id
    ).all()
    return batches

@router.get("/batches/{batch_id}", response_model=BatchResponse)
async def get_batch(
    batch_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get production batch by ID"""
    tenant_id = get_tenant_id(request)
    batch = db.query(ProductionBatch).filter(
        ProductionBatch.id == batch_id,
        ProductionBatch.tenant_id == tenant_id
    ).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    return batch

