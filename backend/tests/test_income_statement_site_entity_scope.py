"""P&L (income statement) respects site/entity selection: income, COGS, expenses."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from django.utils import timezone

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
from api.services.gl_posting import post_invoice_cogs_journal, post_invoice_sale_journal
from api.services.reporting import report_income_statement

pytestmark = pytest.mark.django_db


def test_site_pl_includes_invoice_revenue_and_cogs_excludes_other_site(company_tenant_with_gl):
    """Posted sale + COGS at site A appear on site A P&L only; site B is zero."""
    cid = company_tenant_with_gl.id
    st_a = Station.objects.create(
        company_id=cid, station_name="PL Site A", is_active=True
    )
    st_b = Station.objects.create(
        company_id=cid, station_name="PL Site B", is_active=True
    )
    cust = Customer.objects.create(
        company_id=cid,
        display_name="Retail",
        customer_number="PL-CUST",
        is_active=True,
    )
    inv_acc = ChartOfAccount.objects.get(company_id=cid, account_code="1220")
    cogs_acc = ChartOfAccount.objects.get(company_id=cid, account_code="5120")
    item = Item.objects.create(
        company_id=cid,
        name="Widget",
        item_type="inventory",
        unit="piece",
        cost=Decimal("10.00"),
        unit_price=Decimal("20.00"),
        quantity_on_hand=Decimal("50"),
        inventory_account=inv_acc,
        cogs_account=cogs_acc,
        is_active=True,
    )
    inv = Invoice.objects.create(
        company_id=cid,
        customer=cust,
        station=st_a,
        invoice_number="INV-PL-SITE-A",
        invoice_date=date(2026, 7, 10),
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
    assert post_invoice_sale_journal(cid, inv, payment_method="cash") is True
    assert post_invoice_cogs_journal(cid, inv) is True

    start, end = date(2026, 7, 1), date(2026, 7, 31)
    pl_a = report_income_statement(cid, start, end, station_id=st_a.id)
    pl_b = report_income_statement(cid, start, end, station_id=st_b.id)
    pl_all = report_income_statement(cid, start, end)

    assert pl_a.get("filter_station_id") == st_a.id
    income_a = Decimal(str(pl_a["income"]["total"]))
    cogs_a = Decimal(str(pl_a["cost_of_goods_sold"]["total"]))
    assert income_a > 0
    assert cogs_a == Decimal("20.00")
    assert Decimal(str(pl_a["gross_profit"])) == income_a - cogs_a
    assert Decimal(str(pl_a["net_income"])) == income_a - cogs_a

    assert Decimal(str(pl_b["income"]["total"])) == Decimal("0")
    assert Decimal(str(pl_b["cost_of_goods_sold"]["total"])) == Decimal("0")

    assert Decimal(str(pl_all["income"]["total"])) == income_a
    assert Decimal(str(pl_all["cost_of_goods_sold"]["total"])) == cogs_a


def test_site_pl_includes_expense_lines_for_station(company_tenant_with_gl):
    """Operating expense debits on a site appear on that site's P&L only."""
    cid = company_tenant_with_gl.id
    st_a = Station.objects.create(company_id=cid, station_name="Exp Site A", is_active=True)
    st_b = Station.objects.create(company_id=cid, station_name="Exp Site B", is_active=True)
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")
    expense = ChartOfAccount.objects.get(company_id=cid, account_code="6900")

    def post_expense(station_id: int, amount: str, tag: str):
        je = JournalEntry.objects.create(
            company_id=cid,
            entry_number=f"PL-EXP-{tag}",
            entry_date=date(2026, 7, 12),
            station_id=station_id,
            description="site expense",
            is_posted=True,
            posted_at=timezone.now(),
        )
        JournalEntryLine.objects.create(
            journal_entry=je,
            account=expense,
            station_id=station_id,
            debit=Decimal(amount),
            credit=Decimal("0"),
        )
        JournalEntryLine.objects.create(
            journal_entry=je,
            account=cash,
            station_id=station_id,
            debit=Decimal("0"),
            credit=Decimal(amount),
        )

    post_expense(st_a.id, "75", "A")
    post_expense(st_b.id, "25", "B")

    start, end = date(2026, 7, 1), date(2026, 7, 31)
    pl_a = report_income_statement(cid, start, end, station_id=st_a.id)
    pl_b = report_income_statement(cid, start, end, station_id=st_b.id)
    pl_all = report_income_statement(cid, start, end)

    assert Decimal(str(pl_a["expenses"]["total"])) == Decimal("75.00")
    assert Decimal(str(pl_b["expenses"]["total"])) == Decimal("25.00")
    assert Decimal(str(pl_all["expenses"]["total"])) == Decimal("100.00")


def test_station_pl_excludes_pond_tagged_expense_even_at_receipt_station(company_tenant_with_gl):
    """Pond bill debits must not appear on station P&L when receipt station matches."""
    from api.models import AquaculturePond

    cid = company_tenant_with_gl.id
    st_main = Station.objects.create(
        company_id=cid, station_name="Main", is_active=True
    )
    pond = AquaculturePond.objects.create(company_id=cid, name="Pond 1", is_active=True)
    aquaculture_exp = ChartOfAccount.objects.filter(
        company_id=cid, account_code="6725"
    ).first()
    if not aquaculture_exp:
        aquaculture_exp = ChartOfAccount.objects.create(
            company_id=cid,
            account_code="6725",
            account_name="Aquaculture Expense — Miscellaneous",
            account_type="expense",
            is_active=True,
        )
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")

    je = JournalEntry.objects.create(
        company_id=cid,
        entry_number="POND-ON-MAIN-STN",
        entry_date=date(2026, 10, 5),
        station_id=st_main.id,
        is_posted=True,
        posted_at=timezone.now(),
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=aquaculture_exp,
        station_id=st_main.id,
        aquaculture_pond_id=pond.id,
        debit=Decimal("500"),
        credit=Decimal("0"),
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=cash,
        station_id=st_main.id,
        aquaculture_pond_id=pond.id,
        debit=Decimal("0"),
        credit=Decimal("500"),
    )

    start, end = date(2026, 10, 1), date(2026, 10, 31)
    pl_main = report_income_statement(cid, start, end, station_id=st_main.id)
    pl_pond = report_income_statement(cid, start, end, pond_id=pond.id)

    assert Decimal(str(pl_main["expenses"]["total"])) == Decimal("0")
    assert Decimal(str(pl_pond["expenses"]["total"])) == Decimal("500.00")
    codes = {a["account_code"] for a in pl_main["expenses"]["accounts"]}
    assert aquaculture_exp.account_code not in codes


