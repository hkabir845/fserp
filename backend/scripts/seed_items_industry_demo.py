"""Seed sample Items for Feed Mill + Flour Mill + Fuel Station.

Creates tenant-scoped Items (localhost) with realistic SKUs, UOMs and types.
Idempotent by SKU (won't duplicate existing items).

Run:
  python scripts/seed_items_industry_demo.py

Optional:
  Set TENANT_DOMAIN env var (default: localhost)
"""

import os
import sys
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import SessionLocal
from app.modules.tenancy.models import Tenant, User
from app.modules.catalog.models import Item, UOM


def seed_items_industry_demo(domain: str | None = None):
    db = SessionLocal()
    try:
        domain = domain or os.environ.get("TENANT_DOMAIN") or "localhost"
        tenant = db.query(Tenant).filter(Tenant.domain == domain).first()
        if not tenant:
            raise RuntimeError(f"Tenant '{domain}' not found. Run scripts/seed.py first.")

        user = db.query(User).filter(User.tenant_id == tenant.id).order_by(User.id.asc()).first()
        if not user:
            raise RuntimeError('No user found for tenant. Run scripts/seed.py first.')

        # UOM mapping (pick first id for each code)
        def uom_id(code: str) -> int:
            u = db.query(UOM).filter(UOM.tenant_id == tenant.id, UOM.code == code).order_by(UOM.id.asc()).first()
            if not u:
                raise RuntimeError(f"UOM {code} not found. Run scripts/seed.py / platform settings seed.")
            return u.id

        UOM_KG = uom_id('KG')
        UOM_L = uom_id('L')
        UOM_NOS = uom_id('NOS')
        # Some tenants only have KG/MT/L/NOS seeded; use NOS as fallback for packaging units.
        UOM_BAG = db.query(UOM).filter(UOM.tenant_id == tenant.id, UOM.code == 'BAG').order_by(UOM.id.asc()).first()
        UOM_BAG = UOM_BAG.id if UOM_BAG else UOM_NOS

        def ensure_item(*, sku: str, name: str, type_: str, uom: int, cost: str | None = None, tracked: bool = True):
            existing = db.query(Item).filter(Item.tenant_id == tenant.id, Item.sku == sku).first()
            if existing:
                return False
            it = Item(
                tenant_id=tenant.id,
                sku=sku,
                name=name,
                type=type_,
                uom_id=uom,
                is_stock_tracked=tracked,
                is_active=True,
                standard_cost=Decimal(cost) if cost is not None else None,
                created_by=user.id,
            )
            db.add(it)
            return True

        created = 0

        # =========================
        # Feed Mill (Raw Materials)
        # =========================
        feed_rm = [
            ('FM-RM-001', 'Maize (Yellow Corn)', 'raw_material', UOM_KG, '35.50'),
            ('FM-RM-002', 'Soybean Meal (48%)', 'raw_material', UOM_KG, '85.00'),
            ('FM-RM-003', 'Rice Bran', 'raw_material', UOM_KG, '28.00'),
            ('FM-RM-004', 'Wheat Bran', 'raw_material', UOM_KG, '32.00'),
            ('FM-RM-005', 'Fish Meal (60%)', 'raw_material', UOM_KG, '120.00'),
            ('FM-RM-006', 'Sunflower Meal', 'raw_material', UOM_KG, '45.00'),
            ('FM-RM-007', 'Mustard Oil Cake', 'raw_material', UOM_KG, '55.00'),
            ('FM-RM-008', 'Broken Rice', 'raw_material', UOM_KG, '42.00'),
            ('FM-RM-009', 'Wheat Flour (Binder)', 'raw_material', UOM_KG, '38.00'),
            ('FM-RM-010', 'Fish Oil', 'raw_material', UOM_L, '160.00'),
            ('FM-RM-011', 'Salt (NaCl)', 'raw_material', UOM_KG, '12.00'),
            ('FM-RM-012', 'Limestone Powder', 'raw_material', UOM_KG, '8.00'),
            ('FM-RM-013', 'DCP (Di-Calcium Phosphate)', 'raw_material', UOM_KG, '65.00'),
            ('FM-RM-014', 'Vitamin-Mineral Premix (Fish)', 'raw_material', UOM_KG, '250.00'),
            ('FM-RM-015', 'Vitamin-Mineral Premix (Poultry)', 'raw_material', UOM_KG, '220.00'),
            ('FM-RM-016', 'L-Lysine', 'raw_material', UOM_KG, '300.00'),
            ('FM-RM-017', 'DL-Methionine', 'raw_material', UOM_KG, '450.00'),
            ('FM-RM-018', 'Choline Chloride', 'raw_material', UOM_KG, '180.00'),
            ('FM-RM-019', 'Toxin Binder', 'raw_material', UOM_KG, '95.00'),
            ('FM-RM-020', 'Anti-fungal (Propionic Acid)', 'raw_material', UOM_L, '110.00'),
        ]

        # Feed Mill (Packaging)
        feed_pkg = [
            ('FM-PKG-025', 'Empty Bag 25kg (PP)', 'raw_material', UOM_BAG, '6.00'),
            ('FM-PKG-050', 'Empty Bag 50kg (PP)', 'raw_material', UOM_BAG, '8.50'),
            ('FM-PKG-LBL', 'Label / Sticker', 'raw_material', UOM_NOS, '0.20'),
        ]

        # Feed Mill (Finished Goods)
        feed_fg = [
            ('FM-FG-FISH-STR', 'Fish Feed Starter 35% (Pellet)', 'finished_good', UOM_KG, '55.00'),
            ('FM-FG-FISH-GRW', 'Fish Feed Grower 28% (Pellet)', 'finished_good', UOM_KG, '48.00'),
            ('FM-FG-PLT-STR', 'Poultry Starter Feed', 'finished_good', UOM_KG, '44.00'),
            ('FM-FG-PLT-GRW', 'Poultry Grower Feed', 'finished_good', UOM_KG, '42.00'),
            ('FM-FG-CAT-MIX', 'Cattle Concentrate Mix', 'finished_good', UOM_KG, '36.00'),
        ]

        # =========================
        # Flour Mill
        # =========================
        flour = [
            ('FL-RM-001', 'Wheat Grain', 'raw_material', UOM_KG, '30.00'),
            ('FL-RM-002', 'Fortification Premix (Iron/Folic)', 'raw_material', UOM_KG, '500.00'),
            ('FL-FG-ATTA', 'Wheat Flour (Atta)', 'finished_good', UOM_KG, '38.00'),
            ('FL-FG-MAIDA', 'Refined Wheat Flour (Maida)', 'finished_good', UOM_KG, '42.00'),
            ('FL-FG-SUJI', 'Semolina (Suji)', 'finished_good', UOM_KG, '44.00'),
            ('FL-FG-BRAN', 'Wheat Bran (By-product)', 'finished_good', UOM_KG, '18.00'),
            ('FL-PKG-005', 'Flour Bag 5kg', 'raw_material', UOM_BAG, '4.00'),
            ('FL-PKG-010', 'Flour Bag 10kg', 'raw_material', UOM_BAG, '5.50'),
            ('FL-PKG-025', 'Flour Bag 25kg', 'raw_material', UOM_BAG, '7.00'),
        ]

        # =========================
        # Fuel Station
        # =========================
        fuel = [
            ('FS-FUEL-DIESEL', 'Diesel', 'fuel', UOM_L, '95.00'),
            ('FS-FUEL-OCTANE', 'Petrol (Octane)', 'fuel', UOM_L, '110.00'),
            ('FS-OIL-20W50-1L', 'Engine Oil 20W-50 (1L)', 'fuel', UOM_L, '390.00'),
            ('FS-OIL-5W30-1L', 'Engine Oil 5W-30 (1L)', 'fuel', UOM_L, '520.00'),
            ('FS-OIL-ATF-1L', 'ATF Transmission Oil (1L)', 'fuel', UOM_L, '480.00'),
            ('FS-GREASE-500G', 'Grease (500g)', 'fuel', UOM_NOS, '160.00'),
        ]

        for sku, name, t, u, c in feed_rm + feed_pkg + feed_fg + flour + fuel:
            if ensure_item(sku=sku, name=name, type_=t, uom=u, cost=c, tracked=True):
                created += 1

        db.commit()
        print('[SUCCESS] Seeded industry sample items')
        print(f'  - created: {created}')

    finally:
        db.close()


if __name__ == '__main__':
    seed_items_industry_demo()
