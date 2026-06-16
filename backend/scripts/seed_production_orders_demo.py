"""Seed demo Production Orders + stock for factory workflow.

Creates:
- One warehouse (if missing)
- Ensures at least one approved Feed BOM
- 3 draft production orders with lines
- Stock balances for all required ingredient items (so Issue Materials works)
- Optional packaging item stock (so Pack works)

Tenant: localhost
"""

import os
import sys
from datetime import datetime
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.modules.tenancy.models import Tenant, User
from app.modules.inventory.models import Warehouse, StockBalance
from app.modules.catalog.models import Item, UOM
from app.modules.feed_manufacturing.models import FeedBom, FeedBomLine, BOMStatus, ProductionOrder, ProductionOrderLine, Ingredient


def _dec(v) -> Decimal:
    return Decimal(str(v))


def _compute_required_kg(line: FeedBomLine, batch_size_ton: Decimal, batch_size_kg: Decimal) -> Decimal:
    basis = (line.inclusion_basis or '').lower()
    val = _dec(line.inclusion_value or 0)

    if basis == 'percent':
        return (batch_size_kg * val / Decimal('100')).quantize(Decimal('0.001'))
    if basis == 'kg_per_ton':
        return (batch_size_ton * val).quantize(Decimal('0.001'))
    if basis == 'g_per_ton':
        return (batch_size_ton * (val / Decimal('1000'))).quantize(Decimal('0.001'))

    # fallback: treat as percent
    return (batch_size_kg * val / Decimal('100')).quantize(Decimal('0.001'))


