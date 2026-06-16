"""
Fuel station: tanks (diesel / octane), bulk receipts, and internal fleet refueling only.

Tank liters + weighted-average unit cost are the source of truth for fuel inventory.
GL: receipts Dr Inventory / Cr GRNI; vehicle issues Dr fleet expense / Cr Inventory.
Fuel grade is on the tank; Item (catalog) holds SKU (e.g. FS-FUEL-DIESEL). Retail / external
sales are not handled here — use the general sales path if added later, not duplicate tank flows.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from app.core.dependencies import get_db, get_current_user, require_tenant_id
from app.modules.accounting.models import CostCenter
from app.modules.catalog.models import Item
from app.modules.inventory.models import Warehouse
from app.modules.inventory.stock_service import StockService
from app.modules.fuel_station.fuel_gl_service import post_fuel_internal_issue, post_fuel_receipt_accrual
from app.modules.fuel_station.models import FuelTank, FuelTxn, VehicleFuelIssue
from app.modules.procurement.models import PurchaseOrder, PurchaseOrderLine
from app.modules.transport.models import Vehicle
from app.modules.tenancy.models import User

router = APIRouter()

FuelGrade = Literal["diesel", "octane", "other"]

FUEL_LEDGER_WAREHOUSE_NAME = "Fuel station — stock ledger"


def _fuel_ledger_warehouse_id(db: Session, tenant_id: int) -> int:
    """Dedicated warehouse row so fuel liters mirror into stock_ledger without mixing tank and bin UX."""
    w = (
        db.query(Warehouse)
        .filter(Warehouse.tenant_id == tenant_id, Warehouse.name == FUEL_LEDGER_WAREHOUSE_NAME)
        .first()
    )
    if w:
        return w.id
    w = Warehouse(tenant_id=tenant_id, name=FUEL_LEDGER_WAREHOUSE_NAME, is_active=True)
    db.add(w)
    db.flush()
    return w.id


def _mirror_fuel_to_stock_ledger(
    db: Session,
    tenant_id: int,
    fuel_item_id: int,
    warehouse_id: int,
    *,
    qty_in: Decimal = Decimal("0"),
    qty_out: Decimal = Decimal("0"),
    unit_cost: Decimal,
    fuel_txn_id: int,
    txn_date: datetime,
    tank_name: str,
    created_by: int,
) -> None:
    StockService.append_ledger_line(
        db,
        tenant_id,
        fuel_item_id,
        warehouse_id,
        qty_in=qty_in,
        qty_out=qty_out,
        unit_cost=unit_cost,
        ref_type="fuel_txn",
        ref_id=fuel_txn_id,
        txn_date=txn_date,
        notes=f"Fuel tank · {tank_name}",
        created_by=created_by,
    )


def _apply_fuel_receipt_to_tank(tank: FuelTank, qty_liters: Decimal, unit_cost: Decimal) -> None:
    """Increase tank stock and update moving average cost (WAC per liter) so issues and GL stay aligned."""
    qty_liters = Decimal(str(qty_liters))
    unit_cost = Decimal(str(unit_cost))
    prev_s = tank.current_stock_liters or Decimal("0")
    prev_avg = tank.moving_avg_unit_cost
    new_s = prev_s + qty_liters
    if new_s <= 0:
        return
    if prev_s <= 0:
        new_avg = unit_cost
    else:
        pa = Decimal(str(prev_avg)) if prev_avg is not None else Decimal("0")
        new_avg = (prev_s * pa + qty_liters * unit_cost) / new_s
    tank.current_stock_liters = new_s
    tank.moving_avg_unit_cost = new_avg


class TankCreate(BaseModel):
    name: str = Field(..., min_length=1)
    fuel_item_id: int = Field(..., ge=1)
    capacity_liters: float = Field(..., gt=0)
    fuel_grade: FuelGrade = "diesel"


class TankUpdate(BaseModel):
    name: Optional[str] = None
    capacity_liters: Optional[float] = Field(None, gt=0)
    fuel_grade: Optional[FuelGrade] = None


class TankResponse(BaseModel):
    id: int
    name: str
    fuel_grade: str
    fuel_item_id: int
    fuel_item_name: Optional[str] = None
    capacity_liters: float
    current_stock_liters: float
    moving_avg_unit_cost: Optional[float] = None

    class Config:
        from_attributes = True


class FuelTxnResponse(BaseModel):
    id: int
    txn_type: str
    fuel_item_id: int
    qty_liters: float
    unit_cost: float
    date: datetime
    tank_id: Optional[int]
    po_line_id: Optional[int] = None
    journal_entry_id: Optional[int] = None

    class Config:
        from_attributes = True


class PurchaseIn(BaseModel):
    tank_id: int
    qty_liters: float = Field(..., gt=0)
    unit_cost: float = Field(..., ge=0)
    date: Optional[datetime] = None
    post_to_gl: bool = True


class VehicleIssueIn(BaseModel):
    vehicle_id: int
    tank_id: int
    qty_liters: float = Field(..., gt=0)
    unit_cost: Optional[float] = Field(
        None, ge=0, description="Defaults to last unit cost from tank stock valuation (moving average)"
    )
    odometer: Optional[float] = None
    date: Optional[datetime] = None
    notes: Optional[str] = None
    cost_center_id: Optional[int] = None
    post_to_gl: bool = True


class ReceiveFuelFromPOIn(BaseModel):
    """Receive liters into a tank from an outstanding PO line (fuel item), update qty_received, accrue GRNI."""

    tank_id: int
    po_line_id: int
    qty_liters: float = Field(..., gt=0)
    receipt_date: Optional[datetime] = None
    post_to_gl: bool = True


class FuelPOLineOutstanding(BaseModel):
    po_line_id: int
    po_id: int
    po_number: str
    supplier_id: int
    item_id: int
    outstanding_liters: float
    unit_price: float


@router.get("/tanks", response_model=List[TankResponse])
async def list_tanks(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    fuel_grade: Optional[str] = None,
):
    q = db.query(FuelTank).filter(FuelTank.tenant_id == tenant_id).options(joinedload(FuelTank.fuel_item))
    if fuel_grade:
        q = q.filter(FuelTank.fuel_grade == fuel_grade)
    rows = q.order_by(FuelTank.name).all()
    out = []
    for t in rows:
        nm = t.fuel_item.name if t.fuel_item else None
        out.append(
            TankResponse(
                id=t.id,
                name=t.name,
                fuel_grade=t.fuel_grade,
                fuel_item_id=t.fuel_item_id,
                fuel_item_name=nm,
                capacity_liters=float(t.capacity_liters),
                current_stock_liters=float(t.current_stock_liters or 0),
                moving_avg_unit_cost=float(t.moving_avg_unit_cost)
                if t.moving_avg_unit_cost is not None
                else None,
            )
        )
    return out


@router.post("/tanks", response_model=TankResponse)
async def create_tank(
    body: TankCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    it = (
        db.query(Item)
        .filter(Item.id == body.fuel_item_id, Item.tenant_id == tenant_id, Item.type == "fuel")
        .first()
    )
    if not it:
        raise HTTPException(status_code=400, detail="fuel_item_id must be a fuel-type item for this tenant")

    t = FuelTank(
        tenant_id=tenant_id,
        name=body.name.strip(),
        fuel_item_id=body.fuel_item_id,
        capacity_liters=Decimal(str(body.capacity_liters)),
        current_stock_liters=Decimal("0"),
        fuel_grade=body.fuel_grade,
        created_by=current_user.id,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    t = db.query(FuelTank).options(joinedload(FuelTank.fuel_item)).filter(FuelTank.id == t.id).first()
    return TankResponse(
        id=t.id,
        name=t.name,
        fuel_grade=t.fuel_grade,
        fuel_item_id=t.fuel_item_id,
        fuel_item_name=t.fuel_item.name if t.fuel_item else None,
        capacity_liters=float(t.capacity_liters),
        current_stock_liters=float(t.current_stock_liters or 0),
        moving_avg_unit_cost=float(t.moving_avg_unit_cost) if t.moving_avg_unit_cost is not None else None,
    )


@router.patch("/tanks/{tank_id}", response_model=TankResponse)
async def update_tank(
    tank_id: int,
    body: TankUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    t = db.query(FuelTank).filter(FuelTank.id == tank_id, FuelTank.tenant_id == tenant_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tank not found")
    if body.name is not None:
        t.name = body.name.strip()
    if body.capacity_liters is not None:
        t.capacity_liters = Decimal(str(body.capacity_liters))
    if body.fuel_grade is not None:
        t.fuel_grade = body.fuel_grade
    t.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(t)
    t = db.query(FuelTank).options(joinedload(FuelTank.fuel_item)).filter(FuelTank.id == t.id).first()
    return TankResponse(
        id=t.id,
        name=t.name,
        fuel_grade=t.fuel_grade,
        fuel_item_id=t.fuel_item_id,
        fuel_item_name=t.fuel_item.name if t.fuel_item else None,
        capacity_liters=float(t.capacity_liters),
        current_stock_liters=float(t.current_stock_liters or 0),
        moving_avg_unit_cost=float(t.moving_avg_unit_cost) if t.moving_avg_unit_cost is not None else None,
    )


@router.get("/transactions", response_model=List[FuelTxnResponse])
async def list_fuel_transactions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    limit: int = 100,
):
    rows = (
        db.query(FuelTxn)
        .filter(FuelTxn.tenant_id == tenant_id)
        .order_by(FuelTxn.date.desc(), FuelTxn.id.desc())
        .limit(min(limit, 500))
        .all()
    )
    return rows


@router.post("/purchases", response_model=FuelTxnResponse)
async def record_purchase(
    body: PurchaseIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    """Bulk receipt into a tank (increases tank stock)."""
    tank = (
        db.query(FuelTank).filter(FuelTank.id == body.tank_id, FuelTank.tenant_id == tenant_id).first()
    )
    if not tank:
        raise HTTPException(status_code=404, detail="Tank not found")

    qty = Decimal(str(body.qty_liters))
    unit_cost = Decimal(str(body.unit_cost))
    new_stock = (tank.current_stock_liters or Decimal("0")) + qty
    if new_stock > tank.capacity_liters:
        raise HTTPException(status_code=400, detail="Receipt would exceed tank capacity")
    _apply_fuel_receipt_to_tank(tank, qty, unit_cost)
    txn_date = body.date or datetime.utcnow()
    txn = FuelTxn(
        tenant_id=tenant_id,
        txn_type="purchase",
        fuel_item_id=tank.fuel_item_id,
        qty_liters=qty,
        unit_cost=unit_cost,
        ref_type=None,
        ref_id=None,
        date=txn_date,
        tank_id=tank.id,
        po_line_id=None,
        created_by=current_user.id,
    )
    db.add(txn)
    db.flush()

    wh_id = _fuel_ledger_warehouse_id(db, tenant_id)
    _mirror_fuel_to_stock_ledger(
        db,
        tenant_id,
        tank.fuel_item_id,
        wh_id,
        qty_in=qty,
        qty_out=Decimal("0"),
        unit_cost=unit_cost,
        fuel_txn_id=txn.id,
        txn_date=txn_date,
        tank_name=tank.name,
        created_by=current_user.id,
    )

    line_total = qty * unit_cost
    if body.post_to_gl and line_total > 0:
        je = post_fuel_receipt_accrual(
            db,
            tenant_id,
            line_total,
            memo=f"Fuel tank receipt · {tank.name}",
            ref_type="fuel_txn",
            ref_id=txn.id,
            posted_at=txn_date,
            posted_by=current_user.id,
        )
        if je:
            txn.journal_entry_id = je.id
    db.commit()
    db.refresh(txn)
    return txn


@router.get("/open-po-lines", response_model=List[FuelPOLineOutstanding])
async def list_open_po_lines_for_fuel(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    """Outstanding quantities on PO lines for a fuel catalog item (direct-to-tank procurement)."""
    it = db.query(Item).filter(Item.id == item_id, Item.tenant_id == tenant_id, Item.type == "fuel").first()
    if not it:
        raise HTTPException(status_code=400, detail="item_id must be a fuel item for this tenant")

    lines = (
        db.query(PurchaseOrderLine, PurchaseOrder)
        .join(PurchaseOrder, PurchaseOrderLine.po_id == PurchaseOrder.id)
        .filter(
            PurchaseOrderLine.tenant_id == tenant_id,
            PurchaseOrderLine.item_id == item_id,
        )
        .order_by(PurchaseOrder.id.desc())
        .all()
    )
    out: List[FuelPOLineOutstanding] = []
    for pl, po in lines:
        ordered = Decimal(str(pl.qty))
        got = Decimal(str(pl.qty_received or 0))
        outstand = ordered - got
        if outstand <= 0:
            continue
        out.append(
            FuelPOLineOutstanding(
                po_line_id=pl.id,
                po_id=po.id,
                po_number=po.po_number,
                supplier_id=po.supplier_id,
                item_id=pl.item_id,
                outstanding_liters=float(outstand),
                unit_price=float(pl.unit_price),
            )
        )
    return out


@router.post("/receive-from-po", response_model=FuelTxnResponse)
async def receive_fuel_from_po_line(
    body: ReceiveFuelFromPOIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    pl = (
        db.query(PurchaseOrderLine)
        .filter(PurchaseOrderLine.tenant_id == tenant_id, PurchaseOrderLine.id == body.po_line_id)
        .first()
    )
    if not pl:
        raise HTTPException(status_code=404, detail="PO line not found")

    item = db.query(Item).filter(Item.id == pl.item_id, Item.tenant_id == tenant_id).first()
    if not item or item.type != "fuel":
        raise HTTPException(status_code=400, detail="PO line must reference a fuel item")

    tank = (
        db.query(FuelTank).filter(FuelTank.id == body.tank_id, FuelTank.tenant_id == tenant_id).first()
    )
    if not tank:
        raise HTTPException(status_code=404, detail="Tank not found")
    if tank.fuel_item_id != pl.item_id:
        raise HTTPException(status_code=400, detail="Tank fuel item must match the purchase order line item")

    qty = Decimal(str(body.qty_liters))
    ordered = Decimal(str(pl.qty))
    got = Decimal(str(pl.qty_received or 0))
    outstanding = ordered - got
    if qty <= 0 or qty > outstanding:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid quantity: outstanding is {float(outstanding)} L on this PO line",
        )

    new_stock = (tank.current_stock_liters or Decimal("0")) + qty
    if new_stock > tank.capacity_liters:
        raise HTTPException(status_code=400, detail="Receipt would exceed tank capacity")

    unit_cost = Decimal(str(pl.unit_price))
    _apply_fuel_receipt_to_tank(tank, qty, unit_cost)
    pl.qty_received = got + qty
    txn_date = body.receipt_date or datetime.utcnow()

    txn = FuelTxn(
        tenant_id=tenant_id,
        txn_type="purchase",
        fuel_item_id=tank.fuel_item_id,
        qty_liters=qty,
        unit_cost=unit_cost,
        ref_type="purchase_order_line",
        ref_id=pl.id,
        date=txn_date,
        tank_id=tank.id,
        po_line_id=pl.id,
        created_by=current_user.id,
    )
    db.add(txn)
    db.flush()

    wh_id = _fuel_ledger_warehouse_id(db, tenant_id)
    _mirror_fuel_to_stock_ledger(
        db,
        tenant_id,
        tank.fuel_item_id,
        wh_id,
        qty_in=qty,
        qty_out=Decimal("0"),
        unit_cost=unit_cost,
        fuel_txn_id=txn.id,
        txn_date=txn_date,
        tank_name=tank.name,
        created_by=current_user.id,
    )

    line_total = qty * unit_cost
    if body.post_to_gl and line_total > 0:
        je = post_fuel_receipt_accrual(
            db,
            tenant_id,
            line_total,
            memo=f"Fuel PO receipt · PO line {pl.id} · tank {tank.name}",
            ref_type="fuel_txn",
            ref_id=txn.id,
            posted_at=txn_date,
            posted_by=current_user.id,
        )
        if je:
            txn.journal_entry_id = je.id
    db.commit()
    db.refresh(txn)
    return txn


@router.post("/vehicle-issues", response_model=dict)
async def issue_to_vehicle(
    body: VehicleIssueIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    """Dispense fuel from a tank to an internal fleet vehicle (tank grade + WAC for inventory relief)."""
    tank = (
        db.query(FuelTank).filter(FuelTank.id == body.tank_id, FuelTank.tenant_id == tenant_id).first()
    )
    if not tank:
        raise HTTPException(status_code=404, detail="Tank not found")
    veh = (
        db.query(Vehicle)
        .filter(Vehicle.id == body.vehicle_id, Vehicle.tenant_id == tenant_id, Vehicle.is_active == True)
        .first()
    )
    if not veh:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    if body.cost_center_id is not None:
        cc = (
            db.query(CostCenter)
            .filter(CostCenter.id == body.cost_center_id, CostCenter.tenant_id == tenant_id, CostCenter.is_active == True)
            .first()
        )
        if not cc:
            raise HTTPException(status_code=400, detail="Invalid or inactive cost center")

    qty = Decimal(str(body.qty_liters))
    stock = tank.current_stock_liters or Decimal("0")
    if qty > stock:
        raise HTTPException(status_code=400, detail="Insufficient stock in tank")

    unit_cost = Decimal(str(body.unit_cost)) if body.unit_cost is not None else None
    if unit_cost is None:
        if tank.moving_avg_unit_cost is not None:
            unit_cost = Decimal(str(tank.moving_avg_unit_cost))
        else:
            last = (
                db.query(FuelTxn)
                .filter(
                    FuelTxn.tenant_id == tenant_id,
                    FuelTxn.fuel_item_id == tank.fuel_item_id,
                    FuelTxn.tank_id == tank.id,
                    FuelTxn.txn_type == "purchase",
                )
                .order_by(FuelTxn.date.desc(), FuelTxn.id.desc())
                .first()
            )
            if last:
                unit_cost = last.unit_cost
            else:
                it = db.query(Item).filter(Item.id == tank.fuel_item_id).first()
                unit_cost = it.standard_cost if it and it.standard_cost else Decimal("0")

    stock_after = stock - qty
    tank.current_stock_liters = stock_after
    if stock_after <= 0:
        tank.moving_avg_unit_cost = None
    # If partially depleted, WAC per liter is unchanged; receipts will re-blend via _apply_fuel_receipt_to_tank.
    txn_date = body.date or datetime.utcnow()
    ft = FuelTxn(
        tenant_id=tenant_id,
        txn_type="issue_internal",
        fuel_item_id=tank.fuel_item_id,
        qty_liters=qty,
        unit_cost=unit_cost,
        ref_type="vehicle_fuel_issue",
        ref_id=None,
        date=txn_date,
        tank_id=tank.id,
        created_by=current_user.id,
    )
    db.add(ft)
    db.flush()

    issue = VehicleFuelIssue(
        tenant_id=tenant_id,
        vehicle_id=veh.id,
        fuel_item_id=tank.fuel_item_id,
        qty_liters=qty,
        date=txn_date,
        odometer=Decimal(str(body.odometer)) if body.odometer is not None else None,
        notes=body.notes,
        ref_fuel_txn_id=ft.id,
        cost_center_id=body.cost_center_id,
        created_by=current_user.id,
    )
    db.add(issue)
    db.flush()
    ft.ref_id = issue.id

    wh_id = _fuel_ledger_warehouse_id(db, tenant_id)
    _mirror_fuel_to_stock_ledger(
        db,
        tenant_id,
        tank.fuel_item_id,
        wh_id,
        qty_in=Decimal("0"),
        qty_out=qty,
        unit_cost=unit_cost,
        fuel_txn_id=ft.id,
        txn_date=txn_date,
        tank_name=tank.name,
        created_by=current_user.id,
    )

    issue_amount = qty * unit_cost
    if body.post_to_gl and issue_amount > 0:
        je = post_fuel_internal_issue(
            db,
            tenant_id,
            issue_amount,
            memo=f"Internal fuel issue · veh {veh.reg_no} · tank {tank.name}",
            ref_type="fuel_txn",
            ref_id=ft.id,
            posted_at=txn_date,
            posted_by=current_user.id,
            cost_center_id=body.cost_center_id,
        )
        if je:
            ft.journal_entry_id = je.id
    db.commit()
    db.refresh(ft)
    db.refresh(issue)
    return {
        "fuel_txn": FuelTxnResponse.model_validate(ft).model_dump(),
        "vehicle_issue_id": issue.id,
        "vehicle_reg": veh.reg_no,
        "tank_name": tank.name,
        "fuel_grade": tank.fuel_grade,
        "cost_center_id": issue.cost_center_id,
        "journal_entry_id": ft.journal_entry_id,
    }
