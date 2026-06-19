"""Vendor bills at aquaculture shop hubs (Premium Agro) use aquaculture categories, not fuel."""
from __future__ import annotations

import json

import pytest

from api.models import AquaculturePond, Bill, Company, Station, Vendor
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts


@pytest.mark.django_db
def test_shop_hub_bill_uses_aquaculture_expense_category(
    api_client, company_tenant, auth_admin_headers
):
    Company.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    ensure_aquaculture_chart_accounts(company_tenant.id)
    shop = Station.objects.create(
        company_id=company_tenant.id,
        station_name="Premium Agro",
        station_number="STN-5",
        is_active=True,
        operates_fuel_retail=False,
    )
    vendor = Vendor.objects.filter(company_id=company_tenant.id).first()
    if vendor is None:
        vendor = Vendor.objects.create(
            company_id=company_tenant.id,
            company_name="Feed Co",
            display_name="Feed Co",
            vendor_number="V-FEED",
            is_active=True,
        )

    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-06-01",
                "status": "draft",
                "bill_purpose": "pond",
                "receipt_station_id": shop.id,
                "lines": [
                    {
                        "description": "Floating feed 32%",
                        "quantity": 1,
                        "unit_cost": "45000.00",
                        "amount": "45000.00",
                        "line_receipt_station_id": shop.id,
                        "aquaculture_expense_category": "feed_purchase",
                    }
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content
    bill = Bill.objects.get(pk=r.json()["id"])
    line = bill.lines.get()
    assert line.receipt_station_id == shop.id
    assert line.aquaculture_pond_id is None
    assert line.aquaculture_cost_bucket == "feed"
    assert line.fuel_station_expense_category == ""
    assert r.json()["lines"][0]["aquaculture_expense_category"] == "feed_purchase"


@pytest.mark.django_db
def test_shop_hub_bill_rejects_fuel_station_category(
    api_client, company_tenant, auth_admin_headers
):
    Company.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    shop = Station.objects.create(
        company_id=company_tenant.id,
        station_name="Premium Agro",
        is_active=True,
        operates_fuel_retail=False,
    )
    vendor = Vendor.objects.filter(company_id=company_tenant.id).first()
    if vendor is None:
        vendor = Vendor.objects.create(
            company_id=company_tenant.id,
            company_name="V",
            display_name="V",
            vendor_number="V-SH",
            is_active=True,
        )
    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-06-01",
                "status": "draft",
                "lines": [
                    {
                        "description": "Wrong category",
                        "quantity": 1,
                        "unit_cost": "100.00",
                        "amount": "100.00",
                        "line_receipt_station_id": shop.id,
                        "fuel_station_expense_category": "utilities",
                    }
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400, r.content
    assert "shop" in r.json()["detail"].lower()


@pytest.mark.django_db
def test_mixed_bill_pond_and_shop_hub_lines(
    api_client, company_tenant, auth_admin_headers
):
    Company.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    ensure_aquaculture_chart_accounts(company_tenant.id)
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Pond A", is_active=True
    )
    shop = Station.objects.create(
        company_id=company_tenant.id,
        station_name="Premium Agro",
        is_active=True,
        operates_fuel_retail=False,
    )
    fuel = Station.objects.create(
        company_id=company_tenant.id,
        station_name="Fuel Site",
        is_active=True,
        operates_fuel_retail=True,
    )
    vendor = Vendor.objects.filter(company_id=company_tenant.id).first()
    if vendor is None:
        vendor = Vendor.objects.create(
            company_id=company_tenant.id,
            company_name="V",
            display_name="V",
            vendor_number="V-MX",
            is_active=True,
        )
    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-06-01",
                "status": "draft",
                "bill_purpose": "mixed",
                "lines": [
                    {
                        "description": "Pond power",
                        "quantity": 1,
                        "unit_cost": "200.00",
                        "amount": "200.00",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_expense_category": "electricity",
                    },
                    {
                        "description": "Shop feed stock",
                        "quantity": 1,
                        "unit_cost": "1000.00",
                        "amount": "1000.00",
                        "line_receipt_station_id": shop.id,
                        "aquaculture_expense_category": "feed_purchase",
                    },
                    {
                        "description": "Fuel site utilities",
                        "quantity": 1,
                        "unit_cost": "50.00",
                        "amount": "50.00",
                        "line_receipt_station_id": fuel.id,
                        "fuel_station_expense_category": "utilities",
                    },
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content
    assert Bill.objects.get(pk=r.json()["id"]).lines.count() == 3
