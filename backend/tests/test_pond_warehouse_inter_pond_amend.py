"""Pond-to-pond warehouse transfer amend and reverse."""

from __future__ import annotations

import json
from decimal import Decimal

import pytest

pytestmark = pytest.mark.django_db


@pytest.fixture
def aquaculture_ponds(api_client, company_tenant, auth_admin_headers):
    from api.models import AquaculturePond, Company, Item, Station
    from api.services.aquaculture_pond_stock_service import add_pond_stock
    from api.services.station_stock import set_station_stock

    cid = company_tenant.id
    Company.objects.filter(pk=cid).update(aquaculture_enabled=True, aquaculture_licensed=True)
    st = Station.objects.create(company_id=cid, station_name="Shop", is_active=True)
    p1 = AquaculturePond.objects.create(company_id=cid, name="Pond A", sort_order=1)
    p2 = AquaculturePond.objects.create(company_id=cid, name="Pond B", sort_order=2)
    it = Item.objects.create(
        company_id=cid,
        name="Feed",
        item_type="inventory",
        category="General",
        cost=Decimal("10"),
    )
    set_station_stock(cid, st.id, it.id, Decimal("100"))
    add_pond_stock(cid, p1.id, it.id, Decimal("20"))
    return cid, p1, p2, it, {**auth_admin_headers, "HTTP_X_COMPANY_ID": str(cid)}


def test_inter_pond_transfer_amend_and_reverse(api_client, aquaculture_ponds):
    from api.services.aquaculture_pond_stock_service import get_pond_item_stock

    cid, p1, p2, it, h = aquaculture_ponds
    r = api_client.post(
        "/api/aquaculture/pond-warehouse-inter-pond-transfers/",
        data=json.dumps(
            {
                "from_pond_id": p1.id,
                "to_pond_id": p2.id,
                "items": [{"item_id": it.id, "quantity": "5"}],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201
    tid = json.loads(r.content)["id"]
    assert get_pond_item_stock(cid, p1.id, it.id) == Decimal("15")
    assert get_pond_item_stock(cid, p2.id, it.id) == Decimal("5")

    r2 = api_client.put(
        f"/api/aquaculture/pond-warehouse-inter-pond-transfers/{tid}/",
        data=json.dumps(
            {
                "from_pond_id": p1.id,
                "to_pond_id": p2.id,
                "items": [{"item_id": it.id, "quantity": "8"}],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r2.status_code == 200, r2.content.decode()
    assert get_pond_item_stock(cid, p1.id, it.id) == Decimal("12")
    assert get_pond_item_stock(cid, p2.id, it.id) == Decimal("8")

    r3 = api_client.delete(f"/api/aquaculture/pond-warehouse-inter-pond-transfers/{tid}/", **h)
    assert r3.status_code == 200, r3.content.decode()
    assert get_pond_item_stock(cid, p1.id, it.id) == Decimal("20")
    assert get_pond_item_stock(cid, p2.id, it.id) == Decimal("0")
