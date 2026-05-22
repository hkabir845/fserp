"""Aquaculture inventory / stock reports in the Reports hub."""
from __future__ import annotations

import json

import pytest
from django.test import Client

from api.models import AquaculturePond, Company, Item, ItemPondStock, ItemStationStock, Station
from tests.test_api_production_audit import _audit_master_headers

NEW_STOCK_REPORT_IDS = (
    "aquaculture-pond-feed-stock",
    "aquaculture-pond-medicine-stock",
    "aquaculture-pond-supplies-stock",
    "aquaculture-fish-stock-position",
    "aquaculture-shop-station-stock",
    "aquaculture-equipment-assets",
    "aquaculture-pond-total-inventory",
)


@pytest.fixture
def aquaculture_company(company_tenant, db):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True)
    company_tenant.refresh_from_db()
    return company_tenant


@pytest.mark.parametrize("report_id", NEW_STOCK_REPORT_IDS)
def test_aquaculture_stock_reports_return_200(
    api_client: Client,
    auth_admin_headers,
    aquaculture_company,
    report_id: str,
):
    h = _audit_master_headers(auth_admin_headers, aquaculture_company)
    r = api_client.get(
        f"/api/reports/{report_id}/",
        {"start_date": "2026-01-01", "end_date": "2026-05-22"},
        **h,
    )
    assert r.status_code == 200, (report_id, r.status_code, r.content[:500])
    data = json.loads(r.content)
    assert "groups" in data or "summary" in data
    assert data.get("currency_code") == "BDT"


def test_pond_feed_stock_groups_feed_only(
    api_client: Client,
    auth_admin_headers,
    aquaculture_company,
):
    cid = aquaculture_company.id
    pond = AquaculturePond.objects.create(company_id=cid, name="Stock Pond A", is_active=True)
    feed = Item.objects.create(
        company_id=cid,
        name="Grower Feed",
        item_number="FEED-RPT-1",
        pos_category="feed",
        quantity_on_hand=0,
        is_active=True,
    )
    med = Item.objects.create(
        company_id=cid,
        name="Oxytetracycline",
        item_number="AQ-MED-RPT-1",
        pos_category="medicine",
        quantity_on_hand=0,
        is_active=True,
    )
    ItemPondStock.objects.create(company_id=cid, pond=pond, item=feed, quantity="10")
    ItemPondStock.objects.create(company_id=cid, pond=pond, item=med, quantity="5")

    h = _audit_master_headers(auth_admin_headers, aquaculture_company)
    r = api_client.get(
        "/api/reports/aquaculture-pond-feed-stock/",
        {"start_date": "2026-01-01", "end_date": "2026-05-22", "pond_id": str(pond.id)},
        **h,
    )
    assert r.status_code == 200
    data = json.loads(r.content)
    assert data["summary"]["stock_kind"] == "feed"
    assert len(data["groups"]) == 1
    names = [ln["item_name"] for ln in data["groups"][0]["lines"]]
    assert names == ["Grower Feed"]


def test_shop_station_stock_lists_station_bins(
    api_client: Client,
    auth_admin_headers,
    aquaculture_company,
):
    cid = aquaculture_company.id
    st = Station.objects.filter(company_id=cid, is_active=True).first()
    if not st:
        st = Station.objects.create(
            company_id=cid,
            station_name="Agro Shop",
            station_number="AQ-SHOP-1",
            is_active=True,
        )
    feed = Item.objects.create(
        company_id=cid,
        name="Station Feed Sack",
        item_number="FEED-ST-1",
        pos_category="feed",
        quantity_on_hand=0,
        is_active=True,
    )
    ItemStationStock.objects.create(company_id=cid, station=st, item=feed, quantity="25")

    h = _audit_master_headers(auth_admin_headers, aquaculture_company)
    r = api_client.get(
        "/api/reports/aquaculture-shop-station-stock/",
        {"start_date": "2026-01-01", "end_date": "2026-05-22", "station_id": str(st.id)},
        **h,
    )
    assert r.status_code == 200
    data = json.loads(r.content)
    assert data["summary"]["line_count"] >= 1
    item_names = []
    for g in data["groups"]:
        for ln in g["lines"]:
            item_names.append(ln["item_name"])
    assert "Station Feed Sack" in item_names


def test_pond_total_inventory_sums_components(
    api_client: Client,
    auth_admin_headers,
    aquaculture_company,
):
    cid = aquaculture_company.id
    pond = AquaculturePond.objects.create(company_id=cid, name="Total Inv Pond", is_active=True)
    feed = Item.objects.create(
        company_id=cid,
        name="Total Feed",
        item_number="FEED-TOT-1",
        pos_category="feed",
        quantity_on_hand=0,
        is_active=True,
    )
    ItemPondStock.objects.create(company_id=cid, pond=pond, item=feed, quantity="8")

    h = _audit_master_headers(auth_admin_headers, aquaculture_company)
    r = api_client.get(
        "/api/reports/aquaculture-pond-total-inventory/",
        {"start_date": "2026-01-01", "end_date": "2026-05-22", "pond_id": str(pond.id)},
        **h,
    )
    assert r.status_code == 200
    data = json.loads(r.content)
    assert len(data["groups"]) == 1
    g = data["groups"][0]
    assert g["pond_id"] == pond.id
    assert "subtotals" in g
    assert "total_bdt" in g["subtotals"]
    assert float(g["subtotals"]["feed_bdt"]) >= 0
