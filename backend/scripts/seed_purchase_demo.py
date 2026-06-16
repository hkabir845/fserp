"""Seed demo suppliers + purchase orders + GRNs (inventory integrated).

Creates:
- 3 suppliers (feed/flour/fuel)
- 6 purchase orders with realistic lines
- 2 GRNs posted to stock for some POs

Idempotent by supplier name and PO number prefix.
Tenant: localhost (default)

Run:
  python scripts/seed_purchase_demo.py

Optional:
  Set TENANT_DOMAIN env var (default: localhost)
"""

import os
import sys
from datetime import datetime, timedelta
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import SessionLocal
from app.modules.tenancy.models import Tenant, User
from app.modules.procurement.models import Supplier, PurchaseOrder, PurchaseOrderLine, GoodsReceipt, GoodsReceiptLine
from app.modules.catalog.models import Item
from app.modules.inventory.models import Warehouse
from app.modules.inventory.stock_service import StockService


def seed_purchase_demo(domain: str | None = None):
    db = SessionLocal()
    try:
        domain = domain or os.environ.get("TENANT_DOMAIN") or "localhost"
        tenant = db.query(Tenant).filter(Tenant.domain == domain).first()
        if not tenant:
            raise RuntimeError(f"Tenant '{domain}' not found. Run scripts/seed.py first.")

        user = db.query(User).filter(User.tenant_id == tenant.id).order_by(User.id.asc()).first()
        if not user:
            raise RuntimeError('No user found for tenant.')

        wh = db.query(Warehouse).filter(Warehouse.tenant_id == tenant.id).order_by(Warehouse.id.asc()).first()
        if not wh:
            raise RuntimeError('No warehouse found. Create one in UI or run other seed scripts.')

        def ensure_supplier(name: str, email: str):
            s = db.query(Supplier).filter(Supplier.tenant_id == tenant.id, Supplier.name == name).first()
            if s:
                return s
            s = Supplier(tenant_id=tenant.id, name=name, email=email, is_active=True, created_by=user.id)
            db.add(s)
            db.flush()
            return s

        feed_sup = ensure_supplier('Agro Feed Traders', 'feed@demo.local')
        flour_sup = ensure_supplier('Wheat Grain Suppliers Co.', 'wheat@demo.local')
        fuel_sup = ensure_supplier('National Fuel Distributors', 'fuel@demo.local')

        def item_by_sku(sku: str) -> Item:
            it = db.query(Item).filter(Item.tenant_id == tenant.id, Item.sku == sku).first()
            if not it:
                raise RuntimeError(f'Missing item SKU {sku}. Run scripts/seed_items_industry_demo.py')
            return it

        # Items
        maize = item_by_sku('FM-RM-001')
        soya = item_by_sku('FM-RM-002')
        rice_bran = item_by_sku('FM-RM-003')
        wheat_grain = item_by_sku('FL-RM-001')
        diesel = item_by_sku('FS-FUEL-DIESEL')
        octane = item_by_sku('FS-FUEL-OCTANE')
        oil = item_by_sku('FS-OIL-20W50-1L')

        now = datetime.utcnow()

        def create_po(supplier: Supplier, lines: list[tuple[Item, str, str]], days_ago: int) -> PurchaseOrder:
            po_number = f"PO-DEMO-{supplier.id}-{(now - timedelta(days=days_ago)).strftime('%Y%m%d%H%M%S')}"
            existing = db.query(PurchaseOrder).filter(PurchaseOrder.tenant_id == tenant.id, PurchaseOrder.po_number == po_number).first()
            if existing:
                return existing

            order_date = now - timedelta(days=days_ago)
            expected = order_date + timedelta(days=7)
            total = Decimal('0')
            for _, qty, price in lines:
                total += Decimal(qty) * Decimal(price)

            po = PurchaseOrder(
                tenant_id=tenant.id,
                po_number=po_number,
                supplier_id=supplier.id,
                status='posted',
                order_date=order_date,
                expected_date=expected,
                total_amount=total.quantize(Decimal('0.01')),
                created_by=user.id,
            )
            db.add(po)
            db.flush()

            for idx, (it, qty, price) in enumerate(lines, start=1):
                q = Decimal(qty)
                p = Decimal(price)
                line_total = (q * p).quantize(Decimal('0.01'))
                pol = PurchaseOrderLine(
                    tenant_id=tenant.id,
                    po_id=po.id,
                    item_id=it.id,
                    qty=q,
                    qty_received=Decimal("0"),
                    unit_price=p,
                    total=line_total,
                    created_by=user.id,
                )
                db.add(pol)

            return po

        pos: list[PurchaseOrder] = []
        pos.append(create_po(feed_sup, [(maize, '5000', '34.50'), (soya, '2000', '84.00'), (rice_bran, '1500', '27.50')], 12))
        pos.append(create_po(feed_sup, [(maize, '8000', '35.00'), (soya, '2500', '86.00')], 6))
        pos.append(create_po(flour_sup, [(wheat_grain, '12000', '29.80')], 10))
        pos.append(create_po(flour_sup, [(wheat_grain, '18000', '30.20')], 3))
        pos.append(create_po(fuel_sup, [(diesel, '4000', '94.50'), (octane, '2500', '109.50')], 8))
        pos.append(create_po(fuel_sup, [(oil, '300', '380.00')], 4))

        db.flush()

        # Post GRNs for first and fifth PO (inventory integration)
        def post_grn_from_po(po: PurchaseOrder):
            existing = db.query(GoodsReceipt).filter(GoodsReceipt.tenant_id == tenant.id, GoodsReceipt.ref_po_id == po.id).first()
            if existing:
                return
            grn_number = f"GRN-DEMO-{po.id}-{now.strftime('%Y%m%d%H%M%S')}"
            grn = GoodsReceipt(
                tenant_id=tenant.id,
                grn_number=grn_number,
                supplier_id=po.supplier_id,
                warehouse_id=wh.id,
                ref_po_id=po.id,
                status='posted',
                receipt_date=now - timedelta(days=1),
                created_by=user.id,
            )
            db.add(grn)
            db.flush()

            po_lines = db.query(PurchaseOrderLine).filter(PurchaseOrderLine.tenant_id == tenant.id, PurchaseOrderLine.po_id == po.id).all()
            for l in po_lines:
                qty = Decimal(str(l.qty))
                unit_cost = Decimal(str(l.unit_price))
                total = (qty * unit_cost).quantize(Decimal('0.01'))
                grnl = GoodsReceiptLine(
                    tenant_id=tenant.id,
                    grn_id=grn.id,
                    item_id=l.item_id,
                    qty=qty,
                    unit_cost=unit_cost,
                    total=total,
                    batch_no=None,
                    created_by=user.id,
                )
                db.add(grnl)

                StockService.create_stock_move(
                    db=db,
                    tenant_id=tenant.id,
                    item_id=l.item_id,
                    warehouse_id=wh.id,
                    qty_in=qty,
                    qty_out=Decimal('0'),
                    unit_cost=unit_cost,
                    txn_type='receipt',
                    ref_type='grn',
                    ref_id=grn.id,
                    txn_date=grn.receipt_date,
                    batch_no=None,
                    notes=f"GRN {grn_number}",
                    created_by=user.id,
                )
                l.qty_received = qty

        post_grn_from_po(pos[0])
        post_grn_from_po(pos[4])

        db.commit()
        print('[SUCCESS] Seeded purchase demo data')
        print(f'  - suppliers: {db.query(Supplier).filter(Supplier.tenant_id==tenant.id).count()}')
        print(f'  - purchase_orders: {db.query(PurchaseOrder).filter(PurchaseOrder.tenant_id==tenant.id).count()}')
        print(f'  - grns: {db.query(GoodsReceipt).filter(GoodsReceipt.tenant_id==tenant.id).count()}')

    finally:
        db.close()


if __name__ == '__main__':
    seed_purchase_demo()
