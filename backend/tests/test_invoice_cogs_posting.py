"""Invoice COGS auto-journal: item cost, COGS account, and P&L linkage."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from django.utils import timezone

from api.models import ChartOfAccount, Customer, Invoice, InvoiceLine, Item, JournalEntry, Station
from api.services.gl_posting import (
    backfill_invoice_cogs_journals,
    post_invoice_cogs_journal,
    post_invoice_sale_journal,
)
from api.services.reporting import report_income_statement

pytestmark = pytest.mark.django_db


def test_invoice_cogs_uses_unit_price_when_cost_zero(company_tenant_with_gl):
    st = Station.objects.create(
        company_id=company_tenant_with_gl.id, station_name="COGS Test Stn", is_active=True
    )
    cust = Customer.objects.create(
        company_id=company_tenant_with_gl.id,
        display_name="Walk-in COGS",
        customer_number="WALK-COGS",
        is_active=True,
    )
    inv_acc = ChartOfAccount.objects.get(company_id=company_tenant_with_gl.id, account_code="1220")
    cogs_acc = ChartOfAccount.objects.get(company_id=company_tenant_with_gl.id, account_code="5120")
    item = Item.objects.create(
        company_id=company_tenant_with_gl.id,
        name="Shop snack",
        item_type="inventory",
        unit="piece",
        cost=Decimal("0"),
        unit_price=Decimal("25.00"),
        quantity_on_hand=Decimal("100"),
        inventory_account=inv_acc,
        cogs_account=cogs_acc,
        is_active=True,
    )
    inv = Invoice.objects.create(
        company_id=company_tenant_with_gl.id,
        customer=cust,
        station=st,
        invoice_number="INV-COGS-UT-1",
        invoice_date=date(2026, 4, 5),
        status="paid",
        subtotal=Decimal("50"),
        total=Decimal("50"),
        payment_method="cash",
    )
    InvoiceLine.objects.create(
        invoice=inv,
        item=item,
        description=item.name,
        quantity=Decimal("2"),
        unit_price=Decimal("25"),
        amount=Decimal("50"),
    )
    post_invoice_sale_journal(company_tenant_with_gl.id, inv, payment_method="cash")
    assert post_invoice_cogs_journal(company_tenant_with_gl.id, inv) is True

    pl = report_income_statement(
        company_tenant_with_gl.id, date(2026, 4, 1), date(2026, 4, 30)
    )
    assert Decimal(str(pl["cost_of_goods_sold"]["total"])) == Decimal("50.00")


def test_backfill_posts_missing_cogs_only_once(company_tenant_with_gl):
    st = Station.objects.create(
        company_id=company_tenant_with_gl.id, station_name="Backfill Stn", is_active=True
    )
    cust = Customer.objects.create(
        company_id=company_tenant_with_gl.id,
        display_name="Buyer",
        customer_number="B-COGS",
        is_active=True,
    )
    item = Item.objects.create(
        company_id=company_tenant_with_gl.id,
        name="Widget",
        item_type="inventory",
        cost=Decimal("10"),
        unit_price=Decimal("15"),
        quantity_on_hand=Decimal("5"),
        is_active=True,
    )
    inv = Invoice.objects.create(
        company_id=company_tenant_with_gl.id,
        customer=cust,
        station=st,
        invoice_number="INV-COGS-BF",
        invoice_date=date(2026, 4, 8),
        status="paid",
        subtotal=Decimal("20"),
        total=Decimal("20"),
        payment_method="cash",
    )
    InvoiceLine.objects.create(
        invoice=inv,
        item=item,
        description="Widget",
        quantity=Decimal("2"),
        unit_price=Decimal("10"),
        amount=Decimal("20"),
    )
    post_invoice_sale_journal(company_tenant_with_gl.id, inv, payment_method="cash")
    JournalEntry.objects.filter(
        company_id=company_tenant_with_gl.id, entry_number=f"AUTO-INV-{inv.id}-COGS"
    ).delete()

    s1 = backfill_invoice_cogs_journals(
        company_tenant_with_gl.id, date(2026, 4, 1), date(2026, 4, 30)
    )
    assert s1["posted"] == 1
    s2 = backfill_invoice_cogs_journals(
        company_tenant_with_gl.id, date(2026, 4, 1), date(2026, 4, 30)
    )
    assert s2["posted"] == 0
    assert s2["skipped_existing"] == 1
