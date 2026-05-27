"""P&L and entity reports: COGS accounts, gross profit, expense-detail separation."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest
from django.utils import timezone

from api.models import ChartOfAccount, JournalEntry, JournalEntryLine, Station
from api.services.reporting import (
    report_entities_pl_summary,
    report_expense_detail,
    report_income_detail,
    report_income_statement,
)

pytestmark = pytest.mark.django_db


def test_income_statement_api_returns_cogs_section(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    cogs = ChartOfAccount.objects.get(
        company_id=company_tenant_with_gl.id, account_code="5100"
    )
    je = JournalEntry.objects.create(
        company_id=company_tenant_with_gl.id,
        entry_number="API-COGS-PL-1",
        entry_date=date(2026, 3, 15),
        description="test",
        is_posted=True,
        posted_at=timezone.now(),
    )
    cash = ChartOfAccount.objects.get(
        company_id=company_tenant_with_gl.id, account_code="1010"
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=cogs, debit=Decimal("80"), credit=Decimal("0")
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=cash, debit=Decimal("0"), credit=Decimal("80")
    )

    r = api_client.get(
        "/api/reports/income-statement/",
        {"start_date": "2026-03-01", "end_date": "2026-03-31"},
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    data = json.loads(r.content)
    assert data["report_id"] == "income-statement"
    assert Decimal(str(data["cost_of_goods_sold"]["total"])) == Decimal("80.00")
    codes = {a["account_code"] for a in data["cost_of_goods_sold"]["accounts"]}
    assert "5100" in codes
    assert Decimal(str(data["gross_profit"])) == Decimal(str(data["income"]["total"])) - Decimal(
        "80"
    )


def test_expense_detail_api_excludes_cogs_accounts(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    r = api_client.get(
        "/api/reports/expense-detail/",
        {"start_date": "2026-03-01", "end_date": "2026-03-31"},
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    data = json.loads(r.content)
    codes = {a["account_code"] for a in data["expenses"]["accounts"]}
    assert "5100" not in codes
    assert "5120" not in codes
    note = data.get("accounting_note") or ""
    assert "cost of goods" in note.lower() or "cogs" in note.lower()


def test_income_detail_api_includes_income_excludes_cogs_and_expense(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    income = ChartOfAccount.objects.get(
        company_id=company_tenant_with_gl.id, account_code="4200"
    )
    je = JournalEntry.objects.create(
        company_id=company_tenant_with_gl.id,
        entry_number="API-INC-DET-1",
        entry_date=date(2026, 3, 20),
        description="shop sale",
        is_posted=True,
        posted_at=timezone.now(),
    )
    cash = ChartOfAccount.objects.get(
        company_id=company_tenant_with_gl.id, account_code="1010"
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=income, debit=Decimal("0"), credit=Decimal("120")
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=cash, debit=Decimal("120"), credit=Decimal("0")
    )

    r = api_client.get(
        "/api/reports/income-detail/",
        {"start_date": "2026-03-01", "end_date": "2026-03-31"},
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    data = json.loads(r.content)
    assert data["report_id"] == "income-detail"
    codes = {a["account_code"] for a in data["income"]["accounts"]}
    assert "4200" in codes
    assert "5100" not in codes
    assert "5120" not in codes
    assert "6900" not in codes
    assert Decimal(str(data["income"]["total"])) == Decimal("120.00")
    note = data.get("accounting_note") or ""
    assert "income" in note.lower()


def test_income_statement_treats_51xx_expense_as_cogs(company_tenant_with_gl):
    """Mis-typed 51xx accounts stored as expense still appear under COGS on P&L."""
    mis = ChartOfAccount.objects.create(
        company_id=company_tenant_with_gl.id,
        account_code="5199",
        account_name="Fuel COGS (mis-typed expense)",
        account_type="expense",
        is_active=True,
    )
    cash = ChartOfAccount.objects.get(company_id=company_tenant_with_gl.id, account_code="1010")
    je = JournalEntry.objects.create(
        company_id=company_tenant_with_gl.id,
        entry_number="COGS-MIS-TYPE",
        entry_date=date(2026, 3, 18),
        description="cogs mis-type",
        is_posted=True,
        posted_at=timezone.now(),
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=mis, debit=Decimal("45"), credit=Decimal("0")
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=cash, debit=Decimal("0"), credit=Decimal("45")
    )

    data = report_income_statement(
        company_tenant_with_gl.id, date(2026, 3, 1), date(2026, 3, 31)
    )
    codes = {a["account_code"] for a in data["cost_of_goods_sold"]["accounts"]}
    assert "5199" in codes
    assert "5199" not in {a["account_code"] for a in data["expenses"]["accounts"]}
    assert Decimal(str(data["cost_of_goods_sold"]["total"])) >= Decimal("45.00")


def test_income_detail_matches_income_statement_income_section(company_tenant_with_gl):
    start = date(2026, 4, 1)
    end = date(2026, 4, 30)
    pl = report_income_statement(company_tenant_with_gl.id, start, end)
    inc = report_income_detail(company_tenant_with_gl.id, start, end)
    assert inc["income"]["total"] == pl["income"]["total"]
    pl_codes = {a["account_code"] for a in pl["income"]["accounts"]}
    inc_codes = {a["account_code"] for a in inc["income"]["accounts"]}
    assert pl_codes == inc_codes


def test_entities_pl_summary_includes_cogs_and_gross_profit(company_tenant_with_gl):
    st = Station.objects.create(
        company_id=company_tenant_with_gl.id,
        station_name="COGS Entity Site",
        is_active=True,
    )
    cogs = ChartOfAccount.objects.get(
        company_id=company_tenant_with_gl.id, account_code="5120"
    )
    income = ChartOfAccount.objects.get(
        company_id=company_tenant_with_gl.id, account_code="4200"
    )
    je = JournalEntry.objects.create(
        company_id=company_tenant_with_gl.id,
        entry_number="ENT-COGS-1",
        entry_date=date(2026, 4, 10),
        station_id=st.id,
        description="site cogs",
        is_posted=True,
        posted_at=timezone.now(),
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=income,
        station_id=st.id,
        debit=Decimal("0"),
        credit=Decimal("200"),
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=cogs,
        station_id=st.id,
        debit=Decimal("60"),
        credit=Decimal("0"),
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=ChartOfAccount.objects.get(
            company_id=company_tenant_with_gl.id, account_code="1010"
        ),
        station_id=st.id,
        debit=Decimal("140"),
        credit=Decimal("0"),
    )

    out = report_entities_pl_summary(
        company_tenant_with_gl.id, date(2026, 4, 1), date(2026, 4, 30)
    )
    row = next(r for r in out["by_station"] if r["station_id"] == st.id)
    assert Decimal(str(row["income"])) == Decimal("200.00")
    assert Decimal(str(row["cost_of_goods_sold"])) == Decimal("60.00")
    assert Decimal(str(row["gross_profit"])) == Decimal("140.00")


def test_income_statement_station_filter_isolates_cogs(company_tenant_with_gl):
    s1 = Station.objects.create(
        company_id=company_tenant_with_gl.id, station_name="COGS Site 1", is_active=True
    )
    s2 = Station.objects.create(
        company_id=company_tenant_with_gl.id, station_name="COGS Site 2", is_active=True
    )
    cogs = ChartOfAccount.objects.get(
        company_id=company_tenant_with_gl.id, account_code="5100"
    )
    cash = ChartOfAccount.objects.get(
        company_id=company_tenant_with_gl.id, account_code="1010"
    )
    for st, amt in ((s1, Decimal("30")), (s2, Decimal("70"))):
        je = JournalEntry.objects.create(
            company_id=company_tenant_with_gl.id,
            entry_number=f"COGS-ST-{st.id}",
            entry_date=date(2026, 5, 5),
            station_id=st.id,
            is_posted=True,
            posted_at=timezone.now(),
        )
        JournalEntryLine.objects.create(
            journal_entry=je, account=cogs, station_id=st.id, debit=amt, credit=Decimal("0")
        )
        JournalEntryLine.objects.create(
            journal_entry=je,
            account=cash,
            station_id=st.id,
            debit=Decimal("0"),
            credit=amt,
        )

    pl1 = report_income_statement(
        company_tenant_with_gl.id, date(2026, 5, 1), date(2026, 5, 31), station_id=s1.id
    )
    pl2 = report_income_statement(
        company_tenant_with_gl.id, date(2026, 5, 1), date(2026, 5, 31), station_id=s2.id
    )
    assert Decimal(str(pl1["cost_of_goods_sold"]["total"])) == Decimal("30.00")
    assert Decimal(str(pl2["cost_of_goods_sold"]["total"])) == Decimal("70.00")

    exp = report_expense_detail(
        company_tenant_with_gl.id, date(2026, 5, 1), date(2026, 5, 31), station_id=s1.id
    )
    assert "5100" not in {a["account_code"] for a in exp["expenses"]["accounts"]}
