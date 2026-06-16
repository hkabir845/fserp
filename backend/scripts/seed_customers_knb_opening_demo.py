"""Seed KNB Feed Industries customers with opening balances + accounting ledger entries.

Tenant: knbgroup.com.bd

What it does:
- Creates demo customers (idempotent by name per tenant)
- Stores contact/payment notes in address field (schema is simple)
- Posts opening balances into accounting as balanced Journal Entries:
    Dr Accounts Receivable
    Cr Retained Earnings (or Equity fallback)
  with ref_type='customer_opening' and ref_id=<customer_id>

Run:
  python scripts/seed_customers_knb_opening_demo.py
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


def seed_customers_knb_opening_demo() -> None:
    db = SessionLocal()
    try:
        tenant = db.query(Tenant).filter(Tenant.domain == 'knbgroup.com.bd').first()
        if not tenant:
            raise RuntimeError("Tenant 'knbgroup.com.bd' not found. Create it first.")

        user = db.query(User).filter(User.tenant_id == tenant.id).order_by(User.id.asc()).first()
        if not user:
            raise RuntimeError('No user found for tenant. Create a tenant admin first.')

        ar = PostingService.get_account_by_name(db, tenant.id, 'Accounts Receivable')
        eq = PostingService.get_account_by_name(db, tenant.id, 'Retained Earnings') or PostingService.get_account_by_name(db, tenant.id, 'Equity')
        if not ar or not eq:
            raise RuntimeError('Required accounts not found (Accounts Receivable / Retained Earnings). Run scripts/seed.py for that tenant.')

        demo = [
            {
                'name': 'KNB Dealer - Dhaka Central',
                'phone': '+880-1711-000101',
                'email': 'dhaka.central@knbdealers.demo',
                'gstin': None,
                'payment': 'Bank Transfer',
                'terms': 'Net 15',
                'address': 'Dhaka, Bangladesh',
                'opening': '650000.00',
            },
            {
                'name': 'KNB Dealer - Gazipur',
                'phone': '+880-1711-000102',
                'email': 'gazipur@knbdealers.demo',
                'gstin': None,
                'payment': 'Cash/Bank',
                'terms': 'Net 7',
                'address': 'Gazipur, Bangladesh',
                'opening': '280000.00',
            },
            {
                'name': 'KNB Corporate - Poultry Farm Group',
                'phone': '+880-1711-000103',
                'email': 'ap@poultryfarmgroup.demo',
                'gstin': None,
                'payment': 'Bank Transfer',
                'terms': 'Net 30',
                'address': 'Narayanganj, Bangladesh',
                'opening': '920000.00',
            },
            {
                'name': 'KNB Retailer - Mymensingh Feed Mart',
                'phone': '+880-1711-000104',
                'email': 'mymensingh@feedmart.demo',
                'gstin': None,
                'payment': 'Cash',
                'terms': 'Due on receipt',
                'address': 'Mymensingh, Bangladesh',
                'opening': '95000.00',
            },
            {
                'name': 'KNB Dealer - Chattogram',
                'phone': '+880-1711-000105',
                'email': 'ctg@knbdealers.demo',
                'gstin': None,
                'payment': 'Bank Transfer',
                'terms': 'Net 15',
                'address': 'Chattogram, Bangladesh',
                'opening': '410000.00',
            },
        ]

        created_customers = 0
        created_opening_entries = 0

        # Import here to avoid mapper init issues
        from app.modules.accounting.models import JournalEntry

        for c in demo:
            cust = db.query(Customer).filter(Customer.tenant_id == tenant.id, Customer.name == c['name']).first()
            if not cust:
                cust = Customer(
                    tenant_id=tenant.id,
                    name=c['name'],
                    phone=c.get('phone'),
                    email=c.get('email'),
                    gstin=c.get('gstin'),
                    address=(
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

        print('[SUCCESS] Seeded KNB customers + opening balances')
        print(f'  - tenant: {tenant.domain} (id={tenant.id})')
        print(f'  - customers created: {created_customers}')
        print(f'  - opening ledger entries created: {created_opening_entries}')

    finally:
        db.close()


if __name__ == '__main__':
    seed_customers_knb_opening_demo()
