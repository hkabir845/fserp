"""Pond warehouse ↔ shop station transfers."""
from __future__ import annotations

import json
from decimal import Decimal

import pytest

from api.models import AquaculturePond, Company, Item, PondWarehouseStockReturn, Station
from api.services.aquaculture_pond_stock_service import get_pond_item_stock, transfer_pond_warehouse_to_station
from api.services.station_stock import get_station_stock, set_station_stock


@pytest.mark.django_db
def test_pond_to_shop_transfer_and_reverse(api_client, auth_admin_headers, company_tenant):
    cid = company_tenant.id
    Company.objects.filter(pk=cid).update(aquaculture_enabled=True, aquaculture_licensed=True)
    st = Station.objects.create(company_id=cid, station_name="Premium Agro", is_active=True)
    pond = AquaculturePond.objects.create(company_id=cid, name="Pond A", sort_order=1)
    it = Item.objects.create(
        company_id=cid,
        name="Feed bag",
        item_type="inventory",
        category="General",
        cost=Decimal("50"),
    )
    set_station_stock(cid, st.id, it.id, Decimal("0"))
    from api.services.aquaculture_pond_stock_service import add_pond_stock

    add_pond_stock(cid, pond.id, it.id, Decimal("12"))

    r = api_client.post(
        "/api/aquaculture/pond-warehouse-return/",
        data=json.dumps(
            {
                "station_id": st.id,
                "pond_id": pond.id,
                "items": [{"item_id": it.id, "quantity": "5"}],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    assert get_pond_item_stock(cid, pond.id, it.id) == Decimal("7")
    assert get_station_stock(cid, st.id, it.id) == Decimal("5")
    assert PondWarehouseStockReturn.objects.filter(company_id=cid).count() == 1

    ret = PondWarehouseStockReturn.objects.get(company_id=cid)
    r2 = api_client.post(
        f"/api/inventory/pond-warehouse-returns/{ret.id}/reverse/",
        **auth_admin_headers,
    )
    assert r2.status_code == 200, r2.content.decode()
    assert get_pond_item_stock(cid, pond.id, it.id) == Decimal("12")
    assert get_station_stock(cid, st.id, it.id) == Decimal("0")
    assert PondWarehouseStockReturn.objects.filter(company_id=cid).count() == 0


@pytest.mark.django_db
def test_empty_sack_blocked_on_pond_shop_transfer(company_tenant):
    from api.exceptions import StockBusinessError
    from api.services.aquaculture_empty_sack_service import ensure_empty_feed_sack_catalog_item

    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="P1", is_active=True)
    st = Station.objects.create(company_id=cid, station_name="Shop", is_active=True)
    empty = ensure_empty_feed_sack_catalog_item(cid)
    from api.services.aquaculture_pond_stock_service import add_pond_stock

    add_pond_stock(cid, pond.id, empty.id, Decimal("3"))
    with pytest.raises(StockBusinessError, match="scrap only"):
        transfer_pond_warehouse_to_station(
            company_id=cid,
            pond_id=pond.id,
            station_id=st.id,
            items=[{"item_id": empty.id, "quantity": "1"}],
        )
