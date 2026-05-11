"""Inter-station inventory transfer post and rollback (unpost)."""

from __future__ import annotations

import json
from decimal import Decimal

import pytest
from django.test import Client

pytestmark = pytest.mark.django_db


@pytest.fixture
def tenant_two_stations(api_client, auth_admin_headers, company_tenant, user_admin):
    from api.models import Station

    Station.objects.create(company_id=company_tenant.id, station_name="Site A", is_active=True)
    Station.objects.create(company_id=company_tenant.id, station_name="Site B", is_active=True)
    return company_tenant


def test_inventory_transfer_post_then_unpost(api_client: Client, auth_admin_headers, tenant_two_stations):
    from api.models import Item, InventoryTransfer, Station
    from api.services.station_stock import get_station_stock, set_station_stock

    cid = tenant_two_stations.id
    stations = list(Station.objects.filter(company_id=cid, is_active=True).order_by("id")[:2])
    it = Item.objects.create(
        company_id=cid,
        name="Rollback SKU",
        item_type="inventory",
        category="General",
        cost=Decimal("10"),
        unit_price=Decimal("12"),
    )
    set_station_stock(cid, stations[0].id, it.id, Decimal("10"))
    set_station_stock(cid, stations[1].id, it.id, Decimal("0"))

    r = api_client.post(
        "/api/inventory/transfers/",
        data=json.dumps(
            {
                "from_station_id": stations[0].id,
                "to_station_id": stations[1].id,
                "lines": [{"item_id": it.id, "quantity": "4"}],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201
    tid = json.loads(r.content)["id"]

    r2 = api_client.post(f"/api/inventory/transfers/{tid}/", content_type="application/json", **auth_admin_headers)
    assert r2.status_code == 200
    assert json.loads(r2.content).get("status") == "posted"

    assert get_station_stock(cid, stations[0].id, it.id) == Decimal("6")
    assert get_station_stock(cid, stations[1].id, it.id) == Decimal("4")

    r3 = api_client.post(
        f"/api/inventory/transfers/{tid}/unpost/",
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r3.status_code == 200, r3.content.decode()
    body = json.loads(r3.content)
    assert body.get("status") == "draft"
    assert body.get("posted_at") in (None, "")

    assert get_station_stock(cid, stations[0].id, it.id) == Decimal("10")
    assert get_station_stock(cid, stations[1].id, it.id) == Decimal("0")

    tr = InventoryTransfer.objects.get(pk=tid)
    assert tr.status == InventoryTransfer.STATUS_DRAFT


def test_inventory_transfer_put_updates_draft(api_client: Client, auth_admin_headers, tenant_two_stations):
    from api.models import Item, InventoryTransfer, InventoryTransferLine, Station
    from api.services.station_stock import set_station_stock

    cid = tenant_two_stations.id
    stations = list(Station.objects.filter(company_id=cid, is_active=True).order_by("id")[:2])
    it_a = Item.objects.create(
        company_id=cid,
        name="SKU A",
        item_type="inventory",
        category="General",
        cost=Decimal("10"),
        unit_price=Decimal("12"),
    )
    it_b = Item.objects.create(
        company_id=cid,
        name="SKU B",
        item_type="inventory",
        category="General",
        cost=Decimal("5"),
        unit_price=Decimal("7"),
    )
    set_station_stock(cid, stations[0].id, it_a.id, Decimal("10"))
    set_station_stock(cid, stations[0].id, it_b.id, Decimal("8"))
    set_station_stock(cid, stations[1].id, it_a.id, Decimal("0"))
    set_station_stock(cid, stations[1].id, it_b.id, Decimal("0"))

    r = api_client.post(
        "/api/inventory/transfers/",
        data=json.dumps(
            {
                "from_station_id": stations[0].id,
                "to_station_id": stations[1].id,
                "lines": [{"item_id": it_a.id, "quantity": "2"}],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201
    tid = json.loads(r.content)["id"]

    r2 = api_client.put(
        f"/api/inventory/transfers/{tid}/",
        data=json.dumps(
            {
                "from_station_id": stations[0].id,
                "to_station_id": stations[1].id,
                "memo": "updated",
                "lines": [
                    {"item_id": it_a.id, "quantity": "1"},
                    {"item_id": it_b.id, "quantity": "3"},
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r2.status_code == 200, r2.content.decode()
    body = json.loads(r2.content)
    assert body.get("memo") == "updated"
    lines = body.get("lines") or []
    assert len(lines) == 2
    tr = InventoryTransfer.objects.get(pk=tid)
    assert tr.memo == "updated"
    assert list(
        InventoryTransferLine.objects.filter(transfer_id=tid).order_by("id").values_list("item_id", "quantity")
    ) == [(it_a.id, Decimal("1")), (it_b.id, Decimal("3"))]
