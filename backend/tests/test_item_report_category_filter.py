"""Items list report-category filter and fuel POS indexing."""
from __future__ import annotations

import json

import pytest
from django.test import Client

from api.models import Item


@pytest.mark.django_db
def test_items_list_filter_report_category_fuel_includes_fuel_pos(
    api_client: Client, auth_super_headers, company_master
):
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    cid = company_master.id

    Item.objects.create(
        company_id=cid,
        name="Diesel POS",
        item_type="inventory",
        unit_price=0,
        cost=0,
        category="General",
        pos_category="fuel",
    )
    Item.objects.create(
        company_id=cid,
        name="Shop Snack",
        item_type="inventory",
        unit_price=0,
        cost=0,
        category="General",
        pos_category="general",
    )
    Item.objects.create(
        company_id=cid,
        name="Explicit Fuel Label",
        item_type="inventory",
        unit_price=0,
        cost=0,
        category="Fuel",
        pos_category="general",
    )

    r = api_client.get("/api/items/?paged=1&skip=0&limit=50&category=Fuel", **h)
    assert r.status_code == 200
    body = r.json()
    names = {row["name"] for row in body["results"]}
    assert names == {"Diesel POS", "Explicit Fuel Label"}
    assert body["stats"]["by_category"]["Fuel"] == 2
    assert body["stats"]["by_category"]["General"] == 1
    assert body["stats"]["on_hand"]["total_cost_value"] == "0.00"


@pytest.mark.django_db
def test_items_list_on_hand_value_totals_filtered_catalog(
    api_client: Client, auth_super_headers, company_master
):
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    cid = company_master.id

    Item.objects.create(
        company_id=cid,
        name="Widget A",
        item_type="inventory",
        unit_price=10,
        cost=5,
        quantity_on_hand=4,
        category="General",
    )
    Item.objects.create(
        company_id=cid,
        name="Consulting",
        item_type="service",
        unit_price=100,
        cost=0,
        quantity_on_hand=0,
        category="General",
    )

    r = api_client.get("/api/items/?paged=1&skip=0&limit=50&item_type=inventory", **h)
    assert r.status_code == 200
    body = r.json()
    assert body["stats"]["on_hand"]["total_cost_value"] == "20.00"


@pytest.mark.django_db
def test_items_create_fuel_pos_defaults_report_category_to_fuel(
    api_client: Client, auth_super_headers, company_master
):
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    r = api_client.post(
        "/api/items/",
        data=json.dumps(
            {
                "name": "Octane Tank",
                "unit_price": "95",
                "cost": "80",
                "category": "General",
                "pos_category": "fuel",
                "item_type": "inventory",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201
    assert r.json()["category"] == "Fuel"
