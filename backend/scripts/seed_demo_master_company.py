"""One-click demo seed for the Master Company tenant (domain `master`).

This is a normal tenant row used for development and demos; the UI sends `X-Tenant-Domain: master`
like any other domain. Dummy/seed data for walkthroughs should target this tenant so production
tenants stay clean.

Creates a tenant with domain 'master' (if missing), creates a basic admin user,
then seeds sample data across modules so every screen has data.

Run:
  python scripts/seed_demo_master_company.py

Login suggestion (tenant = master):
  email: master-admin@fmerp.demo
  password: admin123
"""

import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import SessionLocal
from app.core.security import get_password_hash
from app.modules.tenancy.models import Tenant, User
from app.modules.catalog.models import UOM
from app.modules.accounting.models import Account


def ensure_master_tenant_and_user() -> tuple[Tenant, User]:
    db = SessionLocal()
    try:
        tenant = db.query(Tenant).filter(Tenant.domain == 'master').first()
        now = datetime.utcnow()
        if not tenant:
            tenant = Tenant(
                name='Master Company (Demo)',
                domain='master',
                is_active=True,
                created_at=now,
                updated_at=now,
            )
            db.add(tenant)
            db.flush()
            print('[OK] Created tenant: master')

        # Create a tenant admin for master tenant (for manual login)
        user = db.query(User).filter(User.tenant_id == tenant.id, User.email == 'master-admin@fmerp.demo').first()
        if not user:
            user = User(
                tenant_id=tenant.id,
                email='master-admin@fmerp.demo',
                hashed_password=get_password_hash('admin123'),
                full_name='Master Admin',
                is_active=True,
                created_at=now,
                updated_at=now,
            )
            db.add(user)
            db.flush()
            print('[OK] Created master admin user: master-admin@fmerp.demo')

        # Ensure baseline UOMs exist (KG/MT/L/NOS) for this tenant
        uoms = [
            ('KG', 'Kilogram'),
            ('MT', 'Metric Ton'),
            ('L', 'Liter'),
            ('NOS', 'Numbers'),
        ]
        for code, name in uoms:
            existing = db.query(UOM).filter(UOM.tenant_id == tenant.id, UOM.code == code).first()
            if existing:
                continue
            db.add(UOM(tenant_id=tenant.id, code=code, name=name, created_by=user.id))

        db.flush()

        # Ensure chart of accounts baseline exists (used by opening balance seeders)
        accounts = [
            ('1000', 'Cash', 'asset'),
            ('1100', 'Bank', 'asset'),
            ('1200', 'Inventory', 'asset'),
            ('1300', 'Accounts Receivable', 'asset'),
            ('2000', 'Accounts Payable', 'liability'),
            ('2010', 'Goods Received Not Invoiced', 'liability'),
            ('3000', 'Equity', 'equity'),
            ('3100', 'Retained Earnings', 'equity'),
            ('4000', 'Sales Revenue', 'income'),
            ('5000', 'Cost of Goods Sold', 'expense'),
            ('6000', 'Operating Expenses', 'expense'),
        ]
        for code, name, type_ in accounts:
            existing = db.query(Account).filter(Account.tenant_id == tenant.id, Account.code == code).first()
            if existing:
                continue
            db.add(Account(tenant_id=tenant.id, code=code, name=name, type=type_, is_active=True, created_by=user.id))

        db.commit()
        db.refresh(tenant)
        db.refresh(user)
        return tenant, user
    finally:
        db.close()


def main() -> None:
    print('\n=== FMERP Demo Seeder (MASTER Company) ===\n')

    tenant, _user = ensure_master_tenant_and_user()

    # Seed everything into the master tenant by setting TENANT_DOMAIN
    os.environ['TENANT_DOMAIN'] = 'master'

    # Baselines
    from scripts.seed_inventory_demo import seed_inventory_demo
    from scripts.seed_warehouses_demo import seed_warehouses_demo
    from scripts.seed_items_industry_demo import seed_items_industry_demo

    # Business master data + transactions
    from scripts.seed_suppliers_opening_demo import seed_suppliers_opening_demo
    from scripts.seed_customers_feed_opening_demo import seed_customers_feed_opening_demo
    from scripts.seed_purchase_demo import seed_purchase_demo
    from scripts.seed_sales_receipts_demo import seed_sales_receipts_demo

    # Manufacturing factory workflow
    from scripts.seed_demo_factory import main as seed_factory_main

    print('[1/6] Warehouses...')
    seed_warehouses_demo(domain='master')

    print('[2/6] Items (Feed/Flour/Fuel)...')
    seed_items_industry_demo(domain='master')

    print('[3/6] Inventory stock movements...')
    seed_inventory_demo(domain='master')

    print('[4/6] Suppliers + opening balances (ledger)...')
    seed_suppliers_opening_demo()

    print('[5/6] Customers + opening balances (ledger)...')
    seed_customers_feed_opening_demo()

    print('[6/6] Purchase + Manufacturing workflow...')
    # purchase demo
    seed_purchase_demo(domain='master')
    # factory workflow: inventory+feed mfg+production orders (all tenant aware now)
    seed_factory_main()
    # sales invoices + receipts (AR)
    seed_sales_receipts_demo(domain='master')

    print('\n[SUCCESS] Master Company demo data seeded.')
    print('Use tenant domain: master')
    print('Login: master-admin@fmerp.demo / admin123')


if __name__ == '__main__':
    main()
