"""Fuel-station reporting categories on vendor bill lines."""
from __future__ import annotations

import json

import pytest

from api.models import BillLine, ChartOfAccount, JournalEntry, JournalEntryLine, Vendor

from tests.conftest import seed_min_gl_accounts


@pytest.mark.django_db
def test_fuel_station_expense_categories_api(api_client, company_tenant, auth_admin_headers):
    from tests.conftest import seed_min_gl_accounts

    seed_min_gl_accounts(company_tenant)
    ChartOfAccount.objects.get_or_create(
        company_id=company_tenant.id,
        account_code="6100",
        defaults={"account_name": "Utilities", "account_type": "expense", "is_active": True},
    )
    ChartOfAccount.objects.get_or_create(
        company_id=company_tenant.id,
        account_code="6920",
        defaults={
            "account_name": "General Station Operating",
            "account_type": "expense",
            "is_active": True,
        },
    )
    r = api_client.get("/api/fuel-station/expense-categories/", **auth_admin_headers)
    assert r.status_code == 200
    rows = json.loads(r.content.decode())
    assert any(x.get("id") == "utilities" for x in rows)
    assert any(x.get("id") == "operating" for x in rows)
    utilities = next(x for x in rows if x.get("id") == "utilities")
    assert utilities.get("default_coa_account_code") == "6100"
    operating = next(x for x in rows if x.get("id") == "operating")
    assert operating.get("default_coa_account_code") == "6920"


@pytest.mark.django_db
def test_bill_utilities_category_auto_suggests_6100(api_client, company_tenant, auth_admin_headers):
    from tests.conftest import seed_min_gl_accounts

    seed_min_gl_accounts(company_tenant)
    util_acc, _ = ChartOfAccount.objects.get_or_create(
        company_id=company_tenant.id,
        account_code="6100",
        defaults={"account_name": "Utilities", "account_type": "expense", "is_active": True},
    )
    vendor = Vendor.objects.filter(company_id=company_tenant.id, is_active=True).first()
    if vendor is None:
        vendor = Vendor.objects.create(
            company_id=company_tenant.id,
            company_name="Fuel Test Vendor",
            display_name="Fuel Test Vendor",
            vendor_number="V-FUEL-FS2",
            is_active=True,
        )
    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-05-11",
                "status": "open",
                "lines": [
                    {
                        "description": "Grid power bill",
                        "quantity": 1,
                        "unit_cost": "250.00",
                        "amount": "250.00",
                        "fuel_station_expense_category": "utilities",
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
    assert line.fuel_station_expense_category == "utilities"
    assert line.expense_account_id == util_acc.id

    je = JournalEntry.objects.filter(entry_number=f"AUTO-BILL-{bill_id}").first()
    assert je is not None
    jl = JournalEntryLine.objects.filter(journal_entry_id=je.id, debit__gt=0).first()
    assert jl is not None
    assert jl.account_id == util_acc.id


@pytest.mark.django_db
def test_bill_line_fuel_category_posts_to_journal(api_client, company_tenant, auth_admin_headers):
    seed_min_gl_accounts(company_tenant)
    cat = api_client.post(
        "/api/reporting-categories/",
        data=json.dumps(
            {
                "application": "fuel_station",
                "kind": "expense",
                "label": "Generator diesel",
                "maps_to_code": "utilities",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert cat.status_code == 201
    fuel_cat_code = json.loads(cat.content.decode())["code"]
    assert fuel_cat_code == "fse001"
    vendor = Vendor.objects.filter(company_id=company_tenant.id, is_active=True).first()
    if vendor is None:
        vendor = Vendor.objects.create(
            company_id=company_tenant.id,
            company_name="Fuel Test Vendor",
            display_name="Fuel Test Vendor",
            vendor_number="V-FUEL-FS",
            is_active=True,
        )
    vendor_id = vendor.id
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
                        "fuel_station_expense_category": fuel_cat_code,
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
    assert line.fuel_station_expense_category == fuel_cat_code
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
