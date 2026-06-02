"""Site-scoped balance sheet uses tagged GL lines only (no chart opening on slice)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

pytestmark = pytest.mark.django_db


def test_report_balance_sheet_includes_filter_station_id(company_tenant):
    from api.models import ChartOfAccount, Customer, Invoice, InvoiceLine, Item, JournalEntry, Station
    from api.services.gl_posting import sync_invoice_gl
    from api.services.reporting import report_balance_sheet

    st = Station.objects.create(company_id=company_tenant.id, station_name="BS-Site", is_active=True)
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
        invoice_number="INV-BS-ST-1",
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

    out = report_balance_sheet(company_tenant.id, date(2026, 4, 1), date(2026, 4, 30), station_id=st.id)
    assert out.get("filter_station_id") == st.id
    assert "Site filter" in (out.get("accounting_note") or "")
    assert out.get("is_balanced") is True
    assert JournalEntry.objects.filter(company_id=company_tenant.id, station_id=st.id).exists()


def test_report_balance_sheet_pond_scope(company_tenant):
    """A single pond gets its own account-level balance sheet from pond-tagged GL lines."""
    from api.models import (
        AquaculturePond,
        ChartOfAccount,
        JournalEntry,
        JournalEntryLine,
    )
    from api.services.reporting import report_balance_sheet

    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="BS-Pond", is_active=True)
    other = AquaculturePond.objects.create(company_id=cid, name="Other-Pond", is_active=True)

    cash = ChartOfAccount.objects.create(
        company_id=cid, account_code="1010", account_name="Cash", account_type="asset", is_active=True
    )
    sales = ChartOfAccount.objects.create(
        company_id=cid, account_code="4200", account_name="Fish Sales", account_type="income", is_active=True
    )

    # Pond-tagged sale: Dr Cash 300 / Cr Fish Sales 300 (income rolls into equity via Σ-P&L).
    je = JournalEntry.objects.create(
        company_id=cid,
        entry_number="PND-BS-1",
        entry_date=date(2026, 4, 10),
        description="pond sale",
        is_posted=True,
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=cash, aquaculture_pond_id=pond.id, debit=Decimal("300"), credit=Decimal("0")
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=sales, aquaculture_pond_id=pond.id, debit=Decimal("0"), credit=Decimal("300")
    )
    # Activity on another pond must not leak into this pond's balance sheet.
    je2 = JournalEntry.objects.create(
        company_id=cid,
        entry_number="PND-BS-2",
        entry_date=date(2026, 4, 11),
        description="other pond sale",
        is_posted=True,
    )
    JournalEntryLine.objects.create(
        journal_entry=je2, account=cash, aquaculture_pond_id=other.id, debit=Decimal("999"), credit=Decimal("0")
    )
    JournalEntryLine.objects.create(
        journal_entry=je2, account=sales, aquaculture_pond_id=other.id, debit=Decimal("0"), credit=Decimal("999")
    )

    out = report_balance_sheet(cid, date(2026, 4, 1), date(2026, 4, 30), pond_id=pond.id)

    assert out.get("filter_pond_id") == pond.id
    assert out.get("filter_station_id") is None
    assert "Pond filter" in (out.get("accounting_note") or "")
    assert out["assets"]["total"] == 300.0  # only this pond's cash, not the other pond's 999
    assert out["net_income_cumulative"] == 300.0  # income rolled into equity for this pond
    assert out["is_balanced"] is True


def test_build_statement_transactions_filters_station(company_tenant):
    from api.models import ChartOfAccount, JournalEntry, JournalEntryLine, Station
    from api.services.journal_statement import build_statement_transactions

    st1 = Station.objects.create(company_id=company_tenant.id, station_name="S1", is_active=True)
    st2 = Station.objects.create(company_id=company_tenant.id, station_name="S2", is_active=True)
    coa = ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code="1999",
        account_name="Test BS",
        account_type="asset",
        is_active=True,
        opening_balance=Decimal("1000"),
    )
    je1 = JournalEntry.objects.create(
        company_id=company_tenant.id,
        entry_number="MAN-1",
        entry_date=date(2026, 5, 1),
        description="t1",
        station_id=st1.id,
        is_posted=True,
    )
    je2 = JournalEntry.objects.create(
        company_id=company_tenant.id,
        entry_number="MAN-2",
        entry_date=date(2026, 5, 2),
        description="t2",
        station_id=st2.id,
        is_posted=True,
    )
    JournalEntryLine.objects.create(
        journal_entry=je1, account=coa, station_id=st1.id, debit=Decimal("10"), credit=Decimal("0")
    )
    JournalEntryLine.objects.create(
        journal_entry=je2, account=coa, station_id=st2.id, debit=Decimal("99"), credit=Decimal("0")
    )

    all_tx, running_all, open_all = build_statement_transactions(coa)
    assert len(all_tx) == 2
    assert open_all == Decimal("1000")
    assert running_all == Decimal("1109")

    tx1, running1, open1 = build_statement_transactions(coa, station_id=st1.id)
    assert len(tx1) == 1
    assert tx1[0]["station_id"] == st1.id
    assert open1 == Decimal("0")
    assert running1 == Decimal("10")

    tx_from_may2, end_may2, open_may2 = build_statement_transactions(
        coa, start_date=date(2026, 5, 2)
    )
    assert len(tx_from_may2) == 1
    assert open_may2 == Decimal("1010")
    assert end_may2 == Decimal("1109")

    tx_st1_may2, end_st1_may2, open_st1_may2 = build_statement_transactions(
        coa, start_date=date(2026, 5, 2), station_id=st1.id
    )
    assert len(tx_st1_may2) == 0
    assert open_st1_may2 == Decimal("10")
    assert end_st1_may2 == Decimal("10")
