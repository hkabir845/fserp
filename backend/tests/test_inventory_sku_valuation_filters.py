"""Inventory SKU valuation report — category and item filters."""

from __future__ import annotations

import json

import pytest

pytestmark = pytest.mark.django_db


def test_inventory_sku_valuation_category_filter(api_client, company_tenant_with_gl, auth_admin_headers):
    from api.models import Item

    cid = company_tenant_with_gl.id
    Item.objects.create(
        company_id=cid,
        name="Fuel SKU",
        item_type="inventory",
        category="Fuel",
        cost=10,
        unit_price=12,
        quantity_on_hand=5,
        is_active=True,
    )
    Item.objects.create(
        company_id=cid,
        name="Shop SKU",
        item_type="inventory",
        category="General",
        cost=20,
        unit_price=25,
        quantity_on_hand=3,
        is_active=True,
    )
    h = {**auth_admin_headers, "HTTP_X_COMPANY_ID": str(cid)}
    r = api_client.get(
        "/api/reports/inventory-sku-valuation/",
        {"start_date": "2026-01-01", "end_date": "2026-01-31", "category": "Fuel"},
        **h,
    )
    assert r.status_code == 200, r.content.decode()
    body = json.loads(r.content)
    names = [row["name"] for row in body.get("rows") or []]
    assert names == ["Fuel SKU"]
    assert body.get("filters", {}).get("category") == "Fuel"
