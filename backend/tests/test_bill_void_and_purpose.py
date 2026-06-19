"""Vendor bill void rollback, bill_purpose validation, shared-split categories."""
from __future__ import annotations

import json
from decimal import Decimal

import pytest

from api.models import AquaculturePond, Bill, ChartOfAccount, Company, JournalEntry, Vendor
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts


@pytest.mark.django_db
def test_void_open_bill_reverses_auto_gl(api_client, company_tenant, auth_admin_headers):
    vendor = Vendor.objects.filter(company_id=company_tenant.id).first()
    if vendor is None:
        vendor = Vendor.objects.create(
            company_id=company_tenant.id,
            company_name="Test Vendor",
            display_name="Test Vendor",
            vendor_number="V-VOID",
            is_active=True,
        )
    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-05-12",
                "status": "open",
                "bill_purpose": "office",
                "lines": [
                    {
                        "description": "Office supplies",
                        "quantity": 1,
                        "unit_cost": "250.00",
                        "amount": "250.00",
                    }
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content
    bill_id = r.json()["id"]
    bill = Bill.objects.get(pk=bill_id)
    je_ref = f"AUTO-BILL-{bill_id}"
    had_je = JournalEntry.objects.filter(
        company_id=company_tenant.id, entry_number=je_ref
    ).exists()
    had_ap = bool(bill.vendor_ap_incremented)

    rv = api_client.put(
        f"/api/bills/{bill_id}/",
        data=json.dumps({"status": "void"}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert rv.status_code == 200, rv.content
    assert rv.json()["status"] == "void"
    bill.refresh_from_db()
    if had_je:
        assert not JournalEntry.objects.filter(
            company_id=company_tenant.id, entry_number=je_ref
        ).exists()
    if had_ap:
        assert not bill.vendor_ap_incremented


@pytest.mark.django_db
def test_bill_purpose_station_rejects_pond_line(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    ensure_aquaculture_chart_accounts(company_tenant.id)
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="P-Reject", is_active=True
    )
    vendor = Vendor.objects.filter(company_id=company_tenant.id).first()
    if vendor is None:
        vendor = Vendor.objects.create(
            company_id=company_tenant.id,
            company_name="V",
            display_name="V",
            vendor_number="V-P",
            is_active=True,
        )
    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-05-12",
                "status": "draft",
                "bill_purpose": "station",
                "lines": [
                    {
                        "description": "Pond tag on station bill",
                        "quantity": 1,
                        "unit_cost": "100.00",
                        "amount": "100.00",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_expense_category": "electricity",
                    }
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400, r.content
    assert "station bills cannot tag a pond" in r.json()["detail"]


@pytest.mark.django_db
def test_shared_pond_split_rejects_worker_salary_category(
    api_client, company_tenant, auth_admin_headers
):
    Company.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    ensure_aquaculture_chart_accounts(company_tenant.id)
    p1 = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)
    p2 = AquaculturePond.objects.create(company_id=company_tenant.id, name="P2", is_active=True)
    vendor = Vendor.objects.filter(company_id=company_tenant.id).first()
    if vendor is None:
        vendor = Vendor.objects.create(
            company_id=company_tenant.id,
            company_name="V",
            display_name="V",
            vendor_number="V-S",
            is_active=True,
        )
    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-05-12",
                "status": "draft",
                "bill_purpose": "pond",
                "lines": [
                    {
                        "description": "Salary split",
                        "quantity": 1,
                        "unit_cost": "500.00",
                        "amount": "500.00",
                        "aquaculture_cost_mode": "shared_equal",
                        "shared_equal_pond_ids": [p1.id, p2.id],
                        "aquaculture_expense_category": "worker_salary",
                    }
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400, r.content
    assert "cannot be used on vendor bills" in r.json()["detail"]


@pytest.mark.django_db
def test_shared_pond_split_electricity_sets_cost_bucket(
    api_client, company_tenant, auth_admin_headers
):
    Company.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    ensure_aquaculture_chart_accounts(company_tenant.id)
    p1 = AquaculturePond.objects.create(company_id=company_tenant.id, name="PA", is_active=True)
    p2 = AquaculturePond.objects.create(company_id=company_tenant.id, name="PB", is_active=True)
    vendor = Vendor.objects.filter(company_id=company_tenant.id).first()
    if vendor is None:
        vendor = Vendor.objects.create(
            company_id=company_tenant.id,
            company_name="V",
            display_name="V",
            vendor_number="V-E",
            is_active=True,
        )
    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-05-12",
                "status": "draft",
                "bill_purpose": "pond",
                "lines": [
                    {
                        "description": "Shared power",
                        "quantity": 1,
                        "unit_cost": "200.00",
                        "amount": "200.00",
                        "aquaculture_cost_mode": "shared_equal",
                        "shared_equal_pond_ids": [p1.id, p2.id],
                        "aquaculture_expense_category": "electricity",
                    }
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content
    bill = Bill.objects.get(pk=r.json()["id"])
    for ln in bill.lines.all():
        assert ln.aquaculture_cost_bucket == "electricity"
        assert ln.aquaculture_pond_id is not None


@pytest.mark.django_db
def test_mixed_bill_purpose_allows_pond_and_station_lines(
    api_client, company_tenant, auth_admin_headers
):
    Company.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    ensure_aquaculture_chart_accounts(company_tenant.id)
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="P-Mixed", is_active=True
    )
    vendor = Vendor.objects.filter(company_id=company_tenant.id).first()
    if vendor is None:
        vendor = Vendor.objects.create(
            company_id=company_tenant.id,
            company_name="V",
            display_name="V",
            vendor_number="V-MIX",
            is_active=True,
        )
    station = company_tenant.stations.filter(is_active=True).first()
    if station is None:
        from api.models import Station

        station = Station.objects.create(
            company_id=company_tenant.id, station_name="Mixed Test Station", is_active=True
        )
    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-05-12",
                "status": "draft",
                "bill_purpose": "mixed",
                "lines": [
                    {
                        "description": "Pond electricity",
                        "quantity": 1,
                        "unit_cost": "100.00",
                        "amount": "100.00",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_expense_category": "electricity",
                    },
                    {
                        "description": "Station utilities",
                        "quantity": 1,
                        "unit_cost": "50.00",
                        "amount": "50.00",
                        "line_receipt_station_id": station.id,
                        "fuel_station_expense_category": "utilities",
                    },
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
