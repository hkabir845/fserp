"""Vendor bill lines: optional weight (kg) and fish count for fish-type items."""
from __future__ import annotations

import json
from decimal import Decimal

import pytest
from django.db.models import Sum

from api.models import AquaculturePond, Bill, Company, Item, ItemPondStock, ItemStationStock, Station
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows


@pytest.mark.django_db
def test_bill_persists_fish_weight_and_count_for_fish_pos_item(api_client, company_tenant, auth_admin_headers):
    h = auth_admin_headers
    v = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": "Hatchery"}),
        content_type="application/json",
        **h,
    )
    assert v.status_code == 201
    vendor_id = json.loads(v.content)["id"]

    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Nursing A", pond_role="nursing", is_active=True
    )
    fry = Item.objects.create(
        company_id=company_tenant.id,
        name="Tilapia Fry",
        item_type="inventory",
        pos_category="fish",
        unit="piece",
        category="Aquaculture",
    )

    bill_r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "bill_date": "2026-05-08",
                "subtotal": "100.00",
                "tax_total": "0",
                "total": "100.00",
                "status": "draft",
                "lines": [
                    {
                        "description": "Tilapia Fry",
                        "item_id": fry.id,
                        "quantity": "1",
                        "unit_cost": "100.00",
                        "amount": "100.00",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_fish_species": "tilapia",
                        "aquaculture_fish_weight_kg": "12.5",
                        "aquaculture_fish_count": 5000,
                    },
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert bill_r.status_code == 201, bill_r.content.decode()
    payload = json.loads(bill_r.content)
    line = payload["lines"][0]
    assert line["aquaculture_fish_weight_kg"] == "12.5000"
    assert line["aquaculture_fish_count"] == 5000
    assert line["aquaculture_fish_species"] == "tilapia"
    assert line["aquaculture_fish_species_label"] == "Tilapia"


@pytest.mark.django_db
def test_bill_rejects_fish_item_missing_weight_kg(api_client, company_tenant, auth_admin_headers):
    h = auth_admin_headers
    v = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": "Hatchery 3"}),
        content_type="application/json",
        **h,
    )
    assert v.status_code == 201
    vendor_id = json.loads(v.content)["id"]

    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Nursing B", pond_role="nursing", is_active=True
    )
    fry = Item.objects.create(
        company_id=company_tenant.id,
        name="Tilapia Fry B",
        item_type="inventory",
        pos_category="fish",
        unit="piece",
        category="Aquaculture",
    )

    bill_r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "bill_date": "2026-05-08",
                "subtotal": "100.00",
                "tax_total": "0",
                "total": "100.00",
                "status": "draft",
                "lines": [
                    {
                        "description": "Tilapia Fry B",
                        "item_id": fry.id,
                        "quantity": "1",
                        "unit_cost": "100.00",
                        "amount": "100.00",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_fish_species": "tilapia",
                        "aquaculture_fish_count": 1000,
                    },
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert bill_r.status_code == 400


@pytest.mark.django_db
def test_bill_rejects_fish_item_missing_fish_count(api_client, company_tenant, auth_admin_headers):
    h = auth_admin_headers
    v = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": "Hatchery 4"}),
        content_type="application/json",
        **h,
    )
    assert v.status_code == 201
    vendor_id = json.loads(v.content)["id"]

    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Nursing C", pond_role="nursing", is_active=True
    )
    fry = Item.objects.create(
        company_id=company_tenant.id,
        name="Tilapia Fry C",
        item_type="inventory",
        pos_category="fish",
        unit="piece",
        category="Aquaculture",
    )

    bill_r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "bill_date": "2026-05-08",
                "subtotal": "100.00",
                "tax_total": "0",
                "total": "100.00",
                "status": "draft",
                "lines": [
                    {
                        "description": "Tilapia Fry C",
                        "item_id": fry.id,
                        "quantity": "1",
                        "unit_cost": "100.00",
                        "amount": "100.00",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_fish_species": "tilapia",
                        "aquaculture_fish_weight_kg": "5",
                    },
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert bill_r.status_code == 400


@pytest.mark.django_db
def test_bill_rejects_fish_dims_without_item_line(api_client, company_tenant, auth_admin_headers):
    h = auth_admin_headers
    v = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": "Hatchery 2"}),
        content_type="application/json",
        **h,
    )
    assert v.status_code == 201
    vendor_id = json.loads(v.content)["id"]

    bill_r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "bill_date": "2026-05-08",
                "subtotal": "10.00",
                "tax_total": "0",
                "total": "10.00",
                "status": "draft",
                "lines": [
                    {
                        "description": "No item",
                        "quantity": "1",
                        "unit_cost": "10.00",
                        "amount": "10.00",
                        "aquaculture_fish_count": 100,
                    },
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert bill_r.status_code == 400


@pytest.mark.django_db
def test_posted_fish_bill_receives_into_pond_not_station_bins(api_client, company_tenant, auth_admin_headers):
    """Fish SKUs use pond stock (ItemPondStock), not shop station bins, when the line tags a pond."""
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    st = Station.objects.create(company_id=company_tenant.id, station_name="Shop Hub", is_active=True)
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Digonta Nursing", pond_role="nursing", is_active=True
    )
    h = auth_admin_headers
    v = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": "Hatchery PondRecv"}),
        content_type="application/json",
        **h,
    )
    assert v.status_code == 201
    vendor_id = json.loads(v.content)["id"]

    fry = Item.objects.create(
        company_id=company_tenant.id,
        name="Tilapia Fry PondRecv",
        item_type="inventory",
        pos_category="fish",
        unit="1000 pcs",
        category="Aquaculture",
    )

    bill_r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "bill_date": "2026-05-09",
                "subtotal": "100.00",
                "tax_total": "0",
                "total": "100.00",
                "status": "open",
                "receipt_station_id": st.id,
                "lines": [
                    {
                        "description": "Fry batch",
                        "item_id": fry.id,
                        "quantity": "1000",
                        "unit_cost": "0.10",
                        "amount": "100.00",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_fish_species": "tilapia",
                        "aquaculture_fish_weight_kg": "50",
                        "aquaculture_fish_count": 50000,
                    },
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert bill_r.status_code == 201, bill_r.content.decode()
    bill = json.loads(bill_r.content)
    assert Bill.objects.get(pk=bill["id"]).stock_receipt_applied is True

    row = ItemPondStock.objects.filter(
        company_id=company_tenant.id, pond_id=pond.id, item_id=fry.id
    ).first()
    assert row is not None
    assert row.quantity == Decimal("50000")

    st_total = ItemStationStock.objects.filter(company_id=company_tenant.id, item_id=fry.id).aggregate(
        s=Sum("quantity")
    )["s"]
    assert st_total is None or st_total == Decimal("0")

    pos = compute_fish_stock_position_rows(
        company_tenant.id, pond_id=pond.id, fish_species_filter="tilapia"
    )
    assert len(pos) == 1
    assert pos[0]["implied_net_fish_count"] == 50000
    assert pos[0]["vendor_bill_in_fish_count"] == 50000
    assert Decimal(pos[0]["vendor_bill_in_weight_kg"]) == Decimal("50")


@pytest.mark.django_db
def test_posted_fish_bill_pond_receipt_prefers_fish_count_over_line_quantity(
    api_client, company_tenant, auth_admin_headers
):
    """Billing quantity is often 1 batch; pond inventory and QOH use headcount."""
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    Station.objects.create(company_id=company_tenant.id, station_name="Shop", is_active=True)
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Nursing", pond_role="nursing", is_active=True
    )
    h = auth_admin_headers
    v = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": "Hatchery"}),
        content_type="application/json",
        **h,
    )
    assert v.status_code == 201
    vendor_id = json.loads(v.content)["id"]
    fry = Item.objects.create(
        company_id=company_tenant.id,
        name="Tilapia Fry",
        item_type="inventory",
        pos_category="fish",
        unit="head",
        category="Aquaculture",
    )
    bill_r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "bill_date": "2026-05-09",
                "subtotal": "100.00",
                "tax_total": "0",
                "total": "100.00",
                "status": "open",
                "lines": [
                    {
                        "description": "Fry batch",
                        "item_id": fry.id,
                        "quantity": "1",
                        "unit_cost": "100.00",
                        "amount": "100.00",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_fish_species": "tilapia",
                        "aquaculture_fish_weight_kg": "100",
                        "aquaculture_fish_count": 300000,
                    },
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert bill_r.status_code == 201, bill_r.content.decode()
    bill = json.loads(bill_r.content)
    assert Bill.objects.get(pk=bill["id"]).stock_receipt_applied is True
    row = ItemPondStock.objects.filter(
        company_id=company_tenant.id, pond_id=pond.id, item_id=fry.id
    ).first()
    assert row is not None
    assert row.quantity == Decimal("300000")
    fry.refresh_from_db()
    assert fry.quantity_on_hand == Decimal("300000")


@pytest.mark.django_db
def test_bill_list_includes_receipt_pond_summary_without_full_lines(
    api_client, company_tenant, auth_admin_headers
):
    """List view omits line payloads but must still show the receiving pond for fry bills."""
    h = auth_admin_headers
    station = Station.objects.create(
        company_id=company_tenant.id, station_name="Chabagan Station", is_active=True
    )
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Digonta",
        pond_role="nursing",
        physical_site_name="Digonta",
        is_active=True,
    )
    v = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": "CP Bangladesh Limited"}),
        content_type="application/json",
        **h,
    )
    vendor_id = json.loads(v.content)["id"]
    fry = Item.objects.create(
        company_id=company_tenant.id,
        name="Live Fry",
        item_type="inventory",
        pos_category="fish",
        unit="piece",
        category="Aquaculture",
        pieces_per_kg=3000,
    )
    bill_r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "receipt_station_id": station.id,
                "bill_date": "2026-06-20",
                "subtotal": "1100000",
                "tax_total": "0",
                "total": "1100000",
                "status": "open",
                "lines": [
                    {
                        "description": "Live Fry",
                        "item_id": fry.id,
                        "quantity": "366.6667",
                        "unit_cost": "3000",
                        "amount": "1100000",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_fish_species": "tilapia",
                        "aquaculture_fish_count": 1100000,
                    },
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert bill_r.status_code == 201, bill_r.content.decode()

    list_r = api_client.get("/api/bills/?skip=0&limit=25", **h)
    assert list_r.status_code == 200
    body = json.loads(list_r.content)
    rows = body["results"] if isinstance(body, dict) and "results" in body else body
    row = next(r for r in rows if r["bill_number"])
    assert row["receipt_station_name"] == "Chabagan Station"
    assert row["receipt_pond_id"] == pond.id
    assert "Digonta" in row["receipt_pond_display_name"]
    assert row["lines"] == []
