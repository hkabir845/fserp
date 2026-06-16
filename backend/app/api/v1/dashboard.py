from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user, get_db, get_tenant_id
from app.modules.tenancy.models import User
from fastapi import Request

router = APIRouter()


class DashboardSummary(BaseModel):
    as_of: str

    items: int
    warehouses: int
    suppliers: int
    customers: int

    purchase_orders: int
    sales_invoices: int
    receipts: int

    feed_boms: int
    production_orders: int
    silos: int
    silo_reorder_alerts: int

    receipts_last_30d_amount: float


@router.get("/summary", response_model=DashboardSummary)
async def get_dashboard_summary(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)

    # Import models lazily to avoid mapper init issues
    from app.modules.catalog.models import Item
    from app.modules.inventory.models import Warehouse
    from app.modules.procurement.models import Supplier, PurchaseOrder
    from app.modules.sales.models import Customer, SalesInvoice, Receipt
    from app.modules.feed_manufacturing.models import FeedBom, ProductionOrder, Silo

    now = datetime.utcnow()
    since = now - timedelta(days=30)

    items = db.query(Item).filter(Item.tenant_id == tenant_id, Item.is_active == True).count()
    warehouses = db.query(Warehouse).filter(Warehouse.tenant_id == tenant_id, Warehouse.is_active == True).count()
    suppliers = db.query(Supplier).filter(Supplier.tenant_id == tenant_id).count()
    customers = db.query(Customer).filter(Customer.tenant_id == tenant_id).count()

    purchase_orders = db.query(PurchaseOrder).filter(PurchaseOrder.tenant_id == tenant_id).count()
    sales_invoices = db.query(SalesInvoice).filter(SalesInvoice.tenant_id == tenant_id).count()
    receipts = db.query(Receipt).filter(Receipt.tenant_id == tenant_id).count()

    feed_boms = db.query(FeedBom).filter(FeedBom.tenant_id == tenant_id).count()
    production_orders = db.query(ProductionOrder).filter(ProductionOrder.tenant_id == tenant_id).count()
    silos = db.query(Silo).filter(Silo.tenant_id == tenant_id, Silo.is_active == True).count()
    silo_rows = (
        db.query(Silo)
        .filter(Silo.tenant_id == tenant_id, Silo.is_active == True, Silo.reorder_min_kg != None)
        .all()
    )
    silo_reorder_alerts = 0
    for s in silo_rows:
        cur = Decimal(str(s.current_qty_kg or 0))
        mn = Decimal(str(s.reorder_min_kg))
        if cur <= mn:
            silo_reorder_alerts += 1

    r_sum = (
        db.query(Receipt)
        .filter(Receipt.tenant_id == tenant_id, Receipt.receipt_date >= since)
        .all()
    )
    receipts_last_30d_amount = float(sum([Decimal(str(r.amount or 0)) for r in r_sum], Decimal("0")))

    return DashboardSummary(
        as_of=now.isoformat(),
        items=items,
        warehouses=warehouses,
        suppliers=suppliers,
        customers=customers,
        purchase_orders=purchase_orders,
        sales_invoices=sales_invoices,
        receipts=receipts,
        feed_boms=feed_boms,
        production_orders=production_orders,
        silos=silos,
        silo_reorder_alerts=silo_reorder_alerts,
        receipts_last_30d_amount=receipts_last_30d_amount,
    )
