"""Entity dimension tagging for per-station / per-pond financial reports."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest
from django.utils import timezone

from api.models import AquaculturePond, ChartOfAccount, JournalEntry, JournalEntryLine, Station
from api.services.entity_gl_scoping import audit_entity_gl_scoping, manual_je_entity_scoping_warnings
from api.services.reporting import report_income_statement

pytestmark = pytest.mark.django_db


def test_journal_post_rejects_unscoped_pl_line(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    """Posting blocks when income/COGS/expense lines lack station or pond."""
    cid = company_tenant_with_gl.id
    expense = ChartOfAccount.objects.get(company_id=cid, account_code="6900")
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")
    je = JournalEntry.objects.create(
        company_id=cid,
        entry_number="JE-BLOCK-SCOPE",
        entry_date=date(2026, 11, 8),
        is_posted=False,
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=expense, debit=Decimal("40"), credit=Decimal("0")
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=cash, debit=Decimal("0"), credit=Decimal("40")
    )

    r = api_client.post(
        f"/api/journal-entries/{je.id}/post/",
        data=json.dumps({}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400, r.content.decode()
    body = json.loads(r.content.decode())
    assert body.get("code") == "entity_scoping_required"
    je.refresh_from_db()
    assert je.is_posted is False


def test_journal_post_applies_header_station_to_unscoped_pl(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    """Default site on the entry is copied to untagged P&L lines at post time."""
    cid = company_tenant_with_gl.id
    st = Station.objects.create(company_id=cid, station_name="Post Default Site", is_active=True)
    expense = ChartOfAccount.objects.get(company_id=cid, account_code="6900")
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")
    je = JournalEntry.objects.create(
        company_id=cid,
        entry_number="JE-HEADER-STATION",
        entry_date=date(2026, 11, 9),
        station_id=st.id,
        is_posted=False,
    )
    exp_line = JournalEntryLine.objects.create(
        journal_entry=je, account=expense, debit=Decimal("75"), credit=Decimal("0")
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=cash, debit=Decimal("0"), credit=Decimal("75")
    )

    r = api_client.post(
        f"/api/journal-entries/{je.id}/post/",
        data=json.dumps({}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    exp_line.refresh_from_db()
    assert exp_line.station_id == st.id
    je.refresh_from_db()
    assert je.is_posted is True


def test_manual_je_with_pond_tag_appears_on_pond_pl_only(company_tenant_with_gl):
    """Manual journal lines tagged to a pond belong on that pond's P&L, not on station P&L."""
    cid = company_tenant_with_gl.id
    st = Station.objects.create(company_id=cid, station_name="Shop Hub", is_active=True)
    pond = AquaculturePond.objects.create(company_id=cid, name="Tagged Pond", is_active=True)
    expense = ChartOfAccount.objects.get(company_id=cid, account_code="6900")
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")

    je = JournalEntry.objects.create(
        company_id=cid,
        entry_number="JE-POND-MANUAL",
        entry_date=date(2026, 11, 5),
        station_id=st.id,
        is_posted=True,
        posted_at=timezone.now(),
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=expense,
        station_id=st.id,
        aquaculture_pond_id=pond.id,
        debit=Decimal("120"),
        credit=Decimal("0"),
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=cash,
        station_id=st.id,
        aquaculture_pond_id=pond.id,
        debit=Decimal("0"),
        credit=Decimal("120"),
    )

    start, end = date(2026, 11, 1), date(2026, 11, 30)
    pl_st = report_income_statement(cid, start, end, station_id=st.id)
    pl_pond = report_income_statement(cid, start, end, pond_id=pond.id)

    assert Decimal(str(pl_st["expenses"]["total"])) == Decimal("0")
    assert Decimal(str(pl_pond["expenses"]["total"])) == Decimal("120.00")


def test_manual_je_unscoped_pl_line_triggers_warning(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    expense = ChartOfAccount.objects.get(company_id=cid, account_code="6900")
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")
    je = JournalEntry.objects.create(
        company_id=cid,
        entry_number="JE-UNSCOPED",
        entry_date=date(2026, 11, 6),
        is_posted=False,
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=expense, debit=Decimal("50"), credit=Decimal("0")
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=cash, debit=Decimal("0"), credit=Decimal("50")
    )
    warnings = manual_je_entity_scoping_warnings(je)
    assert len(warnings) >= 1
    assert "no station or pond tag" in warnings[0].lower()


def test_audit_entity_gl_scoping_counts_unscoped_pl(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    income = ChartOfAccount.objects.get(company_id=cid, account_code="4200")
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")
    je = JournalEntry.objects.create(
        company_id=cid,
        entry_number="AUDIT-UNSCOPED",
        entry_date=date(2026, 11, 7),
        is_posted=True,
        posted_at=timezone.now(),
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=income, debit=Decimal("0"), credit=Decimal("10")
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=cash, debit=Decimal("10"), credit=Decimal("0")
    )
    out = audit_entity_gl_scoping(cid)
    assert out["unscoped_pl_line_count"] >= 1
