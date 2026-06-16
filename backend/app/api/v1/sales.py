from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.core.dependencies import get_db, get_current_user, get_tenant_id
from app.modules.sales.models import SalesInvoice, SalesInvoiceLine
from app.modules.tenancy.models import User
from pydantic import BaseModel
from fastapi import Request

router = APIRouter()

class InvoiceLineCreate(BaseModel):
    item_id: int
    qty: float
    unit_price: float
    warehouse_id: int | None = None

class InvoiceCreate(BaseModel):
    customer_id: int
    invoice_date: str
    lines: List[InvoiceLineCreate]

class InvoiceResponse(BaseModel):
    id: int
    invoice_number: str
    customer_id: int
    status: str
    total_amount: float
    
    class Config:
        from_attributes = True

@router.get("/invoices", response_model=List[InvoiceResponse])
async def list_invoices(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all sales invoices"""
    tenant_id = get_tenant_id(request)
    invoices = db.query(SalesInvoice).filter(
        SalesInvoice.tenant_id == tenant_id
    ).all()
    return invoices

@router.post("/invoices", response_model=InvoiceResponse)
async def create_invoice(
    invoice_data: InvoiceCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a sales invoice with stock and accounting posting"""
    from app.modules.inventory.stock_service import StockService
    from app.modules.accounting.posting_service import PostingService
    from app.shared.enums import DocumentStatus
    from datetime import datetime
    from decimal import Decimal
    
    tenant_id = get_tenant_id(request)
    
    # Generate invoice number
    invoice_number = f"INV-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    invoice_date = datetime.fromisoformat(invoice_data.invoice_date) if isinstance(invoice_data.invoice_date, str) else invoice_data.invoice_date
    
    # Calculate totals
    total = Decimal("0")
    for line in invoice_data.lines:
        total += Decimal(str(line.qty)) * Decimal(str(line.unit_price))
    
    # Create invoice
    invoice = SalesInvoice(
        tenant_id=tenant_id,
        invoice_number=invoice_number,
        customer_id=invoice_data.customer_id,
        status=DocumentStatus.DRAFT,
        invoice_date=invoice_date,
        total_amount=total,
        created_by=current_user.id
    )
    db.add(invoice)
    db.flush()
    
    # Get accounts for posting
    ar_account = PostingService.get_account_by_name(db, tenant_id, "Accounts Receivable")
    revenue_account = PostingService.get_account_by_name(db, tenant_id, "Sales Revenue")
    cogs_account = PostingService.get_account_by_name(db, tenant_id, "Cost of Goods Sold")
    inventory_account = PostingService.get_account_by_name(db, tenant_id, "Inventory")
    
    if not all([ar_account, revenue_account, cogs_account, inventory_account]):
        raise HTTPException(
            status_code=400,
            detail="Required accounts not found. Please run seed script."
        )
    
    total_cogs = Decimal("0")
    
    # Create lines, post stock, and calculate COGS
    for line_data in invoice_data.lines:
        qty = Decimal(str(line_data.qty))
        unit_price = Decimal(str(line_data.unit_price))
        line_total = qty * unit_price
        
        # Create invoice line
        line = SalesInvoiceLine(
            tenant_id=tenant_id,
            invoice_id=invoice.id,
            item_id=line_data.item_id,
            qty=qty,
            unit_price=unit_price,
            total=line_total,
            warehouse_id=line_data.warehouse_id,
            created_by=current_user.id
        )
        db.add(line)
        
        # Post stock out if item is stock-tracked
        from app.modules.catalog.models import Item
        item = db.query(Item).filter(
            Item.id == line_data.item_id,
            Item.tenant_id == tenant_id
        ).first()
        
        if item and item.is_stock_tracked and line_data.warehouse_id:
            # Get FIFO cost
            unit_cost = StockService.get_fifo_cost(
                db=db,
                tenant_id=tenant_id,
                item_id=line_data.item_id,
                warehouse_id=line_data.warehouse_id,
                qty=qty
            )
            
            if unit_cost == 0:
                # Fallback to standard cost or item's standard cost
                unit_cost = item.standard_cost or Decimal("0")
            
            cogs_amount = qty * unit_cost
            total_cogs += cogs_amount
            
            # Post stock out
            StockService.create_stock_move(
                db=db,
                tenant_id=tenant_id,
                item_id=line_data.item_id,
                warehouse_id=line_data.warehouse_id,
                qty_in=Decimal("0"),
                qty_out=qty,
                unit_cost=unit_cost,
                txn_type="issue",
                ref_type="sales_invoice",
                ref_id=invoice.id,
                txn_date=invoice_date,
                notes=f"Sales Invoice {invoice_number}",
                created_by=current_user.id
            )
    
    # Post to accounting: AR (Dr), Revenue (Cr), COGS (Dr), Inventory (Cr)
    journal_lines = [
        {
            "account_id": ar_account.id,
            "debit": float(total),
            "credit": 0,
            "memo": f"Sales Invoice {invoice_number}"
        },
        {
            "account_id": revenue_account.id,
            "debit": 0,
            "credit": float(total),
            "memo": f"Sales Invoice {invoice_number}"
        }
    ]
    
    # Add COGS and Inventory entries if there's stock movement
    if total_cogs > 0:
        journal_lines.extend([
            {
                "account_id": cogs_account.id,
                "debit": float(total_cogs),
                "credit": 0,
                "memo": f"COGS for Invoice {invoice_number}"
            },
            {
                "account_id": inventory_account.id,
                "debit": 0,
                "credit": float(total_cogs),
                "memo": f"Inventory reduction for Invoice {invoice_number}"
            }
        ])
    
    # Create journal entry
    PostingService.create_journal_entry(
        db=db,
        tenant_id=tenant_id,
        date=invoice_date,
        memo=f"Sales Invoice {invoice_number}",
        lines=journal_lines,
        ref_type="sales_invoice",
        ref_id=invoice.id,
        posted_by=current_user.id
    )
    
    # Update status to posted
    invoice.status = DocumentStatus.POSTED
    db.commit()
    db.refresh(invoice)
    return invoice

class ReceiptCreate(BaseModel):
    customer_id: int
    receipt_date: str
    amount: float
    method: str  # cash, bank, cheque
    ref_invoice_id: int | None = None

class ReceiptResponse(BaseModel):
    id: int
    receipt_number: str
    customer_id: int
    receipt_date: str | None = None
    amount: float
    method: str
    ref_invoice_id: int | None = None
    customer_name: str | None = None
    ref_invoice_number: str | None = None
    
    class Config:
        from_attributes = True

@router.post("/receipts", response_model=ReceiptResponse)
async def create_receipt(
    receipt_data: ReceiptCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create customer receipt and post to accounting"""
    from app.modules.sales.models import Receipt
    from app.modules.accounting.posting_service import PostingService
    from app.shared.enums import DocumentStatus
    from datetime import datetime
    from decimal import Decimal
    
    tenant_id = get_tenant_id(request)
    
    # Generate receipt number
    receipt_number = f"RCP-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    receipt_date = datetime.fromisoformat(receipt_data.receipt_date) if isinstance(receipt_data.receipt_date, str) else receipt_data.receipt_date
    amount = Decimal(str(receipt_data.amount))
    
    # Create receipt
    receipt = Receipt(
        tenant_id=tenant_id,
        receipt_number=receipt_number,
        customer_id=receipt_data.customer_id,
        ref_invoice_id=receipt_data.ref_invoice_id,
        amount=amount,
        method=receipt_data.method,
        receipt_date=receipt_date,
        created_by=current_user.id
    )
    db.add(receipt)
    db.flush()
    
    # Get accounts for posting
    ar_account = PostingService.get_account_by_name(db, tenant_id, "Accounts Receivable")
    
    # Determine cash/bank account based on payment method
    if receipt_data.method.lower() == "cash":
        cash_account = PostingService.get_account_by_name(db, tenant_id, "Cash")
        payment_account = cash_account
    else:
        bank_account = PostingService.get_account_by_name(db, tenant_id, "Bank")
        payment_account = bank_account
    
    if not ar_account or not payment_account:
        raise HTTPException(
            status_code=400,
            detail="Required accounts not found. Please run seed script."
        )
    
    # Post to accounting: Cash/Bank (Dr) -> AR (Cr)
    journal_lines = [
        {
            "account_id": payment_account.id,
            "debit": float(amount),
            "credit": 0,
            "memo": f"Receipt {receipt_number} - {receipt_data.method}"
        },
        {
            "account_id": ar_account.id,
            "debit": 0,
            "credit": float(amount),
            "memo": f"Receipt {receipt_number} against Invoice"
        }
    ]
    
    # Create journal entry
    PostingService.create_journal_entry(
        db=db,
        tenant_id=tenant_id,
        date=receipt_date,
        memo=f"Customer Receipt {receipt_number}",
        lines=journal_lines,
        ref_type="receipt",
        ref_id=receipt.id,
        posted_by=current_user.id
    )
    
    db.commit()
    db.refresh(receipt)
    return ReceiptResponse(
        id=receipt.id,
        receipt_number=receipt.receipt_number,
        customer_id=receipt.customer_id,
        receipt_date=receipt.receipt_date.isoformat() if receipt.receipt_date else None,
        amount=float(receipt.amount),
        method=receipt.method,
        ref_invoice_id=receipt.ref_invoice_id,
        customer_name=receipt.customer.name if receipt.customer else None,
        ref_invoice_number=receipt.invoice.invoice_number if receipt.invoice else None,
    )

@router.get("/receipts", response_model=List[ReceiptResponse])
async def list_receipts(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all receipts"""
    from app.modules.sales.models import Receipt
    tenant_id = get_tenant_id(request)
    receipts = (
        db.query(Receipt)
        .filter(Receipt.tenant_id == tenant_id)
        .order_by(Receipt.receipt_date.desc(), Receipt.id.desc())
        .all()
    )
    return [
        ReceiptResponse(
            id=r.id,
            receipt_number=r.receipt_number,
            customer_id=r.customer_id,
            receipt_date=r.receipt_date.isoformat() if r.receipt_date else None,
            amount=float(r.amount),
            method=r.method,
            ref_invoice_id=r.ref_invoice_id,
            customer_name=r.customer.name if r.customer else None,
            ref_invoice_number=r.invoice.invoice_number if r.invoice else None,
        )
        for r in receipts
    ]


@router.get("/receipts/{receipt_id}", response_model=ReceiptResponse)
async def get_receipt(
    receipt_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a single receipt"""
    from app.modules.sales.models import Receipt

    tenant_id = get_tenant_id(request)
    r = db.query(Receipt).filter(Receipt.tenant_id == tenant_id, Receipt.id == receipt_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Receipt not found")

    return ReceiptResponse(
        id=r.id,
        receipt_number=r.receipt_number,
        customer_id=r.customer_id,
        receipt_date=r.receipt_date.isoformat() if r.receipt_date else None,
        amount=float(r.amount),
        method=r.method,
        ref_invoice_id=r.ref_invoice_id,
        customer_name=r.customer.name if r.customer else None,
        ref_invoice_number=r.invoice.invoice_number if r.invoice else None,
    )

