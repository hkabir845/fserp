"""Tenant-defined reporting categories (Aquaculture + Fuel station)."""
from __future__ import annotations

import json

import pytest

from api.models import AquacultureExpense, AquacultureFishSale, AquaculturePond, Company


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

    r2 = api_client.post(
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
    assert r2.status_code == 201
    body = json.loads(r2.content.decode())
    assert body.get("expense_category") == "site_security"
    assert "Site security" in (body.get("expense_category_label") or "")

    exp = AquacultureExpense.objects.get(pk=body["id"])
    assert exp.expense_category == "site_security"


@pytest.mark.django_db
def test_tenant_aquaculture_income_type_sale(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)

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
