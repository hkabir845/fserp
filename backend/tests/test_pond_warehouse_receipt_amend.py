"""Amend shop → pond warehouse receipts."""

from __future__ import annotations

import json
from decimal import Decimal

import pytest
from django.test import Client

pytestmark = pytest.mark.django_db


def test_pond_warehouse_receipt_amend_updates_shop_and_pond(
    api_client: Client, auth_admin_headers, company_tenant,
):
    from api.models import AquaculturePond, Company, Item, PondWarehouseStockReceipt, Station
    from api.services.aquaculture_pond_stock_service import get_pond_item_stock
    from api.services.station_stock import get_station_stock, set_station_stock

    cid = company_tenant.id
    Company.objects.filter(pk=cid).update(aquaculture_enabled=True, aquaculture_licensed=True)
    st = Station.objects.create(company_id=cid, station_name="Shop", is_active=True)
    pond = AquaculturePond.objects.create(company_id=cid, name="Pond A", sort_order=1)
    it = Item.objects.create(
        company_id=cid,
        name="Feed bag",
        item_type="inventory",
        category="General",
        cost=Decimal("50"),
    )
    set_station_stock(cid, st.id, it.id, Decimal("100"))

    r = api_client.post(
        "/api/aquaculture/pond-warehouse-transfer/",
        data=json.dumps(
            {
                "station_id": st.id,
                "pond_id": pond.id,
                "items": [{"item_id": it.id, "quantity": "10"}],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201
    rec = PondWarehouseStockReceipt.objects.filter(company_id=cid).first()
    assert rec is not None

    assert get_station_stock(cid, st.id, it.id) == Decimal("90")
    assert get_pond_item_stock(cid, pond.id, it.id) == Decimal("10")

    r2 = api_client.put(
        f"/api/inventory/pond-warehouse-receipts/{rec.id}/",
        data=json.dumps(
            {
                "station_id": st.id,
                "pond_id": pond.id,
                "items": [{"item_id": it.id, "quantity": "15"}],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r2.status_code == 200, r2.content.decode()
    body = json.loads(r2.content)
    assert body.get("total_value") == "750.00"
    assert get_station_stock(cid, st.id, it.id) == Decimal("85")
    assert get_pond_item_stock(cid, pond.id, it.id) == Decimal("15")
