"""Posted GL lines carry station for multi-site reporting."""
from __future__ import annotations

from decimal import Decimal

import pytest

pytestmark = pytest.mark.django_db


def test_invoice_sale_and_cogs_journals_tag_station(company_tenant):
    from api.models import (
        ChartOfAccount,
        Customer,
        Invoice,
        InvoiceLine,
        Item,
        JournalEntry,
        JournalEntryLine,
        Station,
    )
    from api.services.gl_posting import sync_invoice_gl

    st = Station.objects.create(company_id=company_tenant.id, station_name="Site A")
    for code, name, typ in [
        ("1010", "Cash", "asset"),
        ("4100", "Fuel Sales", "income"),
        ("1200", "Inventory Fuel", "asset"),
        ("5100", "COGS Fuel", "cost_of_goods_sold"),
    ]:
        ChartOfAccount.objects.get_or_create(
            company_id=company_tenant.id,
            account_code=code,
            defaults={"account_name": name, "account_type": typ, "is_active": True},
        )
    cust = Customer.objects.create(
        company_id=company_tenant.id,
        customer_number="C1",
        display_name="Walk-in",
        is_active=True,
    )
    item = Item.objects.create(
        company_id=company_tenant.id,
        name="Diesel",
        unit_price=Decimal("100"),
        cost=Decimal("50"),
        unit="L",
        category="fuel",
    )
    inv = Invoice.objects.create(
        company_id=company_tenant.id,
        customer=cust,
        station=st,
        invoice_number="INV-GL-ST-1",
        invoice_date="2026-04-15",
        status="paid",
        subtotal=Decimal("100"),
        tax_total=Decimal("0"),
        total=Decimal("100"),
        payment_method="cash",
    )
    InvoiceLine.objects.create(
        invoice=inv,
        item=item,
        quantity=Decimal("1"),
        unit_price=Decimal("100"),
        amount=Decimal("100"),
    )
    sync_invoice_gl(company_tenant.id, inv)

    sale = JournalEntry.objects.filter(
        company_id=company_tenant.id, entry_number=f"AUTO-INV-{inv.id}-SALE"
    ).first()
    assert sale is not None
    assert sale.station_id == st.id
    sale_lines = list(JournalEntryLine.objects.filter(journal_entry=sale))
    assert len(sale_lines) >= 2
    assert all(ln.station_id == st.id for ln in sale_lines)

    cogs = JournalEntry.objects.filter(
        company_id=company_tenant.id, entry_number=f"AUTO-INV-{inv.id}-COGS"
    ).first()
    assert cogs is not None
    assert cogs.station_id == st.id
    cogs_lines = list(JournalEntryLine.objects.filter(journal_entry=cogs))
    assert len(cogs_lines) >= 2
    assert all(ln.station_id == st.id for ln in cogs_lines)


def test_inter_station_inventory_journal_lines_differ_by_site(company_tenant):
    from api.models import (
        ChartOfAccount,
        InventoryTransfer,
        InventoryTransferLine,
        Item,
        JournalEntry,
        JournalEntryLine,
        Station,
    )
    from api.services.gl_posting import post_inventory_transfer_journal

    s_from = Station.objects.create(company_id=company_tenant.id, station_name="From Bay")
    s_to = Station.objects.create(company_id=company_tenant.id, station_name="To Bay")
    ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code="1220",
        account_name="Shop Inv",
        account_type="asset",
        is_active=True,
    )
    it = Item.objects.create(
        company_id=company_tenant.id,
        name="Snacks",
        unit_price=Decimal("2"),
        cost=Decimal("1"),
        pos_category="shop",
    )
    tr = InventoryTransfer.objects.create(
        company_id=company_tenant.id,
        from_station=s_from,
        to_station=s_to,
        transfer_number="TR-GL-1",
        transfer_date="2026-04-20",
        status=InventoryTransfer.STATUS_POSTED,
    )
    InventoryTransferLine.objects.create(transfer=tr, item=it, quantity=Decimal("3"))

    assert post_inventory_transfer_journal(company_tenant.id, tr.id) is True
    je = JournalEntry.objects.filter(
        company_id=company_tenant.id, entry_number=f"AUTO-ISTR-{tr.id}"
    ).first()
    assert je is not None
    assert je.station_id is None
    lines = list(JournalEntryLine.objects.filter(journal_entry=je).order_by("id"))
    assert len(lines) == 2
    st_ids = {ln.station_id for ln in lines}
    assert st_ids == {s_from.id, s_to.id}
