"""Pond warehouse stock overview API (all ponds)."""

from __future__ import annotations

import json
from decimal import Decimal

import pytest

from api.models import AquaculturePond, Company, Item, ItemPondStock


@pytest.mark.django_db
def test_pond_warehouse_stock_overview_lists_rows(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    cid = company_tenant.id
    pond_a = AquaculturePond.objects.create(company_id=cid, name="North", is_active=True)
    pond_b = AquaculturePond.objects.create(company_id=cid, name="South", is_active=True)
    feed = Item.objects.create(
        company_id=cid,
        name="Grower 32%",
        item_type="inventory",
        category="Feed",
        cost=Decimal("50"),
        unit_price=Decimal("60"),
        unit="sack",
        pos_category="feed",
    )
    ItemPondStock.objects.create(company_id=cid, pond=pond_a, item=feed, quantity=Decimal("12"))
    ItemPondStock.objects.create(company_id=cid, pond=pond_b, item=feed, quantity=Decimal("3"))

    r = api_client.get("/api/aquaculture/pond-warehouse-stock-overview/", **auth_admin_headers)
    assert r.status_code == 200, r.content.decode()
    body = json.loads(r.content.decode())
    rows = body["rows"]
    assert len(rows) == 2
    names = {(x["pond_name"], x["item_name"], x["quantity"]) for x in rows}
    assert ("North", "Grower 32%", "12.0000") in names
    assert ("South", "Grower 32%", "3.0000") in names


@pytest.mark.django_db
def test_pond_warehouse_stock_overview_pond_filter(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    cid = company_tenant.id
    pond_a = AquaculturePond.objects.create(company_id=cid, name="OnlyA", is_active=True)
    pond_b = AquaculturePond.objects.create(company_id=cid, name="OnlyB", is_active=True)
    it = Item.objects.create(
        company_id=cid,
        name="MedX",
        item_type="inventory",
        category="General",
        cost=Decimal("1"),
        unit_price=Decimal("2"),
        pos_category="medicine",
    )
    ItemPondStock.objects.create(company_id=cid, pond=pond_a, item=it, quantity=Decimal("5"))
    ItemPondStock.objects.create(company_id=cid, pond=pond_b, item=it, quantity=Decimal("7"))

    r = api_client.get(f"/api/aquaculture/pond-warehouse-stock-overview/?pond_id={pond_a.id}", **auth_admin_headers)
    assert r.status_code == 200
    body = json.loads(r.content.decode())
    assert len(body["rows"]) == 1
    assert body["rows"][0]["pond_id"] == pond_a.id
    assert body["rows"][0]["quantity"] == "5.0000"
