"""Shop stock placement and move-all for multi-station companies."""
import json

import pytest
from django.test import Client

from api.models import Item, Station
from api.services.station_stock import get_station_stock, per_station_quantities
from tests.test_api_production_audit import _audit_master_headers


@pytest.mark.django_db
def test_item_create_with_station_id_and_move_all(
    api_client: Client, auth_super_headers, company_master
):
    h = _audit_master_headers(auth_super_headers, company_master)
    cid = company_master.id
    stations = list(Station.objects.filter(company_id=cid, is_active=True).order_by("id")[:2])
    if len(stations) < 2:
        s2 = Station.objects.create(company_id=cid, station_name="Premium Agro Station", is_active=True)
        stations = [stations[0], s2] if stations else [
            Station.objects.create(company_id=cid, station_name="Main Station", is_active=True),
            s2,
        ]

    main_id, premium_id = stations[0].id, stations[1].id

    r = api_client.post(
        "/api/items/",
        data=json.dumps(
            {
                "name": "Probiotic Test SKU",
                "item_type": "inventory",
                "category": "General",
                "quantity_on_hand": "3",
                "station_id": premium_id,
                "is_pos_available": True,
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content
    item_id = json.loads(r.content)["id"]
    assert get_station_stock(cid, premium_id, item_id) == 3
    assert get_station_stock(cid, main_id, item_id) == 0


@pytest.mark.django_db
def test_item_put_move_all_clears_other_stations(
    api_client: Client, auth_super_headers, company_master
):
    h = _audit_master_headers(auth_super_headers, company_master)
    cid = company_master.id
    stations = list(Station.objects.filter(company_id=cid, is_active=True).order_by("id")[:2])
    if len(stations) < 2:
        s2 = Station.objects.create(company_id=cid, station_name="Site B", is_active=True)
        stations = [stations[0], s2] if stations else [
            Station.objects.create(company_id=cid, station_name="Site A", is_active=True),
            s2,
        ]
    main_id, other_id = stations[0].id, stations[1].id

    it = Item.objects.create(
        company_id=cid,
        name="Move me",
        item_type="inventory",
        category="General",
    )
    from decimal import Decimal
    from api.services.station_stock import set_station_stock

    set_station_stock(cid, main_id, it.id, Decimal("8"))

    r = api_client.put(
        f"/api/items/{it.id}/",
        data=json.dumps(
            {
                "quantity_on_hand": "8",
                "station_id": other_id,
                "move_all_shop_stock": True,
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 200, r.content
    assert get_station_stock(cid, other_id, it.id) == 8
    assert get_station_stock(cid, main_id, it.id) == 0
    loc = {row["station_id"]: float(row["quantity"]) for row in per_station_quantities(cid, it.id)}
    assert loc.get(main_id) == 0
    assert loc.get(other_id) == 8
