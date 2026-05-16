"""Fuel-station reporting categories on vendor bill lines."""
from __future__ import annotations

import json

import pytest

from api.models import BillLine, JournalEntry, JournalEntryLine


@pytest.mark.django_db
def test_fuel_station_expense_categories_api(api_client, company_tenant, auth_admin_headers):
    r = api_client.get("/api/fuel-station/expense-categories/", **auth_admin_headers)
    assert r.status_code == 200
    rows = json.loads(r.content.decode())
    assert any(x.get("id") == "utilities" for x in rows)
    assert any(x.get("id") == "operating" for x in rows)


@pytest.mark.django_db
def test_bill_line_fuel_category_posts_to_journal(api_client, company_tenant, auth_admin_headers):
    api_client.post(
        "/api/reporting-categories/",
        data=json.dumps(
            {
                "application": "fuel_station",
                "kind": "expense",
                "code": "generator_diesel",
                "label": "Generator diesel",
                "maps_to_code": "utilities",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    vendors = json.loads(api_client.get("/api/vendors/", **auth_admin_headers).content.decode())
    vendor_id = vendors[0]["id"] if vendors else None
    if not vendor_id:
        pytest.skip("no vendors")
    coa = json.loads(api_client.get("/api/chart-of-accounts/", **auth_admin_headers).content.decode())
    exp = next((a for a in coa if (a.get("account_type") or "").lower() == "expense"), None)
    assert exp

    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "bill_date": "2026-05-10",
                "status": "open",
                "lines": [
                    {
                        "description": "Site generator fuel",
                        "quantity": 1,
                        "unit_cost": "100.00",
                        "amount": "100.00",
                        "expense_account_id": exp["id"],
                        "fuel_station_expense_category": "generator_diesel",
                    }
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    bill_id = json.loads(r.content.decode())["id"]
    line = BillLine.objects.filter(bill_id=bill_id).first()
    assert line is not None
    assert line.fuel_station_expense_category == "generator_diesel"
    assert line.tenant_reporting_category_id is not None

    je = JournalEntry.objects.filter(entry_number=f"AUTO-BILL-{bill_id}").first()
    assert je is not None
    jl = JournalEntryLine.objects.filter(journal_entry_id=je.id, debit__gt=0).first()
    assert jl is not None
    assert jl.tenant_reporting_category_id == line.tenant_reporting_category_id


@pytest.mark.django_db
def test_bill_rejects_fuel_and_pond_on_same_line(api_client, company_tenant, auth_admin_headers):
    from api.models import AquaculturePond, Company, Vendor

    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)
    vendor = Vendor.objects.create(
        company_id=company_tenant.id,
        vendor_number="V-TEST-FS",
        company_name="Test Vendor",
        is_active=True,
    )
    vendor_id = vendor.id

    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "bill_date": "2026-05-10",
                "status": "draft",
                "lines": [
                    {
                        "description": "Conflict",
                        "quantity": 1,
                        "unit_cost": "10",
                        "amount": "10",
                        "aquaculture_pond_id": pond.id,
                        "fuel_station_expense_category": "utilities",
                    }
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400
