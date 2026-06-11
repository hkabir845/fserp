"""Tenant-defined reporting categories (Aquaculture + Fuel station)."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import AquacultureFishSale, AquaculturePond, Company, Vendor
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts


@pytest.mark.django_db
def test_tenant_aquaculture_expense_category_end_to_end(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)

    r0 = api_client.post(
        "/api/reporting-categories/",
        data=json.dumps(
            {
                "application": "aquaculture",
                "kind": "expense",
                "label": "Site security",
                "maps_to_code": "electricity",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r0.status_code == 201
    cat_code = json.loads(r0.content.decode())["code"]
    assert cat_code == "aqe001"

    r1 = api_client.get("/api/aquaculture/expense-categories/", **auth_admin_headers)
    assert r1.status_code == 200
    rows = json.loads(r1.content.decode())
    sec = next((x for x in rows if x.get("id") == cat_code), None)
    assert sec is not None
    assert sec.get("tenant_defined") is True
    assert sec.get("maps_to_code") == "electricity"

    ensure_aquaculture_chart_accounts(company_tenant.id)
    vendor = Vendor.objects.filter(company_id=company_tenant.id).first()
    if vendor is None:
        vendor = Vendor.objects.create(
            company_id=company_tenant.id,
            company_name="Security Vendor",
            display_name="Security Vendor",
            vendor_number="V-SEC-1",
            is_active=True,
        )

    blocked = api_client.post(
        "/api/aquaculture/expenses/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "expense_category": cat_code,
                "expense_date": "2026-05-01",
                "amount": "50.00",
                "memo": "CCTV maintenance",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert blocked.status_code == 400
    assert "vendor bill" in blocked.content.decode().lower()

    r2 = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-05-01",
                "status": "open",
                "lines": [
                    {
                        "description": "CCTV maintenance",
                        "quantity": 1,
                        "unit_cost": "50.00",
                        "amount": "50.00",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_expense_category": cat_code,
                    }
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r2.status_code == 201, r2.content.decode()
    line = json.loads(r2.content.decode())["lines"][0]
    assert line["aquaculture_cost_bucket"] == "electricity"
    assert line["aquaculture_expense_category"] == cat_code
    assert line.get("tenant_reporting_category_id")


@pytest.mark.django_db
def test_tenant_aquaculture_income_type_sale(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)
    from api.models import AquacultureFishStockLedger

    AquacultureFishStockLedger.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        entry_date=date(2026, 5, 1),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=100,
        weight_kg_delta=Decimal("20"),
        memo="Opening stock for custom income sale test",
    )

    inc = api_client.post(
        "/api/reporting-categories/",
        data=json.dumps(
            {
                "application": "aquaculture",
                "kind": "income",
                "label": "Pond tour fees",
                "maps_to_code": "other_income",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert inc.status_code == 201
    income_code = json.loads(inc.content.decode())["code"]
    assert income_code == "aqi001"

    r = api_client.post(
        "/api/aquaculture/sales/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "income_type": income_code,
                "fish_species": "tilapia",
                "sale_date": "2026-05-02",
                "weight_kg": "10",
                "fish_count": 5,
                "total_amount": "200.00",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201
    sale = AquacultureFishSale.objects.get(pk=json.loads(r.content.decode())["id"])
    assert sale.income_type == income_code


@pytest.mark.django_db
def test_reporting_category_map_targets_enriched(api_client, company_tenant, auth_admin_headers):
    ensure_aquaculture_chart_accounts(company_tenant.id)
    r = api_client.get(
        "/api/reporting-categories/map-targets/",
        {"application": "aquaculture", "kind": "expense"},
        **auth_admin_headers,
    )
    assert r.status_code == 200
    targets = json.loads(r.content.decode())["map_targets"]
    assert len(targets) >= 17
    mortality = next(t for t in targets if t["id"] == "mortality")
    assert mortality["group"] == "Mortality & shrinkage"
    assert mortality.get("coa_code") == "6726"
    electricity = next(t for t in targets if t["id"] == "electricity")
    assert electricity["group"] == "Power, equipment & repairs"
    assert electricity.get("hint")
    assert electricity.get("coa_code")

    r2 = api_client.get(
        "/api/reporting-categories/map-targets/",
        {"application": "fuel_station", "kind": "expense"},
        **auth_admin_headers,
    )
    assert r2.status_code == 200
    fuel = json.loads(r2.content.decode())["map_targets"]
    fuel_ids = {t["id"] for t in fuel}
    assert "operating" in fuel_ids
    assert "payroll" in fuel_ids
    assert "cost_of_sales" in fuel_ids
    assert "shop_shrink" in fuel_ids
    assert "utilities" in fuel_ids
    assert "water_sewer" in fuel_ids
    assert len(fuel_ids) >= 21
    payroll = next(t for t in fuel if t["id"] == "payroll")
    assert payroll["group"] == "Payroll & occupancy"
    assert payroll.get("coa_code") == "6400"
    utilities = next(t for t in fuel if t["id"] == "utilities")
    assert utilities["group"] == "Facility & upkeep"
    assert "generator" in (utilities.get("hint") or "").lower()

    r3 = api_client.get(
        "/api/reporting-categories/map-targets/",
        {"application": "fuel_station", "kind": "income"},
        **auth_admin_headers,
    )
    assert r3.status_code == 200
    fuel_income = json.loads(r3.content.decode())["map_targets"]
    assert {t["id"] for t in fuel_income} >= {
        "fuel_revenue",
        "diesel_revenue",
        "fleet_revenue",
        "shop_revenue",
        "services_revenue",
        "other",
    }
    fleet = next(t for t in fuel_income if t["id"] == "fleet_revenue")
    assert fleet.get("coa_code") == "4140"


@pytest.mark.django_db
def test_reporting_category_edit_propagates_to_bill_and_journal(
    api_client, company_tenant, auth_admin_headers
):
    from api.models import BillLine, JournalEntry, JournalEntryLine

    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    ensure_aquaculture_chart_accounts(company_tenant.id)
    from tests.conftest import seed_min_gl_accounts

    seed_min_gl_accounts(company_tenant)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)
    vendor = Vendor.objects.filter(company_id=company_tenant.id).first()
    if vendor is None:
        vendor = Vendor.objects.create(
            company_id=company_tenant.id,
            company_name="Security Vendor",
            display_name="Security Vendor",
            vendor_number="V-SEC-2",
            is_active=True,
        )

    create = api_client.post(
        "/api/reporting-categories/",
        data=json.dumps(
            {
                "application": "aquaculture",
                "kind": "expense",
                "label": "Site security",
                "maps_to_code": "electricity",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert create.status_code == 201
    created = json.loads(create.content.decode())
    cat_id = created["id"]
    cat_code = created["code"]

    bill = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-05-01",
                "status": "open",
                "lines": [
                    {
                        "description": "CCTV maintenance",
                        "quantity": 1,
                        "unit_cost": "50.00",
                        "amount": "50.00",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_expense_category": cat_code,
                    }
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert bill.status_code == 201, bill.content.decode()
    bill_id = json.loads(bill.content.decode())["id"]
    line = BillLine.objects.get(bill_id=bill_id)
    assert line.tenant_reporting_category_id == cat_id
    assert line.aquaculture_cost_bucket == "electricity"

    upd = api_client.put(
        f"/api/reporting-categories/{cat_id}/",
        data=json.dumps(
            {
                "label": "Site security & CCTV",
                "maps_to_code": "other",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert upd.status_code == 200, upd.content.decode()
    body = json.loads(upd.content.decode())
    assert body["label"] == "Site security & CCTV"
    prop = body.get("propagation", {})
    assert prop.get("bill_lines_updated", 0) >= 1
    assert prop.get("journal_lines_updated", 0) >= 1 or prop.get("bills_resynced", 0) >= 1

    line.refresh_from_db()
    assert line.aquaculture_cost_bucket == "miscellaneous"
    assert line.tenant_reporting_category_id == cat_id

    je = JournalEntry.objects.filter(entry_number=f"AUTO-BILL-{bill_id}").first()
    assert je is not None
    jl = JournalEntryLine.objects.filter(journal_entry_id=je.id, debit__gt=0).first()
    assert jl is not None
    assert jl.aquaculture_cost_bucket == "miscellaneous"


@pytest.mark.django_db
def test_reporting_category_auto_code_gap_fill(api_client, company_tenant, auth_admin_headers):
    payload = {
        "application": "aquaculture",
        "kind": "expense",
        "label": "First",
        "maps_to_code": "electricity",
    }
    r1 = api_client.post(
        "/api/reporting-categories/",
        data=json.dumps(payload),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r1.status_code == 201
    assert json.loads(r1.content.decode())["code"] == "aqe001"

    r2 = api_client.post(
        "/api/reporting-categories/",
        data=json.dumps({**payload, "label": "Second"}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r2.status_code == 201
    assert json.loads(r2.content.decode())["code"] == "aqe002"

    cat1_id = json.loads(r1.content.decode())["id"]
    assert api_client.delete(f"/api/reporting-categories/{cat1_id}/", **auth_admin_headers).status_code == 200

    r3 = api_client.post(
        "/api/reporting-categories/",
        data=json.dumps({**payload, "label": "Third"}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r3.status_code == 201
    assert json.loads(r3.content.decode())["code"] == "aqe001"


@pytest.mark.django_db
def test_reporting_categories_non_admin_forbidden(api_client, company_tenant, auth_accountant_headers):
    r = api_client.post(
        "/api/reporting-categories/",
        data=json.dumps(
            {
                "application": "fuel_station",
                "kind": "expense",
                "label": "Misc",
                "maps_to_code": "other",
            }
        ),
        content_type="application/json",
        **auth_accountant_headers,
    )
    assert r.status_code == 403
