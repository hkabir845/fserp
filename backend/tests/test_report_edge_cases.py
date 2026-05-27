"""
Edge cases for report APIs: dates, empty COA, site filters, invalid params, wide ranges.
Complements test_reports_all_smoke.py (happy-path 200 + report_id).
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest
from django.utils import timezone

from tests.test_api_production_audit import _audit_master_headers

pytestmark = pytest.mark.django_db


def test_report_dates_normalized_when_start_after_end(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    r = api_client.get(
        "/api/reports/income-statement/",
        {"start_date": "2026-06-30", "end_date": "2026-01-01"},
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    data = json.loads(r.content)
    period = data["period"]
    assert period["start_date"] <= period["end_date"]
    assert period["start_date"] == "2026-01-01"
    assert period["end_date"] == "2026-06-30"


def test_income_statement_empty_chart_returns_valid_payload(
    api_client, company_tenant, auth_admin_headers
):
    r = api_client.get(
        "/api/reports/income-statement/",
        {"start_date": "2026-01-01", "end_date": "2026-01-31"},
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    data = json.loads(r.content)
    assert data["report_id"] == "income-statement"
    assert Decimal(str(data["income"]["total"])) == Decimal("0")
    assert Decimal(str(data["cost_of_goods_sold"]["total"])) == Decimal("0")
    assert Decimal(str(data["expenses"]["total"])) == Decimal("0")
    assert Decimal(str(data["net_income"])) == Decimal("0")


def test_income_statement_station_filter_scopes_totals(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    from api.models import ChartOfAccount, JournalEntry, JournalEntryLine, Station

    st_a = Station.objects.create(
        company_id=company_tenant_with_gl.id, station_name="Filter A", is_active=True
    )
    st_b = Station.objects.create(
        company_id=company_tenant_with_gl.id, station_name="Filter B", is_active=True
    )
    income = ChartOfAccount.objects.get(
        company_id=company_tenant_with_gl.id, account_code="4100"
    )
    cash = ChartOfAccount.objects.get(company_id=company_tenant_with_gl.id, account_code="1010")

    def post_income(station_id: int, amount: str, tag: str):
        je = JournalEntry.objects.create(
            company_id=company_tenant_with_gl.id,
            entry_number=f"IS-FILT-{tag}",
            entry_date=date(2026, 5, 10),
            station_id=station_id,
            description="edge",
            is_posted=True,
            posted_at=timezone.now(),
        )
        JournalEntryLine.objects.create(
            journal_entry=je,
            account=income,
            station_id=station_id,
            debit=Decimal("0"),
            credit=Decimal(amount),
        )
        JournalEntryLine.objects.create(
            journal_entry=je,
            account=cash,
            station_id=station_id,
            debit=Decimal(amount),
            credit=Decimal("0"),
        )

    post_income(st_a.id, "100", "A")
    post_income(st_b.id, "50", "B")

    r = api_client.get(
        "/api/reports/income-statement/",
        {
            "start_date": "2026-05-01",
            "end_date": "2026-05-31",
            "station_id": str(st_a.id),
        },
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    data = json.loads(r.content)
    assert data.get("filter_station_id") == st_a.id
    assert Decimal(str(data["income"]["total"])) == Decimal("100.00")
    note = (data.get("accounting_note") or "").lower()
    assert "site" in note or "station" in note


def test_sales_report_invalid_business_segment_400(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    r = api_client.get(
        "/api/reports/sales-report/",
        {
            "start_date": "2026-01-01",
            "end_date": "2026-01-31",
            "business_segment": "invalid",
        },
        **auth_admin_headers,
    )
    assert r.status_code == 400
    assert "business_segment" in json.loads(r.content).get("detail", "").lower()


def test_wide_date_range_income_statement_still_ok(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    r = api_client.get(
        "/api/reports/income-statement/",
        {"start_date": "2020-01-01", "end_date": "2026-12-31"},
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    assert json.loads(r.content).get("report_id") == "income-statement"


def test_aquaculture_report_when_aquaculture_disabled_returns_403(
    api_client, auth_super_headers, company_master
):
    company_master.__class__.objects.filter(pk=company_master.id).update(
        aquaculture_enabled=False,
        aquaculture_licensed=False,
    )
    h = _audit_master_headers(auth_super_headers, company_master)
    r = api_client.get(
        "/api/reports/aquaculture-pond-pl/",
        {"start_date": "2026-01-01", "end_date": "2026-01-31"},
        **h,
    )
    assert r.status_code == 403, r.content.decode()
    assert "aquaculture" in json.loads(r.content).get("detail", "").lower()


def test_ar_aging_empty_tenant_returns_zero_totals(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    r = api_client.get(
        "/api/reports/ar-aging/",
        {"start_date": "2026-01-01", "end_date": "2026-01-31"},
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    data = json.loads(r.content)
    assert data["report_id"] == "ar-aging"
    totals = data.get("totals") or {}
    assert Decimal(str(totals.get("total", 0))) == Decimal("0")
    assert data.get("customers") == []


def test_expense_detail_excludes_cogs_with_mixed_coa_types(company_tenant_with_gl):
    from api.models import ChartOfAccount
    from api.services.reporting import report_expense_detail

    ChartOfAccount.objects.get_or_create(
        company_id=company_tenant_with_gl.id,
        account_code="5999",
        defaults={
            "account_name": "Misc OpEx",
            "account_type": "expense",
            "is_active": True,
        },
    )
    out = report_expense_detail(
        company_tenant_with_gl.id,
        date(2026, 1, 1),
        date(2026, 12, 31),
        station_id=None,
    )
    codes = {a["account_code"] for a in out["expenses"]["accounts"]}
    assert "5100" not in codes
    assert "5120" not in codes
