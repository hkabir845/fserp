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
                "code": "site_security",
                "label": "Site security",
                "maps_to_code": "electricity",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r0.status_code == 201

    r1 = api_client.get("/api/aquaculture/expense-categories/", **auth_admin_headers)
    assert r1.status_code == 200
    rows = json.loads(r1.content.decode())
    sec = next((x for x in rows if x.get("id") == "site_security"), None)
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
                "expense_category": "site_security",
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
                        "aquaculture_expense_category": "site_security",
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
    assert line["aquaculture_expense_category"] == "electricity"


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

    api_client.post(
        "/api/reporting-categories/",
        data=json.dumps(
            {
                "application": "aquaculture",
                "kind": "income",
                "code": "pond_tour_fees",
                "label": "Pond tour fees",
                "maps_to_code": "other_income",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )

    r = api_client.post(
        "/api/aquaculture/sales/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "income_type": "pond_tour_fees",
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
    assert sale.income_type == "pond_tour_fees"


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
    assert len(targets) >= 15
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
    assert {t["id"] for t in fuel} == {
        "operating",
        "cost_of_sales",
        "maintenance",
        "utilities",
        "other",
    }
    utilities = next(t for t in fuel if t["id"] == "utilities")
    assert utilities["group"] == "Facility & upkeep"
    assert "generator" in (utilities.get("hint") or "").lower()


@pytest.mark.django_db
def test_reporting_categories_non_admin_forbidden(api_client, company_tenant, auth_accountant_headers):
    r = api_client.post(
        "/api/reporting-categories/",
        data=json.dumps(
            {
                "application": "fuel_station",
                "kind": "expense",
                "code": "misc_tag",
                "label": "Misc",
                "maps_to_code": "other",
            }
        ),
        content_type="application/json",
        **auth_accountant_headers,
    )
    assert r.status_code == 403