def test_entity_pl_rollup_ponds_and_sites_sum_to_company(company_tenant_with_gl):
    """Each pond/station is an individual entity; together with head office they roll up to the company total."""
    from api.models import AquaculturePond
    from api.services.reporting import report_entities_pl_summary

    cid = company_tenant_with_gl.id
    st1 = Station.objects.create(company_id=cid, station_name="Roll Site 1", is_active=True)
    st2 = Station.objects.create(company_id=cid, station_name="Roll Site 2", is_active=True)
    pond1 = AquaculturePond.objects.create(company_id=cid, name="Roll Pond 1", is_active=True)
    pond2 = AquaculturePond.objects.create(company_id=cid, name="Roll Pond 2", is_active=True)

    income = ChartOfAccount.objects.get(company_id=cid, account_code="4200")
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")
    expense = ChartOfAccount.objects.get(company_id=cid, account_code="6900")

    def post_income(amount: str, *, station_id=None, pond_id=None, tag: str) -> None:
        je = JournalEntry.objects.create(
            company_id=cid,
            entry_number=f"ROLL-{tag}",
            entry_date=date(2026, 9, 5),
            station_id=station_id,
            is_posted=True,
            posted_at=timezone.now(),
        )
        JournalEntryLine.objects.create(
            journal_entry=je, account=cash, station_id=station_id,
            aquaculture_pond_id=pond_id, debit=Decimal(amount), credit=Decimal("0"),
        )
        JournalEntryLine.objects.create(
            journal_entry=je, account=income, station_id=station_id,
            aquaculture_pond_id=pond_id, debit=Decimal("0"), credit=Decimal(amount),
        )

    post_income("100", station_id=st1.id, tag="S1")
    post_income("200", station_id=st2.id, tag="S2")
    post_income("300", pond_id=pond1.id, tag="P1")
    post_income("400", pond_id=pond2.id, tag="P2")

    # Head office / unassigned: fully untagged expense (no station, no pond).
    je_ho = JournalEntry.objects.create(
        company_id=cid, entry_number="ROLL-HO", entry_date=date(2026, 9, 6),
        is_posted=True, posted_at=timezone.now(),
    )
    JournalEntryLine.objects.create(journal_entry=je_ho, account=expense, debit=Decimal("50"), credit=Decimal("0"))
    JournalEntryLine.objects.create(journal_entry=je_ho, account=cash, debit=Decimal("0"), credit=Decimal("50"))

    rep = report_entities_pl_summary(cid, date(2026, 9, 1), date(2026, 9, 30))
    slices = rep["by_station"] + rep["by_pond"] + [rep["unscoped"]]
    co = rep["company_total"]

    # Together, every entity slice sums to the company total (the rollup).
    assert sum(Decimal(str(r["income"])) for r in slices) == Decimal(str(co["income"]))
    assert sum(Decimal(str(r["expenses"])) for r in slices) == Decimal(str(co["expenses"]))
    assert sum(Decimal(str(r["net_income"])) for r in slices) == Decimal(str(co["net_income"]))

    # Each pond stands alone as its own entity.
    pond_rows = {r["pond_name"]: r for r in rep["by_pond"]}
    assert Decimal(str(pond_rows["Roll Pond 1"]["income"])) == Decimal("300")
    assert Decimal(str(pond_rows["Roll Pond 2"]["income"])) == Decimal("400")
    assert Decimal(str(co["income"])) == Decimal("1000")
    assert Decimal(str(co["net_income"])) == Decimal("950")


def test_income_statement_api_honors_station_id(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    from api.models import Station

    st = Station.objects.create(
        company_id=company_tenant_with_gl.id, station_name="API PL Site", is_active=True
    )
    income = ChartOfAccount.objects.get(
        company_id=company_tenant_with_gl.id, account_code="4200"
    )
    cash = ChartOfAccount.objects.get(
        company_id=company_tenant_with_gl.id, account_code="1010"
    )
    je = JournalEntry.objects.create(
        company_id=company_tenant_with_gl.id,
        entry_number="API-PL-1",
        entry_date=date(2026, 8, 5),
        station_id=st.id,
        is_posted=True,
        posted_at=timezone.now(),
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=income, station_id=st.id, debit=Decimal("0"), credit=Decimal("200")
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=cash, station_id=st.id, debit=Decimal("200"), credit=Decimal("0")
    )

    r = api_client.get(
        "/api/reports/income-statement/",
        {
            "start_date": "2026-08-01",
            "end_date": "2026-08-31",
            "station_id": str(st.id),
        },
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    data = r.json()
    assert data.get("filter_station_id") == st.id
    assert Decimal(str(data["income"]["total"])) == Decimal("200.00")
    assert "cost_of_goods_sold" in data
    assert "gross_profit" in data
    assert "net_income" in data
