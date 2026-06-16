"""Seed demo Sales Invoices + Receipts (AR) for testing.

Creates:
- 3 Sales Invoices with 1-2 lines each (posts stock + accounting using same services)
- 4 Receipts (cash/bank), some linked to invoices

Tenant:
- By TENANT_DOMAIN env var (default: localhost)

Run:
  python scripts/seed_sales_receipts_demo.py

Recommended: run scripts/seed.py + inventory/items/customers seeders first.
"""

import os
import sys
from datetime import datetime, timedelta
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import SessionLocal
from app.modules.tenancy.models import Tenant, User
from app.modules.sales.models import Customer, SalesInvoice, SalesInvoiceLine, Receipt
from app.modules.catalog.models import Item
from app.modules.inventory.models import Warehouse
from app.modules.inventory.stock_service import StockService
from app.modules.accounting.posting_service import PostingService


def seed_sales_receipts_demo(domain: str | None = None) -> None:
    domain = domain or os.environ.get("TENANT_DOMAIN") or "localhost"
    db = SessionLocal()
    try:
        tenant = db.query(Tenant).filter(Tenant.domain == domain).first()
        if not tenant:
            raise RuntimeError(f"Tenant '{domain}' not found. Run scripts/seed.py first.")

        user = db.query(User).filter(User.tenant_id == tenant.id).order_by(User.id.asc()).first()
        if not user:
            raise RuntimeError("No user found for tenant. Run scripts/seed.py first.")

        wh = db.query(Warehouse).filter(Warehouse.tenant_id == tenant.id, Warehouse.is_active == True).order_by(Warehouse.id.asc()).first()
        if not wh:
            raise RuntimeError("No warehouse found. Seed warehouses first.")

        customers = (
            db.query(Customer)
            .filter(Customer.tenant_id == tenant.id, Customer.is_active == True)
            .order_by(Customer.id.asc())
            .limit(5)
            .all()
        )
        if not customers:
            raise RuntimeError("No customers found. Seed customers first.")

        # Pick stock-tracked items for invoice lines
        items = (
            db.query(Item)
            .filter(Item.tenant_id == tenant.id, Item.is_active == True, Item.is_stock_tracked == True)
            .order_by(Item.id.asc())
            .limit(10)
            .all()
        )
        if not items:
            raise RuntimeError("No items found. Seed items first.")

        # Accounts
        ar = PostingService.get_account_by_name(db, tenant.id, "Accounts Receivable")
        revenue = PostingService.get_account_by_name(db, tenant.id, "Sales Revenue")
        cogs = PostingService.get_account_by_name(db, tenant.id, "Cost of Goods Sold")
        inv = PostingService.get_account_by_name(db, tenant.id, "Inventory")
        cash = PostingService.get_account_by_name(db, tenant.id, "Cash")
        bank = PostingService.get_account_by_name(db, tenant.id, "Bank")
        if not all([ar, revenue, cogs, inv, cash, bank]):
            raise RuntimeError("Missing accounts (AR/Revenue/COGS/Inventory/Cash/Bank). Run scripts/seed.py first.")

        now = datetime.utcnow()

        def ensure_invoice(inv_no: str, cust: Customer, inv_date: datetime, lines: list[tuple[Item, Decimal, Decimal]]):
            existing = db.query(SalesInvoice).filter(SalesInvoice.tenant_id == tenant.id, SalesInvoice.invoice_number == inv_no).first()
            if existing:
                return existing, False

            total = sum([(qty * price) for _it, qty, price in lines], Decimal("0"))
            inv_row = SalesInvoice(
                tenant_id=tenant.id,
                invoice_number=inv_no,
                customer_id=cust.id,
                status="posted",
                invoice_date=inv_date,
                total_amount=total,
                created_by=user.id,
            )
            db.add(inv_row)
            db.flush()

            total_cogs = Decimal("0")
            for it, qty, price in lines:
                line_total = qty * price
                db.add(
                    SalesInvoiceLine(
                        tenant_id=tenant.id,
                        invoice_id=inv_row.id,
                        item_id=it.id,
                        qty=qty,
                        unit_price=price,
                        total=line_total,
                        warehouse_id=wh.id,
                        created_by=user.id,
                    )
                )

                unit_cost = StockService.get_fifo_cost(db=db, tenant_id=tenant.id, item_id=it.id, warehouse_id=wh.id, qty=qty) or Decimal("0")
                if unit_cost == 0:
                    unit_cost = Decimal(str(it.standard_cost or 0))

                if unit_cost and unit_cost > 0:
                    cogs_amt = qty * unit_cost
                    total_cogs += cogs_amt

                # stock out
                StockService.create_stock_move(
                    db=db,
                    tenant_id=tenant.id,
                    item_id=it.id,
                    warehouse_id=wh.id,
                    qty_in=Decimal("0"),
                    qty_out=qty,
                    unit_cost=unit_cost,
                    txn_type="issue",
                    ref_type="sales_invoice",
                    ref_id=inv_row.id,
                    txn_date=inv_date,
                    notes=f"Demo Sales Invoice {inv_no}",
                    created_by=user.id,
                )

            # Accounting: AR Dr, Revenue Cr (+ COGS Dr, Inventory Cr)
            jl = [
                {"account_id": ar.id, "debit": float(total), "credit": 0, "memo": f"Sales Invoice {inv_no}"},
                {"account_id": revenue.id, "debit": 0, "credit": float(total), "memo": f"Sales Invoice {inv_no}"},
            ]
            if total_cogs > 0:
                jl += [
                    {"account_id": cogs.id, "debit": float(total_cogs), "credit": 0, "memo": f"COGS {inv_no}"},
                    {"account_id": inv.id, "debit": 0, "credit": float(total_cogs), "memo": f"Inventory {inv_no}"},
                ]

            PostingService.create_journal_entry(
                db=db,
                tenant_id=tenant.id,
                date=inv_date,
                memo=f"Sales Invoice {inv_no}",
                lines=jl,
                ref_type="sales_invoice",
                ref_id=inv_row.id,
                posted_by=user.id,
                entry_number=f"JE-SALES-{inv_row.id}-{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}",
            )

            return inv_row, True

        created_invoices = 0
        demo_invoices = [
            ("INV-DEMO-0001", customers[0], now - timedelta(days=6), [(items[0], Decimal("250"), Decimal("48.00"))]),
            ("INV-DEMO-0002", customers[1], now - timedelta(days=4), [(items[1], Decimal("120"), Decimal("55.00")), (items[2], Decimal("20"), Decimal("160.00"))]),
            ("INV-DEMO-0003", customers[2], now - timedelta(days=2), [(items[3], Decimal("300"), Decimal("36.00"))]),
        ]

        invoice_rows: dict[str, SalesInvoice] = {}
        for inv_no, cust, dt, lines in demo_invoices:
            row, created = ensure_invoice(inv_no, cust, dt, lines)
            invoice_rows[inv_no] = row
            if created:
                created_invoices += 1

        created_receipts = 0

        def ensure_receipt(rcp_no: str, cust: Customer, dt: datetime, amount: Decimal, method: str, ref_inv: SalesInvoice | None):
            existing = db.query(Receipt).filter(Receipt.tenant_id == tenant.id, Receipt.receipt_number == rcp_no).first()
            if existing:
                return False

            r = Receipt(
                tenant_id=tenant.id,
                receipt_number=rcp_no,
                customer_id=cust.id,
                ref_invoice_id=ref_inv.id if ref_inv else None,
                amount=amount,
                method=method,
                receipt_date=dt,
                created_by=user.id,
            )
            db.add(r)
            db.flush()

            pay_acc = cash if method.lower() == "cash" else bank
            PostingService.create_journal_entry(
                db=db,
                tenant_id=tenant.id,
                date=dt,
                memo=f"Customer Receipt {rcp_no}",
                lines=[
                    {"account_id": pay_acc.id, "debit": float(amount), "credit": 0, "memo": f"Receipt {rcp_no} ({method})"},
                    {"account_id": ar.id, "debit": 0, "credit": float(amount), "memo": f"Receipt {rcp_no} (AR)"},
                ],
                ref_type="receipt",
                ref_id=r.id,
                posted_by=user.id,
                entry_number=f"JE-RCP-{r.id}-{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}",
            )
            return True

        demo_receipts = [
            ("RCP-DEMO-0001", customers[0], now - timedelta(days=5), Decimal("8000"), "cash", invoice_rows.get("INV-DEMO-0001")),
            ("RCP-DEMO-0002", customers[1], now - timedelta(days=3), Decimal("12000"), "bank", invoice_rows.get("INV-DEMO-0002")),
            ("RCP-DEMO-0003", customers[3], now - timedelta(days=1), Decimal("5000"), "cash", None),
            ("RCP-DEMO-0004", customers[2], now, Decimal("7000"), "bank", invoice_rows.get("INV-DEMO-0003")),
        ]
        for rcp_no, cust, dt, amt, method, ref in demo_receipts:
            if ensure_receipt(rcp_no, cust, dt, amt, method, ref):
                created_receipts += 1

        db.commit()
        print("[SUCCESS] Seeded sales invoices + receipts demo")
        print(f"  - tenant: {tenant.domain} (id={tenant.id})")
        print(f"  - invoices created: {created_invoices}")
        print(f"  - receipts created: {created_receipts}")

    finally:
        db.close()


if __name__ == "__main__":
    seed_sales_receipts_demo()
