"""Full shop ↔ pond ↔ pond ↔ shop warehouse transfer matrix."""

from __future__ import annotations

import json
from decimal import Decimal

import pytest

from api.models import AquaculturePond, Company, Item, Station
from api.services.aquaculture_pond_stock_service import get_pond_item_stock
from api.services.station_stock import get_station_stock, set_station_stock

pytestmark = pytest.mark.django_db


def test_full_shop_pond_pond_shop_transfer_matrix(api_client, company_tenant, auth_admin_headers):
    """
    Round-trip goods through every warehouse route:
    shop → pond A → pond B → pond A → shop
    """
    cid = company_tenant.id
    Company.objects.filter(pk=cid).update(aquaculture_enabled=True, aquaculture_licensed=True)

    shop = Station.objects.create(
        company_id=cid, station_name="Premium Agro", operates_fuel_retail=False, is_active=True
    )
    pond_a = AquaculturePond.objects.create(company_id=cid, name="Ashari Pond", is_active=True)
    pond_b = AquaculturePond.objects.create(company_id=cid, name="Digonto Pond", is_active=True)
    feed = Item.objects.create(
        company_id=cid,
        name="Feed bag",
        item_type="inventory",
        category="General",
        cost=Decimal("50"),
        pos_category="feed",
    )
    set_station_stock(cid, shop.id, feed.id, Decimal("100"))

    # 1) Shop → Pond A
    r1 = api_client.post(
        "/api/aquaculture/pond-warehouse-transfer/",
        data=json.dumps(
            {
                "station_id": shop.id,
                "pond_id": pond_a.id,
                "items": [{"item_id": feed.id, "quantity": "40"}],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r1.status_code == 201, r1.content.decode()
    assert get_station_stock(cid, shop.id, feed.id) == Decimal("60")
    assert get_pond_item_stock(cid, pond_a.id, feed.id) == Decimal("40")

    # 2) Pond A → Pond B
    r2 = api_client.post(
        "/api/aquaculture/pond-warehouse-inter-pond-transfers/",
        data=json.dumps(
            {
                "from_pond_id": pond_a.id,
                "to_pond_id": pond_b.id,
                "items": [{"item_id": feed.id, "quantity": "25"}],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r2.status_code == 201, r2.content.decode()
    assert get_pond_item_stock(cid, pond_a.id, feed.id) == Decimal("15")
    assert get_pond_item_stock(cid, pond_b.id, feed.id) == Decimal("25")

    # 3) Pond B → Pond A (reverse inter-pond)
    r3 = api_client.post(
        "/api/aquaculture/pond-warehouse-inter-pond-transfers/",
        data=json.dumps(
            {
                "from_pond_id": pond_b.id,
                "to_pond_id": pond_a.id,
                "items": [{"item_id": feed.id, "quantity": "10"}],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r3.status_code == 201, r3.content.decode()
    assert get_pond_item_stock(cid, pond_a.id, feed.id) == Decimal("25")
    assert get_pond_item_stock(cid, pond_b.id, feed.id) == Decimal("15")

    # 4) Pond B → Shop
    r4 = api_client.post(
        "/api/aquaculture/pond-warehouse-return/",
        data=json.dumps(
            {
                "station_id": shop.id,
                "pond_id": pond_b.id,
                "items": [{"item_id": feed.id, "quantity": "15"}],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r4.status_code == 201, r4.content.decode()
    assert get_pond_item_stock(cid, pond_b.id, feed.id) == Decimal("0")
    assert get_station_stock(cid, shop.id, feed.id) == Decimal("75")

    # 5) Pond A → Shop (clear remaining)
    r5 = api_client.post(
        "/api/aquaculture/pond-warehouse-return/",
        data=json.dumps(
            {
                "station_id": shop.id,
                "pond_id": pond_a.id,
                "items": [{"item_id": feed.id, "quantity": "25"}],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r5.status_code == 201, r5.content.decode()
    assert get_pond_item_stock(cid, pond_a.id, feed.id) == Decimal("0")
    assert get_station_stock(cid, shop.id, feed.id) == Decimal("100")
