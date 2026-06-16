"""Seed Feed Manufacturer industry customers with opening balances + accounting ledger entries.

Tenant: localhost

Creates demo customers typical for feed manufacturers:
- Dealers / Distributors
- Corporate farms
- Retail feed marts

Also posts opening balances into accounting ledger (double-entry):
  Dr Accounts Receivable
  Cr Retained Earnings (or Equity fallback)

Idempotent:
- Customers by name per tenant
- One opening JE per customer (ref_type='customer_opening', ref_id=<customer_id>)

Run:
  python scripts/seed_customers_feed_opening_demo.py

Optional:
  Set TENANT_DOMAIN env var (default: localhost)
"""

import os
import sys
from datetime import datetime
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Ensure models with relationships are loaded
from app.modules.catalog.models import Item  # noqa: F401
from app.modules.inventory.models import Warehouse  # noqa: F401

from app.db.session import SessionLocal
from app.modules.tenancy.models import Tenant, User
from app.modules.sales.models import Customer
from app.modules.accounting.posting_service import PostingService


def seed_customers_feed_opening_demo() -> None:
    db = SessionLocal()
    try:
        domain = os.environ.get("TENANT_DOMAIN") or "localhost"
        tenant = db.query(Tenant).filter(Tenant.domain == domain).first()
        if not tenant:
            raise RuntimeError(f"Tenant '{domain}' not found. Run scripts/seed.py first.")

        user = db.query(User).filter(User.tenant_id == tenant.id).order_by(User.id.asc()).first()
        if not user:
            raise RuntimeError('No user found for tenant. Run scripts/seed.py first.')

        ar = PostingService.get_account_by_name(db, tenant.id, 'Accounts Receivable')
        eq = PostingService.get_account_by_name(db, tenant.id, 'Retained Earnings') or PostingService.get_account_by_name(db, tenant.id, 'Equity')
        if not ar or not eq:
            raise RuntimeError('Required accounts not found (Accounts Receivable / Retained Earnings). Run scripts/seed.py first.')

        demo = [
            {
                'name': 'ABC Feed Dealer - City Center',
                'phone': '+880-1600-000201',
                'email': 'accounts@abcdealer.demo',
                'tax_id': 'VAT-DEMO-001',
                'payment': 'Bank Transfer',
                'terms': 'Net 15',
                'address': 'Main Road, City Center',
                'opening': '320000.00',
            },
            {
                'name': 'Sunrise Poultry Farm',
                'phone': '+880-1600-000202',
                'email': 'ap@sunrisepoultry.demo',
                'tax_id': 'VAT-DEMO-002',
                'payment': 'Bank Transfer',
                'terms': 'Net 30',
                'address': 'Industrial Area, Gazipur',
                'opening': '780000.00',
            },
            {
                'name': 'Green Valley Dairy & Cattle',
                'phone': '+880-1600-000203',
                'email': 'procurement@greenvalley.demo',
                'tax_id': None,
                'payment': 'Cash/Bank',
                'terms': 'Net 7',
                'address': 'North District',
                'opening': '145000.00',
            },
            {
                'name': 'Retail Feed Mart - Mymensingh',
                'phone': '+880-1600-000204',
                'email': 'owner@feedmart.demo',
                'tax_id': None,
                'payment': 'Cash',
                'terms': 'Due on receipt',
                'address': 'Bazar Road, Mymensingh',
                'opening': '65000.00',
            },
            {
                'name': 'Wholesale Distributor - Chattogram',
                'phone': '+880-1600-000205',
                'email': 'billing@wholesalectg.demo',
                'tax_id': 'VAT-DEMO-003',
                'payment': 'Bank Transfer',
                'terms': 'Net 15',
                'address': 'Port Area, Chattogram',
                'opening': '410000.00',
            },
        ]

        created_customers = 0
        created_opening_entries = 0

        from app.modules.accounting.models import JournalEntry

        for c in demo:
            cust = db.query(Customer).filter(Customer.tenant_id == tenant.id, Customer.name == c['name']).first()
            if not cust:
                cust = Customer(
                    tenant_id=tenant.id,
                    name=c['name'],
                    phone=c.get('phone'),
                    email=c.get('email'),
                    gstin=c.get('tax_id'),
                    address=(
                        "Customer Type: Feed Industry\n"
                        f"Address: {c.get('address')}\n"
                        f"Payment method: {c.get('payment')}\n"
                        f"Payment terms: {c.get('terms')}\n"
                        f"Contact: {c.get('email')} / {c.get('phone')}"
                    ),
                    is_active=True,
                    created_by=user.id,
                )
                db.add(cust)
                db.flush()
                created_customers += 1

            opening = Decimal(c['opening'])
            if opening <= 0:
                continue

            existing_je = db.query(JournalEntry).filter(
                JournalEntry.tenant_id == tenant.id,
                JournalEntry.ref_type == 'customer_opening',
                JournalEntry.ref_id == cust.id,
            ).first()
            if existing_je:
                continue

            PostingService.create_journal_entry(
                db=db,
                tenant_id=tenant.id,
                date=datetime.utcnow(),
                memo=f"Customer opening balance: {cust.name}",
                lines=[
                    {
                        'account_id': ar.id,
                        'debit': float(opening),
                        'credit': 0,
                        'memo': f"Opening AR for customer {cust.name}",
                    },
                    {
                        'account_id': eq.id,
                        'debit': 0,
                        'credit': float(opening),
                        'memo': 'Opening balance (Equity)',
                    },
                ],
                ref_type='customer_opening',
                ref_id=cust.id,
                posted_by=user.id,
                entry_number=f"JE-CUS-OPEN-{cust.id}-{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}",
            )
            created_opening_entries += 1

        print('[SUCCESS] Seeded feed industry customers + opening balances')
        print(f'  - tenant: {tenant.domain} (id={tenant.id})')
        print(f'  - customers created: {created_customers}')
        print(f'  - opening ledger entries created: {created_opening_entries}')

    finally:
        db.close()


if __name__ == '__main__':
    seed_customers_feed_opening_demo()
