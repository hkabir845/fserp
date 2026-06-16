"""Seed demo warehouses for ERP modules.

Creates warehouses for:
- Feed mill
- Flour mill
- Packaging
- Fuel station

Idempotent by warehouse name (per tenant).
Tenant: localhost (default)

Run:
  python scripts/seed_warehouses_demo.py

Optional:
  Set TENANT_DOMAIN env var (default: localhost)
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import SessionLocal
from app.modules.tenancy.models import Tenant, User
# Ensure catalog models are loaded before inventory models (mapper relationships)
from app.modules.catalog.models import Item  # noqa: F401
from app.modules.inventory.models import Warehouse


def seed_warehouses_demo(domain: str | None = None):
    db = SessionLocal()
    try:
        domain = domain or os.environ.get("TENANT_DOMAIN") or "localhost"
        tenant = db.query(Tenant).filter(Tenant.domain == domain).first()
        if not tenant:
            raise RuntimeError(f"Tenant '{domain}' not found. Run scripts/seed.py first.")

        user = db.query(User).filter(User.tenant_id == tenant.id).order_by(User.id.asc()).first()
        if not user:
            raise RuntimeError('No user found for tenant. Run scripts/seed.py first.')

        names = [
            ('Feed Mill - Raw Material Store', 'Feed mill raw material storage'),
            ('Feed Mill - Finished Goods Store', 'Feed mill finished goods'),
            ('Feed Mill - Packaging Store', 'Bags, labels, packaging materials'),
            ('Flour Mill - Wheat Silo / Raw Store', 'Flour mill raw wheat storage'),
            ('Flour Mill - Finished Goods Store', 'Atta/Maida/Suji packing'),
            ('Fuel Station - Tank Farm', 'Diesel/Octane bulk storage'),
            ('Fuel Station - Lubes Store', 'Engine oils & lubes'),
        ]

        created = 0
        for name, addr in names:
            existing = db.query(Warehouse).filter(Warehouse.tenant_id == tenant.id, Warehouse.name == name).first()
            if existing:
                continue
            w = Warehouse(
                tenant_id=tenant.id,
                name=name,
                address=addr,
                is_active=True,
                created_by=user.id,
            )
            db.add(w)
            created += 1

        db.commit()
        print('[SUCCESS] Seeded demo warehouses')
        print(f'  - created: {created}')

    finally:
        db.close()


if __name__ == '__main__':
    seed_warehouses_demo()
