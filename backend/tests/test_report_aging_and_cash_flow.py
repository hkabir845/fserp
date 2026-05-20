"""Tests for AR/AP aging and cash flow reports."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import Bill, Customer, Invoice, Station, Vendor
from api.services.reporting import (
    report_ap_aging,
    report_ar_aging,
    report_cash_flow,
    report_entities_balance_sheet_summary,
    report_entities_pl_summary,
    report_entities_trial_balance_summary,
    report_financial_analytics,
    report_stations_financial_summary,
)


@pytest.mark.django_db
def test_ar_aging_buckets_open_invoice(company_tenant):
    cid = company_tenant.id
    cust = Customer.objects.create(
        company_id=cid,
        display_name="Aging Customer",
        customer_number="C-AGE-1",
        current_balance=Decimal("0"),
    )
    Invoice.objects.create(
        company_id=cid,
        customer=cust,
        invoice_number="INV-AGE-1",
        invoice_date=date(2026, 1, 1),
        due_date=date(2026, 1, 15),
        status="sent",
        total=Decimal("1000.00"),
    )
    out = report_ar_aging(cid, date(2026, 1, 1), date(2026, 2, 1))
    assert out["report_id"] == "ar-aging"
    assert len(out["customers"]) == 1
    row = out["customers"][0]
    assert row["display_name"] == "Aging Customer"
    assert row["total"] == 1000.0
    assert row["days_1_30"] == 1000.0


@pytest.mark.django_db
def test_ap_aging_buckets_open_bill(company_tenant):
    cid = company_tenant.id
    vendor = Vendor.objects.create(
        company_id=cid,
        company_name="Aging Vendor",
        vendor_number="V-AGE-1",
        current_balance=Decimal("0"),
    )
    Bill.objects.create(
        company_id=cid,
        vendor=vendor,
        bill_number="BILL-AGE-1",
        bill_date=date(2026, 3, 1),
        due_date=date(2026, 3, 10),
        status="open",
        total=Decimal("500.00"),
    )
    out = report_ap_aging(cid, date(2026, 3, 1), date(2026, 4, 1))
    assert out["report_id"] == "ap-aging"
    assert len(out["vendors"]) == 1
    assert out["vendors"][0]["total"] == 500.0


@pytest.mark.django_db
def test_stations_financial_summary_includes_company_total(company_tenant):
    cid = company_tenant.id
    st = Station.objects.create(company_id=cid, station_name="Test Site", is_active=True)
    out = report_stations_financial_summary(cid, date(2026, 1, 1), date(2026, 1, 31))
    assert out["report_id"] == "stations-financial-summary"
    assert "company_total" in out
    assert any(s["station_id"] == st.id for s in out["stations"])


@pytest.mark.django_db
def test_cash_flow_includes_all_entities(company_tenant):
    cid = company_tenant.id
    st = Station.objects.create(company_id=cid, station_name="CF Site", is_active=True)
    out = report_cash_flow(cid, date(2026, 1, 1), date(2026, 1, 31), station_id=None)
    assert out["report_id"] == "cash-flow"
    assert "by_station" in out
    assert "by_pond" in out
    assert "unscoped" in out
    assert any(r["entity_id"] == st.id for r in out["by_station"])


@pytest.mark.django_db
def test_financial_analytics_includes_ponds(company_tenant):
    from api.models import AquaculturePond

    cid = company_tenant.id
    AquaculturePond.objects.create(company_id=cid, name="Analytics Pond", is_active=True)
    out = report_financial_analytics(cid, date(2026, 1, 1), date(2026, 1, 31))
    assert out["report_id"] == "financial-analytics"
    assert "by_pond" in out
    assert len(out["by_pond"]) >= 1
    assert out["aquaculture_summary"]["active_ponds"] >= 1


@pytest.mark.django_db
def test_financial_analytics_pond_filter(company_tenant):
    from api.models import AquaculturePond

    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="KPI Pond", is_active=True)
    out = report_financial_analytics(cid, date(2026, 1, 1), date(2026, 1, 31), pond_id=pond.id)
    assert out["filter_pond_id"] == pond.id
    assert out["filter_pond_name"] == "KPI Pond"
    assert "by_station" not in out
    assert "by_pond" not in out
    assert out["pond_scope"]["entity_id"] == pond.id


@pytest.mark.django_db
def test_entities_separate_reports(company_tenant):
    cid = company_tenant.id
    st = Station.objects.create(company_id=cid, station_name="Entity Site", is_active=True)
    start, end = date(2026, 1, 1), date(2026, 1, 31)
    pl = report_entities_pl_summary(cid, start, end)
    bs = report_entities_balance_sheet_summary(cid, start, end)
    tb = report_entities_trial_balance_summary(cid, start, end)
    assert pl["report_id"] == "entities-pl-summary"
    assert bs["report_id"] == "entities-balance-sheet-summary"
    assert tb["report_id"] == "entities-trial-balance-summary"
    pl_row = next(r for r in pl["by_station"] if r["station_id"] == st.id)
    assert "net_income" in pl_row
    assert "total_assets" not in pl_row
    bs_row = next(r for r in bs["by_station"] if r["station_id"] == st.id)
    assert "total_assets" in bs_row
    assert "net_income" not in bs_row
    tb_row = next(r for r in tb["by_station"] if r["station_id"] == st.id)
    assert "trial_balance_debit" in tb_row
