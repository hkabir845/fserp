"""Data Bank guided preparation: readiness overview and confirmed warehouse return."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import AquaculturePond, Item, ItemPondStock, Station
from api.services.aquaculture_data_bank_service import (
    list_readiness_overview,
    pond_year_close_readiness,
    return_pond_warehouse_for_year_close,
)
from tests.test_aquaculture_fish_bioasset_gl import _enable_aquaculture_with_coa


@pytest.mark.django_db
def test_readiness_includes_structured_actions(company_tenant):
    _enable_aquaculture_with_coa(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="Action Pond", is_active=True)
    feed = Item.objects.create(
        company_id=cid,
        name="Feed Pellet",
        item_type="inventory",
        pos_category="feed",
        unit="kg",
    )
    ItemPondStock.objects.create(
        company_id=cid,
        pond=pond,
        item=feed,
        quantity=Decimal("10.0000"),
    )

    readiness = pond_year_close_readiness(cid, pond.id, date(2026, 12, 31))
    assert readiness["is_ready"] is False
    assert any(a["kind"] == "return_warehouse" for a in readiness["actions"])
    assert any(a["kind"] == "link" and "ponds" in a.get("href", "") for a in readiness["actions"])


@pytest.mark.django_db
def test_readiness_overview_counts_open_ponds(company_tenant):
    _enable_aquaculture_with_coa(company_tenant)
    cid = company_tenant.id
    AquaculturePond.objects.create(company_id=cid, name="Ready Pond", is_active=True)
    p_blocked = AquaculturePond.objects.create(company_id=cid, name="Stocked", is_active=True)
    feed = Item.objects.create(
        company_id=cid,
        name="Med",
        item_type="inventory",
        pos_category="medicine",
        unit="piece",
    )
    ItemPondStock.objects.create(
        company_id=cid,
        pond=p_blocked,
        item=feed,
        quantity=Decimal("5"),
    )

    payload = list_readiness_overview(cid, date(2026, 12, 31))
    assert payload["open_pond_count"] == 2
    assert payload["ready_pond_count"] == 1
    assert payload["not_ready_pond_count"] == 1


@pytest.mark.django_db
def test_return_warehouse_for_year_close(api_client, company_tenant, auth_admin_headers):
    _enable_aquaculture_with_coa(company_tenant)
    cid = company_tenant.id
    station = Station.objects.create(
        company_id=cid,
        station_name="Shop Hub",
        operates_fuel_retail=False,
        is_active=True,
    )
    pond = AquaculturePond.objects.create(company_id=cid, name="WH Pond", is_active=True)
    feed = Item.objects.create(
        company_id=cid,
        name="Grower",
        item_type="inventory",
        pos_category="feed",
        unit="kg",
    )
    ItemPondStock.objects.create(
        company_id=cid,
        pond=pond,
        item=feed,
        quantity=Decimal("12.5000"),
    )

    r = api_client.post(
        "/api/aquaculture/data-bank/return-warehouse/",
        data=json.dumps({"pond_id": pond.id, "station_id": station.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    body = json.loads(r.content.decode())
    assert body["returned_lines"] == 1
    assert body["remaining_lines"] == 0

    readiness = pond_year_close_readiness(cid, pond.id, date(2026, 12, 31))
    assert readiness["is_ready"] is True

    result, err = return_pond_warehouse_for_year_close(
        company_id=cid,
        pond_id=pond.id,
        station_id=station.id,
    )
    assert err is None
    assert result["returned_lines"] == 0
