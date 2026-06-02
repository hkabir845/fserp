"""Invoice COGS auto-journal: item cost, COGS account, and P&L linkage."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from django.utils import timezone

from api.models import ChartOfAccount, Customer, Invoice, InvoiceLine, Item, JournalEntry, JournalEntryLine, Station
from api.services.gl_posting import (
    backfill_invoice_cogs_journals,
    post_invoice_cogs_journal,
    post_invoice_sale_journal,
)
from api.services.reporting import report_income_statement

pytestmark = pytest.mark.django_db


def test_invoice_cogs_falls_back_to_selling_price_when_no_cost(company_tenant_with_gl):
    """Every sale must post COGS. With no cost, no purchase history, and no opening cost,
    COGS uses the last-resort selling-price fallback so a COGS amount always shows."""
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
    assert JournalEntry.objects.filter(
        company_id=company_tenant_with_gl.id, entry_number=f"AUTO-INV-{inv.id}-COGS"
    ).exists()

    # No cost/purchase/opening data → last-resort selling-price fallback: 2 x 25 = 50.
    pl = report_income_statement(
        company_tenant_with_gl.id, date(2026, 4, 1), date(2026, 4, 30)
    )
    assert Decimal(str(pl["cost_of_goods_sold"]["total"])) == Decimal("50.00")


def test_invoice_cogs_posts_at_item_cost_when_set(company_tenant_with_gl):
    """When item cost is set, COGS posts at cost x qty (not the selling price)."""
    st = Station.objects.create(
        company_id=company_tenant_with_gl.id, station_name="COGS Cost Stn", is_active=True
    )
    cust = Customer.objects.create(
        company_id=company_tenant_with_gl.id,
        display_name="Walk-in Cost",
        customer_number="WALK-COST",
        is_active=True,
    )
    inv_acc = ChartOfAccount.objects.get(company_id=company_tenant_with_gl.id, account_code="1220")
    cogs_acc = ChartOfAccount.objects.get(company_id=company_tenant_with_gl.id, account_code="5120")
    item = Item.objects.create(
        company_id=company_tenant_with_gl.id,
        name="Shop snack costed",
        item_type="inventory",
        unit="piece",
        cost=Decimal("18.00"),
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
        invoice_number="INV-COGS-UT-2",
        invoice_date=date(2026, 4, 6),
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
    assert Decimal(str(pl["cost_of_goods_sold"]["total"])) == Decimal("36.00")


def test_sale_journal_idempotent_still_posts_missing_cogs(company_tenant_with_gl):
    """When SALE journal already exists, re-posting must still create COGS if missing."""
    from api.models import Customer, Invoice, InvoiceLine, Item, Station

    st = Station.objects.create(
        company_id=company_tenant_with_gl.id, station_name="Idempotent COGS", is_active=True
    )
    cust = Customer.objects.create(
        company_id=company_tenant_with_gl.id,
        display_name="Buyer",
        customer_number="IDEM-COGS",
        is_active=True,
    )
    cogs_acc = ChartOfAccount.objects.get(company_id=company_tenant_with_gl.id, account_code="5120")
    item = Item.objects.create(
        company_id=company_tenant_with_gl.id,
        name="Snack",
        item_type="inventory",
        cost=Decimal("12"),
        unit_price=Decimal("20"),
        quantity_on_hand=Decimal("10"),
        cogs_account=cogs_acc,
        is_active=True,
    )
    inv = Invoice.objects.create(
        company_id=company_tenant_with_gl.id,
        customer=cust,
        station=st,
        invoice_number="INV-IDEM-COGS",
        invoice_date=date(2026, 4, 12),
        status="paid",
        subtotal=Decimal("40"),
        total=Decimal("40"),
        payment_method="cash",
    )
    InvoiceLine.objects.create(
        invoice=inv,
        item=item,
        description=item.name,
        quantity=Decimal("2"),
        unit_price=Decimal("20"),
        amount=Decimal("40"),
    )
    post_invoice_sale_journal(company_tenant_with_gl.id, inv, payment_method="cash")
    JournalEntry.objects.filter(
        company_id=company_tenant_with_gl.id, entry_number=f"AUTO-INV-{inv.id}-COGS"
    ).delete()

    assert post_invoice_sale_journal(company_tenant_with_gl.id, inv, payment_method="cash") is True
    assert JournalEntry.objects.filter(
        company_id=company_tenant_with_gl.id, entry_number=f"AUTO-INV-{inv.id}-COGS"
    ).exists()

    pl = report_income_statement(
        company_tenant_with_gl.id, date(2026, 4, 1), date(2026, 4, 30)
    )
    assert Decimal(str(pl["cost_of_goods_sold"]["total"])) == Decimal("24.00")


def test_financial_analytics_pond_row_classifies_51xx_as_cogs(company_tenant_with_gl):
    """Pond-scoped financial analytics must use _pl_bucket (51xx expense → COGS)."""
    from api.models import AquaculturePond
    from api.services.reporting import _financial_analytics_entity_row

    pond = AquaculturePond.objects.create(
        company_id=company_tenant_with_gl.id,
        name="COGS Pond",
        is_active=True,
    )
    mis = ChartOfAccount.objects.create(
        company_id=company_tenant_with_gl.id,
        account_code="5198",
        account_name="Pond fuel COGS mis-typed",
        account_type="expense",
        is_active=True,
    )
    cash = ChartOfAccount.objects.get(company_id=company_tenant_with_gl.id, account_code="1010")
    je = JournalEntry.objects.create(
        company_id=company_tenant_with_gl.id,
        entry_number="POND-COGS-MIS",
        entry_date=date(2026, 5, 10),
        is_posted=True,
        posted_at=timezone.now(),
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=mis,
        aquaculture_pond_id=pond.id,
        debit=Decimal("55"),
        credit=Decimal("0"),
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=cash,
        aquaculture_pond_id=pond.id,
        debit=Decimal("0"),
        credit=Decimal("55"),
    )

    row = _financial_analytics_entity_row(
        company_tenant_with_gl.id,
        date(2026, 5, 1),
        date(2026, 5, 31),
        entity_type="pond",
        entity_id=pond.id,
        entity_name=pond.name,
        pond_id=pond.id,
    )
    assert Decimal(str(row["pl_cogs"])) == Decimal("55.00")


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


def test_cogs_posts_even_when_standard_accounts_missing(company_tenant_with_gl):
    """COGS can never be zero for a sold item: if the standard COGS (5120) / inventory (1220)
    accounts are absent, posting auto-provisions them so the balanced journal still posts."""
    cid = company_tenant_with_gl.id
    # Remove the standard shop COGS + inventory accounts to simulate an incomplete chart.
    ChartOfAccount.objects.filter(company_id=cid, account_code__in=["5120", "1220"]).delete()

    st = Station.objects.create(company_id=cid, station_name="NoAcct Stn", is_active=True)
    cust = Customer.objects.create(
        company_id=cid, display_name="NoAcct Buyer", customer_number="B-NOACC", is_active=True
    )
    item = Item.objects.create(
        company_id=cid,
        name="Orphan Widget",
        item_type="inventory",
        unit="piece",
        cost=Decimal("4"),
        unit_price=Decimal("9"),
        quantity_on_hand=Decimal("10"),
        is_active=True,
    )
    inv = Invoice.objects.create(
        company_id=cid,
        customer=cust,
        station=st,
        invoice_number="INV-NOACC-1",
        invoice_date=date(2026, 4, 15),
        status="paid",
        subtotal=Decimal("18"),
        total=Decimal("18"),
        payment_method="cash",
    )
    InvoiceLine.objects.create(
        invoice=inv, item=item, description=item.name,
        quantity=Decimal("2"), unit_price=Decimal("9"), amount=Decimal("18"),
    )
    assert post_invoice_cogs_journal(cid, inv) is True
    # 2 x 4 = 8 COGS posted, and the standard accounts were auto-created.
    pl = report_income_statement(cid, date(2026, 4, 1), date(2026, 4, 30))
    assert Decimal(str(pl["cost_of_goods_sold"]["total"])) == Decimal("8.00")
    assert ChartOfAccount.objects.filter(company_id=cid, account_code="5120", is_active=True).exists()
    assert ChartOfAccount.objects.filter(company_id=cid, account_code="1220", is_active=True).exists()


def test_non_stock_item_with_cost_still_posts_cogs(company_tenant_with_gl):
    """A sold item that is NOT physical-stock (e.g. non-inventory) but carries a real cost
    must still post COGS so the P&L shows it. With no cost basis it stays out of COGS."""
    cid = company_tenant_with_gl.id
    st = Station.objects.create(company_id=cid, station_name="NonStock COGS", is_active=True)
    cust = Customer.objects.create(
        company_id=cid, display_name="NonStock Buyer", customer_number="B-NONSTK", is_active=True
    )
    inv_acc = ChartOfAccount.objects.get(company_id=cid, account_code="1220")
    cogs_acc = ChartOfAccount.objects.get(company_id=cid, account_code="5120")
    item = Item.objects.create(
        company_id=cid,
        name="Non-stock costed",
        item_type="non_inventory",
        unit="piece",
        cost=Decimal("7.00"),
        unit_price=Decimal("12.00"),
        inventory_account=inv_acc,
        cogs_account=cogs_acc,
        is_active=True,
    )
    inv = Invoice.objects.create(
        company_id=cid,
        customer=cust,
        station=st,
        invoice_number="INV-NONSTK-1",
        invoice_date=date(2026, 4, 18),
        status="paid",
        subtotal=Decimal("36"),
        total=Decimal("36"),
        payment_method="cash",
    )
    InvoiceLine.objects.create(
        invoice=inv, item=item, description=item.name,
        quantity=Decimal("3"), unit_price=Decimal("12"), amount=Decimal("36"),
    )
    post_invoice_sale_journal(cid, inv, payment_method="cash")
    assert post_invoice_cogs_journal(cid, inv) is True

    pl = report_income_statement(cid, date(2026, 4, 1), date(2026, 4, 30))
    # 3 x 7 cost = 21 even though the item does not track physical stock.
    assert Decimal(str(pl["cost_of_goods_sold"]["total"])) == Decimal("21.00")


def test_non_stock_item_without_cost_basis_skips_cogs(company_tenant_with_gl):
    """A non-stock service item with no cost basis must NOT post COGS (no selling-price
    last resort for non-stock lines)."""
    cid = company_tenant_with_gl.id
    st = Station.objects.create(company_id=cid, station_name="Service NoCOGS", is_active=True)
    cust = Customer.objects.create(
        company_id=cid, display_name="Service Buyer", customer_number="B-SVC", is_active=True
    )
    item = Item.objects.create(
        company_id=cid,
        name="Labour service",
        item_type="service",
        unit="hour",
        cost=Decimal("0"),
        unit_price=Decimal("50.00"),
        is_active=True,
    )
    inv = Invoice.objects.create(
        company_id=cid,
        customer=cust,
        station=st,
        invoice_number="INV-SVC-1",
        invoice_date=date(2026, 4, 19),
        status="paid",
        subtotal=Decimal("100"),
        total=Decimal("100"),
        payment_method="cash",
    )
    InvoiceLine.objects.create(
        invoice=inv, item=item, description=item.name,
        quantity=Decimal("2"), unit_price=Decimal("50"), amount=Decimal("100"),
    )
    post_invoice_sale_journal(cid, inv, payment_method="cash")
    assert post_invoice_cogs_journal(cid, inv) is False

    pl = report_income_statement(cid, date(2026, 4, 1), date(2026, 4, 30))
    assert Decimal(str(pl["cost_of_goods_sold"]["total"])) == Decimal("0.00")


def test_income_statement_self_heals_missing_cogs(company_tenant_with_gl):
    """A posted sale whose COGS journal is missing must still show COGS in the P&L for the
    sale's period — the report self-heals by posting AUTO-INV-*-COGS, no manual backfill."""
    cid = company_tenant_with_gl.id
    st = Station.objects.create(company_id=cid, station_name="Heal Stn", is_active=True)
    cust = Customer.objects.create(
        company_id=cid, display_name="Heal Buyer", customer_number="B-HEAL", is_active=True
    )
    item = Item.objects.create(
        company_id=cid,
        name="Heal Widget",
        item_type="inventory",
        cost=Decimal("10"),
        unit_price=Decimal("15"),
        quantity_on_hand=Decimal("5"),
        is_active=True,
    )
    inv = Invoice.objects.create(
        company_id=cid,
        customer=cust,
        station=st,
        invoice_number="INV-HEAL-1",
        invoice_date=date(2026, 4, 12),
        status="paid",
        subtotal=Decimal("30"),
        total=Decimal("30"),
        payment_method="cash",
    )
    InvoiceLine.objects.create(
        invoice=inv, item=item, description="Heal Widget",
        quantity=Decimal("3"), unit_price=Decimal("10"), amount=Decimal("30"),
    )
    post_invoice_sale_journal(cid, inv, payment_method="cash")
    # Simulate a historical sale missing its COGS journal.
    JournalEntry.objects.filter(company_id=cid, entry_number=f"AUTO-INV-{inv.id}-COGS").delete()

    pl = report_income_statement(cid, date(2026, 4, 1), date(2026, 4, 30))
    # 3 x 10 cost is posted by the report itself and shows as COGS.
    assert Decimal(str(pl["cost_of_goods_sold"]["total"])) == Decimal("30.00")
    assert JournalEntry.objects.filter(
        company_id=cid, entry_number=f"AUTO-INV-{inv.id}-COGS"
    ).exists()
