"""
Seed demo inventory stock for localhost tenant.

Creates a few warehouses and posts stock ledger receipts so /api/v1/inventory/stock returns data.
Safe to run multiple times (idempotent-ish: it only adds missing master data and adds a new batch of receipts).
"""

import os
import sys
from datetime import datetime
from decimal import Decimal

# Add repo root (backend/) so we can import app.*
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import SessionLocal
from app.modules.tenancy.models import Tenant, User
from app.modules.catalog.models import UOM, Item
from app.modules.inventory.models import Warehouse
from app.modules.inventory.stock_service import StockService


def seed_inventory_demo(domain: str = "localhost") -> None:
    db = SessionLocal()
    try:
        tenant = db.query(Tenant).filter(Tenant.domain == domain).first()
        if not tenant:
            raise RuntimeError(
                f"Tenant not found for domain '{domain}'. Run backend/scripts/seed.py first."
            )

        admin = db.query(User).filter(User.tenant_id == tenant.id).order_by(User.id.asc()).first()
        if not admin:
            raise RuntimeError("No user found for tenant. Run backend/scripts/seed.py first.")

        # Ensure UOMs exist
        kg = db.query(UOM).filter(UOM.tenant_id == tenant.id, UOM.code == "KG").first()
        ltr = db.query(UOM).filter(UOM.tenant_id == tenant.id, UOM.code == "L").first()
        nos = db.query(UOM).filter(UOM.tenant_id == tenant.id, UOM.code == "NOS").first()
        if not kg or not ltr or not nos:
            raise RuntimeError("Missing UOMs (KG/L/NOS). Run backend/scripts/seed.py first.")

        # Warehouses
        warehouses_data = [
            {"name": "Main Warehouse", "address": "123 Main St"},
            {"name": "Finished Goods", "address": "123 Main St"},
        ]
        warehouses: dict[str, Warehouse] = {}
        for wh in warehouses_data:
            warehouse = (
                db.query(Warehouse)
                .filter(Warehouse.tenant_id == tenant.id, Warehouse.name == wh["name"])
                .first()
            )
            if not warehouse:
                warehouse = Warehouse(
                    tenant_id=tenant.id,
                    name=wh["name"],
                    address=wh["address"],
                    is_active=True,
                    created_by=admin.id,
                )
                db.add(warehouse)
                db.flush()
                print(f"[OK] Created warehouse: {warehouse.name}")
            warehouses[wh["name"]] = warehouse

        # Items (minimal set to make inventory meaningful)
        items_data = [
            {"sku": "RM-CORN-001", "name": "Corn Grain", "type": "raw_material", "uom": kg, "cost": Decimal("22.50")},
            {"sku": "RM-SOY-001", "name": "Soybean Meal", "type": "raw_material", "uom": kg, "cost": Decimal("48.00")},
            {"sku": "PKG-BAG-50KG", "name": "PP Bag 50kg", "type": "raw_material", "uom": nos, "cost": Decimal("12.00")},
            {"sku": "FG-FEED-001", "name": "Feed Pellets 2mm", "type": "finished_good", "uom": kg, "cost": Decimal("35.00")},
            {"sku": "FS-FUEL-DIESEL", "name": "Diesel", "type": "fuel", "uom": ltr, "cost": Decimal("88.00")},
        ]
        items: dict[str, Item] = {}
        for it in items_data:
            item = (
                db.query(Item)
                .filter(Item.tenant_id == tenant.id, Item.sku == it["sku"])
                .first()
            )
            if not item:
                item = Item(
                    tenant_id=tenant.id,
                    sku=it["sku"],
                    name=it["name"],
                    type=it["type"],
                    uom_id=it["uom"].id,
                    is_stock_tracked=True,
                    is_active=True,
                    standard_cost=it["cost"],
                    created_by=admin.id,
                )
                db.add(item)
                db.flush()
                print(f"[OK] Created item: {item.sku} - {item.name}")
            else:
                # Keep it simple: update standard cost if missing
                if item.standard_cost is None:
                    item.standard_cost = it["cost"]
                    db.flush()
            items[it["sku"]] = item

        db.commit()

        # Post a batch of receipts into stock ledger
        txn_date = datetime.utcnow()
        receipts = [
            # Raw materials into Main Warehouse
            (items["RM-CORN-001"], warehouses["Main Warehouse"], Decimal("5000"), Decimal("22.50"), "GRN-DEMO-001"),
            (items["RM-SOY-001"], warehouses["Main Warehouse"], Decimal("1500"), Decimal("48.00"), "GRN-DEMO-002"),
            (items["PKG-BAG-50KG"], warehouses["Main Warehouse"], Decimal("400"), Decimal("12.00"), "GRN-DEMO-003"),
            (items["FUEL-DIESEL"], warehouses["Main Warehouse"], Decimal("800"), Decimal("88.00"), "GRN-DEMO-004"),
            # Finished goods into Finished Goods warehouse
            (items["FG-FEED-001"], warehouses["Finished Goods"], Decimal("1200"), Decimal("35.00"), "PROD-DEMO-001"),
        ]

        for item, wh, qty, cost, ref_no in receipts:
            StockService.create_stock_move(
                db=db,
                tenant_id=tenant.id,
                item_id=item.id,
                warehouse_id=wh.id,
                qty_in=qty,
                qty_out=Decimal("0"),
                unit_cost=cost,
                txn_type="receipt" if ref_no.startswith("GRN") else "produce",
                ref_type="demo_seed",
                ref_id=None,
                txn_date=txn_date,
                batch_no=ref_no,
                notes=f"Demo seed: {ref_no}",
                created_by=admin.id,
            )

        print("\n[SUCCESS] Seeded demo inventory movements.")
        print("You should now see rows in GET /api/v1/inventory/stock (for tenant domain 'localhost').")

    finally:
        db.close()


if __name__ == "__main__":
    seed_inventory_demo()

