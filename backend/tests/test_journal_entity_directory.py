"""Journal entry entity directory for GL tagging."""
from __future__ import annotations

import json

import pytest

from api.models import AquaculturePond, Station

pytestmark = pytest.mark.django_db


def test_journal_entity_directory_lists_stations_and_ponds(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    cid = company_tenant_with_gl.id
    fuel = Station.objects.create(
        company_id=cid, station_name="Adib Filling Station", operates_fuel_retail=True, is_active=True
    )
    shop = Station.objects.create(
        company_id=cid, station_name="Premium Agro", operates_fuel_retail=False, is_active=True
    )
    pond = AquaculturePond.objects.create(company_id=cid, name="Grow-out Pond 1", is_active=True)

    r = api_client.get(
        "/api/journal-entries/entity-directory/",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    body = json.loads(r.content.decode())
    station_ids = {s["id"] for s in body.get("stations", [])}
    pond_ids = {p["id"] for p in body.get("ponds", [])}
    assert fuel.id in station_ids
    assert shop.id in station_ids
    assert pond.id in pond_ids
    shop_row = next(s for s in body["stations"] if s["id"] == shop.id)
    assert shop_row["operates_fuel_retail"] is False
    assert shop_row["station_name"] == "Premium Agro"
