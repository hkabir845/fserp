from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime
from decimal import Decimal
from app.core.dependencies import get_db, get_current_user, get_tenant_id
from app.modules.procurement.models import (
    PurchaseOrder,
    PurchaseOrderLine,
    GoodsReceipt,
    GoodsReceiptLine,
    Supplier,
    VendorBill,
    VendorBillLine,
)
from app.modules.catalog.models import Item
from app.modules.tenancy.models import User
from app.modules.inventory.stock_service import StockService
from app.modules.accounting.posting_service import PostingService
from app.shared.enums import DocumentStatus
from pydantic import BaseModel
from fastapi import Request

router = APIRouter()

class POLineCreate(BaseModel):
    item_id: int
    qty: float
    unit_price: float

class POCreate(BaseModel):
    supplier_id: int
    order_date: datetime
    expected_date: datetime | None = None
    lines: List[POLineCreate]

class POResponse(BaseModel):
    id: int
    po_number: str
    supplier_id: int
    status: str
    total_amount: float
    order_date: datetime
    expected_date: datetime | None = None
    
    class Config:
        from_attributes = True

class POLineResponse(BaseModel):
    id: int
    po_id: int
    item_id: int
    qty: float
    qty_received: float
    unit_price: float
    total: float
    
    class Config:
        from_attributes = True

class PODetailResponse(POResponse):
    lines: List[POLineResponse] = []

