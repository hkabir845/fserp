"""
Merge duplicate catalog rows named "Diesel" (type=fuel) into one per tenant.
Canonical SKU: FS-FUEL-DIESEL.

  cd backend
  python scripts/dedupe_diesel_items.py
  python scripts/dedupe_diesel_items.py --domain localhost
"""
from __future__ import annotations

import argparse
import os
import sys
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.modules.catalog.models import Item
from app.modules.tenancy.models import Tenant
from app.modules.inventory.models import StockBalance

CANONICAL_SKU = "FS-FUEL-DIESEL"
FUEL_TYPE = "fuel"
DIESEL_LOWER = "diesel"

# (table, column) — only where FK points to items.id; unknown tables are skipped per statement
ITEM_FK_UPDATES: list[tuple[str, str]] = [
    ("fuel_tanks", "fuel_item_id"),
    ("fuel_txns", "fuel_item_id"),
    ("vehicle_fuel_issues", "fuel_item_id"),
    ("purchase_order_lines", "item_id"),
    ("goods_receipt_lines", "item_id"),
    ("vendor_bill_lines", "item_id"),
    ("inventory_lots", "item_id"),
    ("stock_ledger", "item_id"),
    ("stock_balances", "item_id"),
    ("sales_invoice_lines", "item_id"),
    ("boms", "output_item_id"),
    ("bom_lines", "input_item_id"),
    ("production_consumptions", "item_id"),
    ("manufacturing_production_outputs", "item_id"),
    ("scraps", "item_id"),
    ("silos", "item_id"),
    ("lab_specifications", "ingredient_item_id"),
    ("lab_samples", "item_id"),
    ("production_outputs", "finished_item_id"),
    ("packing_operations", "bag_item_id"),
    ("pre_formulation_lines", "ingredient_item_id"),
]


def _merge_stock_balances(db: Session, tenant_id: int, from_id: int, to_id: int) -> None:
    dup_rows = (
        db.query(StockBalance)
        .filter(StockBalance.tenant_id == tenant_id, StockBalance.item_id == from_id)
        .all()
    )
    for row in dup_rows:
        wh = row.warehouse_id
        lot = row.lot_id
        existing = (
            db.query(StockBalance)
            .filter(
                StockBalance.tenant_id == tenant_id,
                StockBalance.item_id == to_id,
                StockBalance.warehouse_id == wh,
                StockBalance.lot_id == lot,
            )
            .first()
        )
        if existing:
            existing.qty_kg = Decimal(str(existing.qty_kg or 0)) + Decimal(str(row.qty_kg or 0))
            db.delete(row)
        else:
            row.item_id = to_id
    db.flush()


def _safe_update(db: Session, tenant_id: int, table: str, col: str, from_id: int, to_id: int) -> None:
    sql = text(
        f"UPDATE {table} SET {col} = :to_id WHERE tenant_id = :tid AND {col} = :from_id"
    )
    try:
        db.execute(sql, {"to_id": to_id, "tid": tenant_id, "from_id": from_id})
    except Exception as exc:  # noqa: BLE001
        print(f"  [skip] {table}.{col}: {exc}")


def _fix_feed_unique(db: Session, tenant_id: int, from_id: int, to_id: int) -> None:
    for table in ("feed_products", "ingredients"):
        try:
            row_from = db.execute(
                text(f"SELECT id FROM {table} WHERE tenant_id = :tid AND item_id = :iid LIMIT 1"),
                {"tid": tenant_id, "iid": from_id},
            ).fetchone()
            row_to = db.execute(
                text(f"SELECT id FROM {table} WHERE tenant_id = :tid AND item_id = :iid LIMIT 1"),
                {"tid": tenant_id, "iid": to_id},
            ).fetchone()
            if row_from:
                if row_to:
                    db.execute(
                        text(f"DELETE FROM {table} WHERE tenant_id = :tid AND item_id = :iid"),
                        {"tid": tenant_id, "iid": from_id},
                    )
                else:
                    db.execute(
                        text(
                            f"UPDATE {table} SET item_id = :to_id WHERE tenant_id = :tid AND item_id = :from_id"
                        ),
                        {"to_id": to_id, "tid": tenant_id, "from_id": from_id},
                    )
        except Exception as exc:  # noqa: BLE001
            print(f"  [skip] {table}: {exc}")


def dedupe_tenant(db: Session, tenant_id: int) -> int:
    items = (
        db.query(Item)
        .filter(Item.tenant_id == tenant_id, Item.type == FUEL_TYPE)
        .all()
    )
    diesel_items = [i for i in items if (i.name or "").strip().lower() == DIESEL_LOWER]
    if len(diesel_items) <= 1:
        return 0

    keeper = next((i for i in diesel_items if i.sku == CANONICAL_SKU), None)
    if not keeper:
        keeper = sorted(diesel_items, key=lambda x: x.id)[0]
        keeper.sku = CANONICAL_SKU
    keeper.name = "Diesel"
    db.flush()

    removed = 0
    for dup in diesel_items:
        if dup.id == keeper.id:
            continue
        _merge_stock_balances(db, tenant_id, dup.id, keeper.id)
        db.flush()
        for table, col in ITEM_FK_UPDATES:
            _safe_update(db, tenant_id, table, col, dup.id, keeper.id)
        db.flush()
        _fix_feed_unique(db, tenant_id, dup.id, keeper.id)
        db.flush()
        db.delete(dup)
        removed += 1

    return removed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--domain", default=None)
    args = parser.parse_args()

    db = SessionLocal()
    try:
        q = db.query(Tenant)
        if args.domain:
            q = q.filter(Tenant.domain == args.domain)
        tenants = q.all()
        total_removed = 0
        for t in tenants:
            n = dedupe_tenant(db, t.id)
            if n:
                print(f"Tenant {t.domain} (id={t.id}): removed {n} duplicate Diesel row(s); kept {CANONICAL_SKU}")
                total_removed += n
        db.commit()
        if total_removed == 0:
            print("No duplicate Diesel fuel items found (or only one per tenant).")
        else:
            print(f"Done. Duplicate Diesel rows merged: {total_removed}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
