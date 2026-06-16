"""Seed demo suppliers with opening balance + ledger entries.

Notes:
- Supplier model currently supports: name, phone, email, address, gstin.
- Payment method/terms are stored inside address text for now.
- Opening balances are posted as balanced Journal Entries:
    Dr Equity
    Cr Accounts Payable
  with ref_type='supplier_opening' and ref_id=<supplier_id>.

Tenant: localhost

Run:
  python scripts/seed_suppliers_opening_demo.py

Optional:
  Set TENANT_DOMAIN env var (default: localhost)
"""

import os
import sys
from datetime import datetime
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Ensure catalog models are loaded before procurement relationships to Item
from app.modules.catalog.models import Item  # noqa: F401
# Ensure inventory models are loaded for procurement relationships to Warehouse
from app.modules.inventory.models import Warehouse  # noqa: F401

from app.db.session import SessionLocal
from app.modules.tenancy.models import Tenant, User
from app.modules.procurement.models import Supplier
from app.modules.accounting.posting_service import PostingService


def seed_suppliers_opening_demo():
    db = SessionLocal()
    try:
        domain = os.environ.get("TENANT_DOMAIN") or "localhost"
        tenant = db.query(Tenant).filter(Tenant.domain == domain).first()
        if not tenant:
            raise RuntimeError(f"Tenant '{domain}' not found. Run scripts/seed.py first.")

        user = db.query(User).filter(User.tenant_id == tenant.id).order_by(User.id.asc()).first()
        if not user:
            raise RuntimeError('No user found for tenant. Run scripts/seed.py first.')

        ap = PostingService.get_account_by_name(db, tenant.id, 'Accounts Payable')
        eq = PostingService.get_account_by_name(db, tenant.id, 'Equity') or PostingService.get_account_by_name(db, tenant.id, 'Retained Earnings')
        if not ap or not eq:
            raise RuntimeError('Required accounts not found (Accounts Payable / Equity). Run scripts/seed.py first.')

        demo = [
            {
                'name': 'Agro Feed Traders',
                'phone': '+880-1700-000001',
                'email': 'accounts@agrofeedtraders.demo',
                'gstin': 'GSTIN-DEMO-FEED-001',
                'payment': 'Bank Transfer',
                'terms': 'Net 15',
                'opening': '250000.00',
            },
            {
                'name': 'Wheat Grain Suppliers Co.',
                'phone': '+880-1700-000002',
                'email': 'billing@wheatgrain.demo',
                'gstin': 'GSTIN-DEMO-FLOUR-001',
                'payment': 'Bank Transfer',
                'terms': 'Net 30',
                'opening': '420000.00',
            },
            {
                'name': 'National Fuel Distributors',
                'phone': '+880-1700-000003',
                'email': 'finance@fuel.demo',
                'gstin': 'GSTIN-DEMO-FUEL-001',
                'payment': 'Cash/Bank',
                'terms': 'Net 7',
                'opening': '180000.00',
            },
            {
                'name': 'Packaging Materials Ltd.',
                'phone': '+880-1700-000004',
                'email': 'sales@packaging.demo',
                'gstin': 'GSTIN-DEMO-PKG-001',
                'payment': 'Bank Transfer',
                'terms': 'Net 30',
                'opening': '95000.00',
            },
        ]

        created_suppliers = 0
        created_opening_entries = 0

        for s in demo:
            supplier = db.query(Supplier).filter(Supplier.tenant_id == tenant.id, Supplier.name == s['name']).first()
            if not supplier:
                supplier = Supplier(
                    tenant_id=tenant.id,
                    name=s['name'],
                    phone=s.get('phone'),
                    email=s.get('email'),
                    gstin=s.get('gstin'),
                    address=(
                        f"Payment method: {s.get('payment')}\n"
                        f"Payment terms: {s.get('terms')}\n"
                        f"Contact: {s.get('email')} / {s.get('phone')}\n"
                        "Address: Demo supplier (sample data)"
                    ),
                    is_active=True,
                    created_by=user.id,
                )
                db.add(supplier)
                db.flush()
                created_suppliers += 1

            opening = Decimal(s['opening'])
            if opening <= 0:
                continue

            # Avoid duplicates: one opening JE per supplier
            from app.modules.accounting.models import JournalEntry

            existing = db.query(JournalEntry).filter(
                JournalEntry.tenant_id == tenant.id,
                JournalEntry.ref_type == 'supplier_opening',
                JournalEntry.ref_id == supplier.id,
            ).first()
            if existing:
                continue

            PostingService.create_journal_entry(
                db=db,
                tenant_id=tenant.id,
                date=datetime.utcnow(),
                memo=f"Supplier opening balance: {supplier.name}",
                lines=[
                    {
                        'account_id': eq.id,
                        'debit': float(opening),
                        'credit': 0,
                        'memo': 'Opening balance (Equity)',
                    },
                    {
                        'account_id': ap.id,
                        'debit': 0,
                        'credit': float(opening),
                        'memo': f"Opening AP for supplier {supplier.name}",
                    },
                ],
                ref_type='supplier_opening',
                ref_id=supplier.id,
                posted_by=user.id,
                entry_number=f"JE-SUP-OPEN-{supplier.id}-{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}",
            )
            created_opening_entries += 1

        print('[SUCCESS] Seeded demo suppliers + opening balances')
        print(f'  - suppliers created: {created_suppliers}')
        print(f'  - opening ledger entries created: {created_opening_entries}')

    finally:
        db.close()


if __name__ == '__main__':
    seed_suppliers_opening_demo()