@router.post("/orders", response_model=POResponse)
async def create_purchase_order(
    po_data: POCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a purchase order"""
    tenant_id = get_tenant_id(request)
    
    # Generate PO number
    po_number = f"PO-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    
    total = Decimal("0")
    for line in po_data.lines:
        total += Decimal(str(line.qty)) * Decimal(str(line.unit_price))
    
    po = PurchaseOrder(
        tenant_id=tenant_id,
        po_number=po_number,
        supplier_id=po_data.supplier_id,
        status=DocumentStatus.DRAFT,
        order_date=po_data.order_date,
        expected_date=po_data.expected_date,
        total_amount=total,
        created_by=current_user.id
    )
    db.add(po)
    db.flush()
    
    for line_data in po_data.lines:
        line_total = Decimal(str(line_data.qty)) * Decimal(str(line_data.unit_price))
        line = PurchaseOrderLine(
            tenant_id=tenant_id,
            po_id=po.id,
            item_id=line_data.item_id,
            qty=Decimal(str(line_data.qty)),
            qty_received=Decimal("0"),
            unit_price=Decimal(str(line_data.unit_price)),
            total=line_total,
            created_by=current_user.id
        )
        db.add(line)
    
    db.commit()
    db.refresh(po)
    return po

class GRNLineCreate(BaseModel):
    item_id: int
    qty: float
    unit_cost: float
    batch_no: str | None = None

class GRNCreate(BaseModel):
    supplier_id: int
    warehouse_id: int
    receipt_date: datetime
    ref_po_id: int | None = None
    lines: List[GRNLineCreate]

class GRNResponse(BaseModel):
    id: int
    grn_number: str
    supplier_id: int
    warehouse_id: int
    ref_po_id: int | None
    status: str
    receipt_date: datetime
    total_amount: float

    class Config:
        from_attributes = True


class GRNLineResponse(BaseModel):
    id: int
    grn_id: int
    item_id: int
    qty: float
    unit_cost: float
    total: float
    batch_no: str | None

    class Config:
        from_attributes = True


class GRNDetailResponse(GRNResponse):
    lines: List[GRNLineResponse] = []


def _grn_total_amount(db: Session, tenant_id: int, grn_id: int) -> Decimal:
    q = db.query(func.coalesce(func.sum(GoodsReceiptLine.total), 0)).filter(
        GoodsReceiptLine.tenant_id == tenant_id,
        GoodsReceiptLine.grn_id == grn_id,
    )
    return Decimal(str(q.scalar() or 0))


def grn_to_response(db: Session, tenant_id: int, grn: GoodsReceipt) -> GRNResponse:
    total = _grn_total_amount(db, tenant_id, grn.id)
    return GRNResponse(
        id=grn.id,
        grn_number=grn.grn_number,
        supplier_id=grn.supplier_id,
        warehouse_id=grn.warehouse_id,
        ref_po_id=grn.ref_po_id,
        status=grn.status,
        receipt_date=grn.receipt_date,
        total_amount=float(total),
    )


@router.post("/grn", response_model=GRNResponse)
async def create_grn(
    grn_data: GRNCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create goods receipt note, post stock, and accrue GRNI (Dr Inventory / Cr GRNI) when accounts exist."""
    tenant_id = get_tenant_id(request)
    if not grn_data.lines:
        raise HTTPException(status_code=400, detail="GRN must have at least one line")

    # Generate GRN number
    grn_number = f"GRN-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    
    # Create GRN
    grn = GoodsReceipt(
        tenant_id=tenant_id,
        grn_number=grn_number,
        supplier_id=grn_data.supplier_id,
        warehouse_id=grn_data.warehouse_id,
        ref_po_id=grn_data.ref_po_id,
        status=DocumentStatus.DRAFT,
        receipt_date=grn_data.receipt_date,
        created_by=current_user.id
    )
    db.add(grn)
    db.flush()
    
    grni_total = Decimal("0")

    # Create lines and post to stock ledger
    for line_data in grn_data.lines:
        qty = Decimal(str(line_data.qty))
        if qty <= 0:
            raise HTTPException(status_code=400, detail="Each GRN line quantity must be greater than zero")
        unit_cost = Decimal(str(line_data.unit_cost))
        line_total = qty * unit_cost
        grni_total += line_total
        
        # Create GRN line
        line = GoodsReceiptLine(
            tenant_id=tenant_id,
            grn_id=grn.id,
            item_id=line_data.item_id,
            qty=qty,
            unit_cost=unit_cost,
            total=line_total,
            batch_no=line_data.batch_no,
            created_by=current_user.id
        )
        db.add(line)
        
        # Post to stock ledger
        StockService.create_stock_move(
            db=db,
            tenant_id=tenant_id,
            item_id=line_data.item_id,
            warehouse_id=grn_data.warehouse_id,
            qty_in=qty,
            qty_out=Decimal("0"),
            unit_cost=unit_cost,
            txn_type="receipt",
            ref_type="grn",
            ref_id=grn.id,
            txn_date=grn_data.receipt_date,
            batch_no=line_data.batch_no,
            notes=f"GRN {grn_number}",
            created_by=current_user.id
        )
    
    # Update status to posted
    grn.status = DocumentStatus.POSTED
    db.commit()
    db.refresh(grn)

    # Accrual: capitalize stock value into Inventory, balance to GRNI until vendor invoice posts AP
    if grni_total > 0:
        inventory_account = PostingService.get_account_by_name(db, tenant_id, "Inventory")
        grni_account = PostingService.get_account_by_name(db, tenant_id, "Goods Received Not Invoiced")
        if inventory_account and grni_account:
            PostingService.create_journal_entry(
                db=db,
                tenant_id=tenant_id,
                date=grn_data.receipt_date,
                memo=f"GRN accrual {grn_number}",
                lines=[
                    {
                        "account_id": inventory_account.id,
                        "debit": float(grni_total),
                        "credit": 0,
                        "memo": f"GRN {grn_number}",
                    },
                    {
                        "account_id": grni_account.id,
                        "debit": 0,
                        "credit": float(grni_total),
                        "memo": f"GRN {grn_number}",
                    },
                ],
                ref_type="grn",
                ref_id=grn.id,
                posted_by=current_user.id,
            )

    return grn_to_response(db, tenant_id, grn)

class VendorBillLineCreate(BaseModel):
    item_id: int
    qty: float
    unit_price: float

class VendorBillCreate(BaseModel):
    supplier_id: int
    bill_date: datetime
    due_date: datetime | None = None
    ref_grn_id: int | None = None
    lines: List[VendorBillLineCreate]

class VendorBillResponse(BaseModel):
    id: int
    bill_number: str
    supplier_id: int
    status: str
    total_amount: float
    bill_date: datetime
    due_date: datetime | None = None
    ref_grn_id: int | None = None

    class Config:
        from_attributes = True


class VendorBillLineResponse(BaseModel):
    id: int
    item_id: int
    qty: float
    unit_price: float
    total: float

    class Config:
        from_attributes = True


class VendorBillListItem(BaseModel):
    id: int
    bill_number: str
    supplier_id: int
    supplier_name: str
    status: str
    bill_date: datetime
    due_date: datetime | None
    total_amount: float
    ref_grn_id: int | None
    line_count: int


class VendorBillDetailResponse(VendorBillResponse):
    lines: List[VendorBillLineResponse] = []


def _bill_to_response(b: VendorBill) -> VendorBillResponse:
    return VendorBillResponse(
        id=b.id,
        bill_number=b.bill_number,
        supplier_id=b.supplier_id,
        status=str(b.status),
        total_amount=float(b.total_amount or 0),
        bill_date=b.bill_date,
        due_date=b.due_date,
        ref_grn_id=b.ref_grn_id,
    )


@router.get("/vendor-bills", response_model=List[VendorBillListItem])
async def list_vendor_bills(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    bills = (
        db.query(VendorBill)
        .filter(VendorBill.tenant_id == tenant_id)
        .order_by(VendorBill.id.desc())
        .all()
    )
    out: List[VendorBillListItem] = []
    for bill in bills:
        supplier = db.query(Supplier).filter(Supplier.id == bill.supplier_id).first()
        line_count = (
            db.query(func.count(VendorBillLine.id))
            .filter(
                VendorBillLine.tenant_id == tenant_id,
                VendorBillLine.bill_id == bill.id,
            )
            .scalar()
            or 0
        )
        out.append(
            VendorBillListItem(
                id=bill.id,
                bill_number=bill.bill_number,
                supplier_id=bill.supplier_id,
                supplier_name=(supplier.name if supplier else ""),
                status=str(bill.status),
                bill_date=bill.bill_date,
                due_date=bill.due_date,
                total_amount=float(bill.total_amount or 0),
                ref_grn_id=bill.ref_grn_id,
                line_count=int(line_count),
            )
        )
    return out


@router.get("/vendor-bills/{bill_id}", response_model=VendorBillDetailResponse)
async def get_vendor_bill(
    bill_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    bill = db.query(VendorBill).filter(
        VendorBill.tenant_id == tenant_id,
        VendorBill.id == bill_id,
    ).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Vendor bill not found")
    lines = (
        db.query(VendorBillLine)
        .filter(
            VendorBillLine.tenant_id == tenant_id,
            VendorBillLine.bill_id == bill_id,
        )
        .order_by(VendorBillLine.id.asc())
        .all()
    )
    base = _bill_to_response(bill)
    return VendorBillDetailResponse(
        **base.model_dump(),
        lines=[
            VendorBillLineResponse(
                id=l.id,
                item_id=l.item_id,
                qty=float(l.qty),
                unit_price=float(l.unit_price),
                total=float(l.total),
            )
            for l in lines
        ],
    )


@router.post("/vendor-bills/seed-demo", response_model=List[VendorBillResponse])
async def seed_demo_vendor_bills(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a few sample vendor bills (direct inventory debit, no GRN) when suppliers/items/accounts exist."""
    tenant_id = get_tenant_id(request)

    ap_account = PostingService.get_account_by_name(db, tenant_id, "Accounts Payable")
    inv_account = PostingService.get_account_by_name(db, tenant_id, "Inventory")
    if not ap_account or not inv_account:
        raise HTTPException(
            status_code=400,
            detail="Need Accounts Payable and Inventory GL accounts (run tenant accounting seed).",
        )

    suppliers = (
        db.query(Supplier)
        .filter(Supplier.tenant_id == tenant_id, Supplier.is_active == True)
        .order_by(Supplier.id.asc())
        .limit(5)
        .all()
    )
    items = (
        db.query(Item)
        .filter(Item.tenant_id == tenant_id, Item.is_active == True)
        .order_by(Item.id.asc())
        .limit(10)
        .all()
    )
    if len(suppliers) < 1 or len(items) < 1:
        raise HTTPException(
            status_code=400,
            detail="Need at least one active supplier and one active item (Items & Suppliers).",
        )

    samples: list[VendorBillCreate] = []
    # Rotate suppliers/items into three small bills
    for i in range(3):
        sup = suppliers[i % len(suppliers)]
        it = items[i % len(items)]
        qty = Decimal("10") + Decimal(i + 1)
        unit = Decimal("25.50") + Decimal(i * 5)
        samples.append(
            VendorBillCreate(
                supplier_id=sup.id,
                bill_date=datetime.utcnow(),
                due_date=None,
                ref_grn_id=None,
                lines=[
                    VendorBillLineCreate(
                        item_id=it.id,
                        qty=float(qty),
                        unit_price=float(unit),
                    )
                ],
            )
        )

    created: List[VendorBillResponse] = []
    for sample in samples:
        # Inline create body (same as create_vendor_bill) — call shared logic via dependency would be heavier
        resp = await create_vendor_bill(sample, request, db, current_user)
        created.append(resp)

    return created


@router.post("/vendor-bills", response_model=VendorBillResponse)
async def create_vendor_bill(
    bill_data: VendorBillCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create vendor bill and post to accounting"""
    tenant_id = get_tenant_id(request)
    
    # Generate bill number (microseconds avoid collisions in batch / seed)
    bill_number = f"VB-{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}"
    
    # Calculate total
    total = Decimal("0")
    for line in bill_data.lines:
        total += Decimal(str(line.qty)) * Decimal(str(line.unit_price))
    
    # Create vendor bill
    bill = VendorBill(
        tenant_id=tenant_id,
        bill_number=bill_number,
        supplier_id=bill_data.supplier_id,
        ref_grn_id=bill_data.ref_grn_id,
        status=DocumentStatus.DRAFT,
        bill_date=bill_data.bill_date,
        due_date=bill_data.due_date,
        total_amount=total,
        created_by=current_user.id
    )
    db.add(bill)
    db.flush()
    
    # Create lines
    for line_data in bill_data.lines:
        line_total = Decimal(str(line_data.qty)) * Decimal(str(line_data.unit_price))
        line = VendorBillLine(
            tenant_id=tenant_id,
            bill_id=bill.id,
            item_id=line_data.item_id,
            qty=Decimal(str(line_data.qty)),
            unit_price=Decimal(str(line_data.unit_price)),
            total=line_total,
            created_by=current_user.id
        )
        db.add(line)
    
    ap_account = PostingService.get_account_by_name(db, tenant_id, "Accounts Payable")
    if not ap_account:
        raise HTTPException(
            status_code=400,
            detail="Accounts Payable not found. Please run seed / migrations."
        )

    debit_account = None
    if bill_data.ref_grn_id:
        ref_grn = db.query(GoodsReceipt).filter(
            GoodsReceipt.tenant_id == tenant_id,
            GoodsReceipt.id == bill_data.ref_grn_id,
        ).first()
        if not ref_grn:
            raise HTTPException(status_code=400, detail="Linked GRN not found")
        if ref_grn.supplier_id != bill_data.supplier_id:
            raise HTTPException(status_code=400, detail="Vendor bill supplier must match the linked GRN supplier")
        grni = PostingService.get_account_by_name(db, tenant_id, "Goods Received Not Invoiced")
        if not grni:
            raise HTTPException(
                status_code=400,
                detail="Goods Received Not Invoiced account missing. Run database migrations.",
            )
        debit_account = grni
    else:
        inventory_account = PostingService.get_account_by_name(db, tenant_id, "Inventory")
        if not inventory_account:
            raise HTTPException(
                status_code=400,
                detail="Inventory account not found. Please run seed script.",
            )
        debit_account = inventory_account

    journal_lines = [
        {
            "account_id": debit_account.id,
            "debit": float(total),
            "credit": 0,
            "memo": f"Vendor Bill {bill_number}",
        },
        {
            "account_id": ap_account.id,
            "debit": 0,
            "credit": float(total),
            "memo": f"Vendor Bill {bill_number}",
        },
    ]

    # Create journal entry
    PostingService.create_journal_entry(
        db=db,
        tenant_id=tenant_id,
        date=bill_data.bill_date,
        memo=f"Vendor Bill {bill_number}",
        lines=journal_lines,
        ref_type="vendor_bill",
        ref_id=bill.id,
        posted_by=current_user.id
    )
    
    # Update status to posted
    bill.status = DocumentStatus.POSTED
    db.commit()
    db.refresh(bill)
    return _bill_to_response(bill)

@router.get("/orders", response_model=List[POResponse])
async def list_purchase_orders(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all purchase orders"""
    tenant_id = get_tenant_id(request)
    orders = db.query(PurchaseOrder).filter(PurchaseOrder.tenant_id == tenant_id).order_by(PurchaseOrder.id.desc()).all()
    return orders

@router.get("/orders/{po_id}", response_model=PODetailResponse)
async def get_purchase_order(
    po_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get purchase order with lines"""
    tenant_id = get_tenant_id(request)
    po = db.query(PurchaseOrder).filter(PurchaseOrder.tenant_id == tenant_id, PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return po

@router.get("/orders/{po_id}/lines", response_model=List[POLineResponse])
async def get_purchase_order_lines(
    po_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get purchase order lines"""
    tenant_id = get_tenant_id(request)
    lines = db.query(PurchaseOrderLine).filter(
        PurchaseOrderLine.tenant_id == tenant_id,
        PurchaseOrderLine.po_id == po_id
    ).all()
    return lines

class ReceivePOLineRequest(BaseModel):
    po_line_id: int
    qty: float
    batch_no: str | None = None


class ReceiveFromPORequest(BaseModel):
    warehouse_id: int
    receipt_date: datetime
    lines: List[ReceivePOLineRequest] | None = None


@router.post("/orders/{po_id}/receive", response_model=GRNResponse)
async def receive_po_to_grn(
    po_id: int,
    receive_data: ReceiveFromPORequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create GRN from PO lines (partial or full outstanding) and update qty_received on each PO line."""
    tenant_id = get_tenant_id(request)
    po = db.query(PurchaseOrder).filter(PurchaseOrder.tenant_id == tenant_id, PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")

    po_lines = db.query(PurchaseOrderLine).filter(
        PurchaseOrderLine.tenant_id == tenant_id,
        PurchaseOrderLine.po_id == po_id
    ).all()
    if not po_lines:
        raise HTTPException(status_code=400, detail="Purchase order has no lines")

    po_line_by_id = {l.id: l for l in po_lines}
    grn_lines: List[GRNLineCreate] = []
    qty_updates: List[tuple[int, Decimal]] = []

    def outstanding(pl: PurchaseOrderLine) -> Decimal:
        ordered = Decimal(str(pl.qty))
        got = Decimal(str(pl.qty_received or 0))
        return ordered - got

    if receive_data.lines is None:
        for pl in po_lines:
            out = outstanding(pl)
            if out <= 0:
                continue
            grn_lines.append(
                GRNLineCreate(
                    item_id=pl.item_id,
                    qty=float(out),
                    unit_cost=float(pl.unit_price),
                    batch_no=None,
                )
            )
            qty_updates.append((pl.id, out))
    else:
        for req in receive_data.lines:
            pl = po_line_by_id.get(req.po_line_id)
            if not pl:
                raise HTTPException(status_code=400, detail=f"PO line {req.po_line_id} does not belong to this PO")
            out = outstanding(pl)
            q = Decimal(str(req.qty))
            if q <= 0:
                raise HTTPException(status_code=400, detail=f"PO line {pl.id}: receive quantity must be positive")
            if q > out:
                raise HTTPException(
                    status_code=400,
                    detail=f"PO line {pl.id}: cannot receive {q} — only {out} outstanding",
                )
            grn_lines.append(
                GRNLineCreate(
                    item_id=pl.item_id,
                    qty=float(q),
                    unit_cost=float(pl.unit_price),
                    batch_no=req.batch_no,
                )
            )
            qty_updates.append((pl.id, q))

    if not grn_lines:
        raise HTTPException(status_code=400, detail="Nothing left to receive on this purchase order")

    grn_payload = GRNCreate(
        supplier_id=po.supplier_id,
        warehouse_id=receive_data.warehouse_id,
        receipt_date=receive_data.receipt_date,
        ref_po_id=po.id,
        lines=grn_lines,
    )
    response = await create_grn(grn_payload, request, db, current_user)

    for pl_id, add_qty in qty_updates:
        pl_row = db.query(PurchaseOrderLine).filter(
            PurchaseOrderLine.tenant_id == tenant_id,
            PurchaseOrderLine.id == pl_id,
        ).first()
        if pl_row:
            pl_row.qty_received = Decimal(str(pl_row.qty_received or 0)) + add_qty
    db.commit()

    return response


@router.get("/grn", response_model=List[GRNResponse])
async def list_grns(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all goods receipt notes"""
    tenant_id = get_tenant_id(request)
    grns = db.query(GoodsReceipt).filter(
        GoodsReceipt.tenant_id == tenant_id
    ).order_by(GoodsReceipt.id.desc()).all()
    return [grn_to_response(db, tenant_id, g) for g in grns]


@router.get("/grn/{grn_id}", response_model=GRNDetailResponse)
async def get_grn(
    grn_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    tenant_id = get_tenant_id(request)
    grn = db.query(GoodsReceipt).filter(
        GoodsReceipt.tenant_id == tenant_id,
        GoodsReceipt.id == grn_id,
    ).first()
    if not grn:
        raise HTTPException(status_code=404, detail="GRN not found")
    lines = db.query(GoodsReceiptLine).filter(
        GoodsReceiptLine.tenant_id == tenant_id,
        GoodsReceiptLine.grn_id == grn_id,
    ).all()
    base = grn_to_response(db, tenant_id, grn)
    return GRNDetailResponse(
        **base.model_dump(),
        lines=[GRNLineResponse.model_validate(l) for l in lines],
    )

