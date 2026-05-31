"""End-to-end: purchasing inventory (vendor bill) capitalizes to the inventory asset and sets the
moving-average cost, but does NOT create COGS. COGS only appears in the P&L once the goods are sold.

This mirrors the common user confusion: "I bought items and recorded bills, why is COGS zero?".
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    Bill,
    BillLine,
    ChartOfAccount,
    Customer,
    Invoice,
    InvoiceLine,
    Item,
    JournalEntry,
    JournalEntryLine,
    Station,
    Vendor,
)
from api.services.gl_posting import (
    post_invoice_sale_journal,
    sync_posted_vendor_bill,
)
from api.services.reporting import report_income_statement

pytestmark = pytest.mark.django_db

PERIOD_START = date(2026, 6, 1)
PERIOD_END = date(2026, 6, 30)


def _account_balance(company_id: int, code: str) -> tuple[Decimal, Decimal]:
    acc = ChartOfAccount.objects.get(company_id=company_id, account_code=code)
    agg = JournalEntryLine.objects.filter(
        journal_entry__company_id=company_id, account_id=acc.id
    )
    debit = sum((l.debit or Decimal("0")) for l in agg)
    credit = sum((l.credit or Decimal("0")) for l in agg)
    return Decimal(debit), Decimal(credit)


def _post_purchase_bill(company_id: int, item: Item, qty: Decimal, total: Decimal) -> Bill:
    vendor = Vendor.objects.create(
        company_id=company_id, display_name="Fuel Supplier", vendor_number="V-COGS-E2E", is_active=True
    )
    bill = Bill.objects.create(
        company_id=company_id,
        vendor=vendor,
        bill_number="BILL-COGS-E2E",
        bill_date=date(2026, 6, 1),
        status="open",
        total=total,
        stock_receipt_applied=False,
    )
    BillLine.objects.create(
        bill=bill,
        item=item,
        description=item.name,
        quantity=qty,
        unit_price=(total / qty),
        amount=total,
    )
    sync_posted_vendor_bill(company_id, bill)
    bill.refresh_from_db()
    return bill


def test_purchase_only_capitalizes_inventory_and_keeps_cogs_zero(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    item = Item.objects.create(
        company_id=cid,
        name="Shop Widget",
        item_type="inventory",
        unit="piece",
        cost=Decimal("0"),
        unit_price=Decimal("25"),
        quantity_on_hand=Decimal("0"),
        is_active=True,
    )

    # Purchase 100 units for 900 (unit cost 9) via a posted vendor bill.
    _post_purchase_bill(cid, item, Decimal("100"), Decimal("900"))
    item.refresh_from_db()

    # AVCO set the unit cost and stock was received into the inventory asset.
    assert item.cost == Decimal("9.0000")
    assert item.quantity_on_hand == Decimal("100")

    # The purchase debits the inventory asset (1220) and credits A/P (2000) — balance sheet only.
    inv_debit, _ = _account_balance(cid, "1220")
    _, ap_credit = _account_balance(cid, "2000")
    assert inv_debit == Decimal("900")
    assert ap_credit == Decimal("900")

    # No sale yet → COGS must be zero (buying is not an expense; it is an asset).
    pl = report_income_statement(cid, PERIOD_START, PERIOD_END)
    assert Decimal(str(pl["cost_of_goods_sold"]["total"])) == Decimal("0.00")
    cogs_debit, _ = _account_balance(cid, "5120")
    assert cogs_debit == Decimal("0")


def test_selling_purchased_stock_posts_cogs_in_pl(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    item = Item.objects.create(
        company_id=cid,
        name="Shop Widget Sold",
        item_type="inventory",
        unit="piece",
        cost=Decimal("0"),
        unit_price=Decimal("25"),
        quantity_on_hand=Decimal("0"),
        is_active=True,
    )
    _post_purchase_bill(cid, item, Decimal("100"), Decimal("900"))
    item.refresh_from_db()
    assert item.cost == Decimal("9.0000")

    # Now SELL 10 units @ 25 = 250 (cash sale).
    st = Station.objects.create(company_id=cid, station_name="Shop", is_active=True)
    cust = Customer.objects.create(
        company_id=cid, display_name="Walk-in", customer_number="WALK-E2E", is_active=True
    )
    inv = Invoice.objects.create(
        company_id=cid,
        customer=cust,
        station=st,
        invoice_number="INV-COGS-E2E",
        invoice_date=date(2026, 6, 10),
        status="paid",
        subtotal=Decimal("250"),
        total=Decimal("250"),
        payment_method="cash",
    )
    InvoiceLine.objects.create(
        invoice=inv,
        item=item,
        description=item.name,
        quantity=Decimal("10"),
        unit_price=Decimal("25"),
        amount=Decimal("250"),
    )
    assert post_invoice_sale_journal(cid, inv, payment_method="cash") is True

    # COGS journal posted at AVCO cost (10 × 9 = 90) and shows in the P&L.
    assert JournalEntry.objects.filter(
        company_id=cid, entry_number=f"AUTO-INV-{inv.id}-COGS"
    ).exists()
    pl = report_income_statement(cid, PERIOD_START, PERIOD_END)
    assert Decimal(str(pl["income"]["total"])) == Decimal("250.00")
    assert Decimal(str(pl["cost_of_goods_sold"]["total"])) == Decimal("90.00")
    assert Decimal(str(pl["gross_profit"])) == Decimal("160.00")

    # Inventory asset relieved by the cost of what was sold: 900 received − 90 sold = 810 remaining.
    inv_debit, inv_credit = _account_balance(cid, "1220")
    assert inv_debit - inv_credit == Decimal("810")