def seed_production_orders_demo(domain: str | None = None) -> None:
    db: Session = SessionLocal()
    try:
        domain = domain or os.environ.get("TENANT_DOMAIN") or "localhost"
        tenant = db.query(Tenant).filter(Tenant.domain == domain).first()
        if not tenant:
            raise RuntimeError(f"Tenant '{domain}' not found. Run scripts/seed.py first.")

        admin = db.query(User).filter(User.tenant_id == tenant.id).order_by(User.id.asc()).first()
        if not admin:
            raise RuntimeError('No user found for tenant. Run scripts/seed.py first.')

        wh = db.query(Warehouse).filter(Warehouse.tenant_id == tenant.id, Warehouse.is_active == True).first()
        if not wh:
            wh = Warehouse(
                tenant_id=tenant.id,
                name='Main Store',
                address='Demo warehouse',
                is_active=True,
                created_by=admin.id,
            )
            db.add(wh)
            db.flush()

        # Ensure at least one approved BOM
        bom = db.query(FeedBom).filter(FeedBom.tenant_id == tenant.id).order_by(FeedBom.id.asc()).first()
        if not bom:
            raise RuntimeError('No Feed BOM found. Seed Feed BOMs first.')

        if str(bom.status).lower() != 'approved':
            bom.status = BOMStatus.APPROVED
            if not bom.effective_from:
                bom.effective_from = datetime.utcnow()

        bom_lines = db.query(FeedBomLine).filter(FeedBomLine.tenant_id == tenant.id, FeedBomLine.bom_id == bom.id).order_by(FeedBomLine.sequence.asc()).all()
        if not bom_lines:
            raise RuntimeError('Selected BOM has no lines. Add lines to the BOM first.')

        created_orders = 0
        created_lines = 0
        created_balances = 0

        for i in range(3):
            order_number = f"PO-DEMO-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{i+1}"
            batch_size_ton = Decimal('1.000')
            batch_size_kg = (batch_size_ton * Decimal('1000')).quantize(Decimal('0.001'))

            order = ProductionOrder(
                tenant_id=tenant.id,
                order_number=order_number,
                bom_id=bom.id,
                batch_size_ton=batch_size_ton,
                batch_size_kg=batch_size_kg,
                status='draft',
                planned_date=datetime.utcnow(),
                planned_output_kg=batch_size_kg,
                warehouse_id=wh.id,
                notes='Demo production order for factory workflow',
                created_by=admin.id,
            )
            db.add(order)
            db.flush()
            created_orders += 1

            for bl in bom_lines:
                req_kg = _compute_required_kg(bl, batch_size_ton, batch_size_kg)
                loss_pct = _dec(bl.loss_factor_pct or 0)
                req_with_loss = (req_kg * (Decimal('1') + (loss_pct / Decimal('100')))).quantize(Decimal('0.001'))

                pol = ProductionOrderLine(
                    tenant_id=tenant.id,
                    order_id=order.id,
                    ingredient_id=bl.ingredient_id,
                    bom_line_id=bl.id,
                    required_qty_kg=req_kg,
                    required_qty_with_loss_kg=req_with_loss,
                    created_by=admin.id,
                )
                db.add(pol)
                created_lines += 1

                # Create stock balance for ingredient item so Issue works
                ing = db.query(Ingredient).filter(Ingredient.tenant_id == tenant.id, Ingredient.id == bl.ingredient_id).first()
                if not ing:
                    continue
                item = db.query(Item).filter(Item.tenant_id == tenant.id, Item.id == ing.item_id).first()
                if not item:
                    continue

                bal = db.query(StockBalance).filter(
                    StockBalance.tenant_id == tenant.id,
                    StockBalance.item_id == item.id,
                    StockBalance.warehouse_id == wh.id,
                    StockBalance.lot_id == None,
                ).first()
                if not bal:
                    unit_cost = _dec(item.standard_cost or 10)
                    qty = (req_with_loss * Decimal('10')).quantize(Decimal('0.001'))
                    bal = StockBalance(
                        tenant_id=tenant.id,
                        item_id=item.id,
                        warehouse_id=wh.id,
                        lot_id=None,
                        qty_kg=qty,
                        unit_cost=unit_cost.quantize(Decimal('0.0001')),
                        total_cost=(qty * unit_cost).quantize(Decimal('0.0001')),
                        last_txn_date=datetime.utcnow(),
                        created_by=admin.id,
                    )
                    db.add(bal)
                    created_balances += 1

        # Add a simple packaging item + balance (optional)
        kg_uom = db.query(UOM).filter(UOM.tenant_id == tenant.id, UOM.code == 'KG').first()
        if not kg_uom:
            raise RuntimeError('KG UOM not found. Run scripts/seed.py first.')

        pkg = db.query(Item).filter(Item.tenant_id == tenant.id, Item.sku == 'PKG-BAG-50G').first()
        if not pkg:
            pkg = Item(
                tenant_id=tenant.id,
                sku='PKG-BAG-50G',
                name='Packaging Bag (50g)',
                type='raw_material',
                uom_id=kg_uom.id,
                is_stock_tracked=True,
                is_active=True,
                standard_cost=_dec('1.00'),
                created_by=admin.id,
            )
            db.add(pkg)
            db.flush()

        pkg_bal = db.query(StockBalance).filter(
            StockBalance.tenant_id == tenant.id,
            StockBalance.item_id == pkg.id,
            StockBalance.warehouse_id == wh.id,
            StockBalance.lot_id == None,
        ).first()
        if not pkg_bal:
            unit_cost = _dec(pkg.standard_cost or 1)
            qty = Decimal('50.000')  # 50kg of bags -> lots of packing
            pkg_bal = StockBalance(
                tenant_id=tenant.id,
                item_id=pkg.id,
                warehouse_id=wh.id,
                lot_id=None,
                qty_kg=qty,
                unit_cost=unit_cost.quantize(Decimal('0.0001')),
                total_cost=(qty * unit_cost).quantize(Decimal('0.0001')),
                last_txn_date=datetime.utcnow(),
                created_by=admin.id,
            )
            db.add(pkg_bal)
            created_balances += 1

        db.commit()
        print('[SUCCESS] Seeded production orders demo data')
        print(f'  - orders: {created_orders}')
        print(f'  - order lines: {created_lines}')
        print(f'  - stock balances: {created_balances}')
        print(f'  - warehouse: #{wh.id} {wh.name}')
        print(f'  - bom: #{bom.id} {bom.bom_code} ({bom.status})')

    finally:
        db.close()


if __name__ == '__main__':
    seed_production_orders_demo()
