"""Shared warehouse groups and pond-to-pond warehouse transfers."""

from __future__ import annotations

import json
from decimal import Decimal

import pytest

from api.models import (
    AquaculturePond,
    AquacultureWarehouseGroup,
    Company,
    Item,
    ItemPondStock,
    ItemStationStock,
    Station,
)


@pytest.mark.django_db
def test_warehouse_group_crud_and_pond_assign(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    cid = company_tenant.id

    r = api_client.post(
        "/api/aquaculture/warehouse-groups/",
        data=json.dumps({"name": "Ashari shared", "code": "ASHARI-WH"}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    gid = json.loads(r.content.decode())["id"]

    pond_a = AquaculturePond.objects.create(company_id=cid, name="Ashari-1", is_active=True)
    pond_b = AquaculturePond.objects.create(company_id=cid, name="Ashari-2", is_active=True)
    r2 = api_client.put(
        f"/api/aquaculture/ponds/{pond_a.id}/",
        data=json.dumps({"warehouse_group_id": gid}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r2.status_code == 200, r2.content.decode()
    assert json.loads(r2.content.decode())["warehouse_group_id"] == gid

    r3 = api_client.get("/api/aquaculture/warehouse-groups/", **auth_admin_headers)
    body = json.loads(r3.content.decode())
    row = next(x for x in body if x["id"] == gid)
    assert row["member_pond_count"] == 1


@pytest.mark.django_db
def test_inter_pond_transfer_within_shared_group(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    cid = company_tenant.id
    grp = AquacultureWarehouseGroup.objects.create(company_id=cid, name="Shared", code="SH1")
    pond_a = AquaculturePond.objects.create(
        company_id=cid, name="A", is_active=True, warehouse_group=grp
    )
    pond_b = AquaculturePond.objects.create(
        company_id=cid, name="B", is_active=True, warehouse_group=grp
    )
    feed = Item.objects.create(
        company_id=cid,
        name="Feed",
        item_type="inventory",
        category="Feed",
        cost=Decimal("10"),
        unit_price=Decimal("12"),
        unit="sack",
        pos_category="feed",
    )
    ItemPondStock.objects.create(company_id=cid, pond=pond_a, item=feed, quantity=Decimal("20"))
    ItemPondStock.objects.create(company_id=cid, pond=pond_b, item=feed, quantity=Decimal("5"))

    r = api_client.post(
        "/api/aquaculture/pond-warehouse-inter-pond-transfers/",
        data=json.dumps(
            {
                "from_pond_id": pond_a.id,
                "to_pond_id": pond_b.id,
                "items": [{"item_id": feed.id, "quantity": "7"}],
                "memo": "Rebalance Ashari shed",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    assert ItemPondStock.objects.get(pond=pond_a, item=feed).quantity == Decimal("13.0000")
    assert ItemPondStock.objects.get(pond=pond_b, item=feed).quantity == Decimal("12.0000")


@pytest.mark.django_db
def test_inter_pond_transfer_rejects_mismatched_groups(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    cid = company_tenant.id
    g1 = AquacultureWarehouseGroup.objects.create(company_id=cid, name="G1")
    g2 = AquacultureWarehouseGroup.objects.create(company_id=cid, name="G2")
    pond_a = AquaculturePond.objects.create(company_id=cid, name="A", warehouse_group=g1)
    pond_b = AquaculturePond.objects.create(company_id=cid, name="B", warehouse_group=g2)
    feed = Item.objects.create(
        company_id=cid,
        name="F",
        item_type="inventory",
        category="Feed",
        cost=Decimal("1"),
        unit_price=Decimal("2"),
        pos_category="feed",
    )
    ItemPondStock.objects.create(company_id=cid, pond=pond_a, item=feed, quantity=Decimal("10"))

    r = api_client.post(
        "/api/aquaculture/pond-warehouse-inter-pond-transfers/",
        data=json.dumps(
            {"from_pond_id": pond_a.id, "to_pond_id": pond_b.id, "items": [{"item_id": feed.id, "quantity": "1"}]}
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400
    assert "different shared warehouse groups" in r.content.decode().lower()


@pytest.mark.django_db
def test_warehouse_group_pool_sums_member_allocations(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    cid = company_tenant.id
    grp = AquacultureWarehouseGroup.objects.create(company_id=cid, name="Pool")
    p1 = AquaculturePond.objects.create(company_id=cid, name="P1", warehouse_group=grp)
    p2 = AquaculturePond.objects.create(company_id=cid, name="P2", warehouse_group=grp)
    feed = Item.objects.create(
        company_id=cid,
        name="Grower",
        item_type="inventory",
        category="Feed",
        cost=Decimal("5"),
        unit_price=Decimal("6"),
        pos_category="feed",
    )
    ItemPondStock.objects.create(company_id=cid, pond=p1, item=feed, quantity=Decimal("8"))
    ItemPondStock.objects.create(company_id=cid, pond=p2, item=feed, quantity=Decimal("4"))

    r = api_client.get(
        f"/api/aquaculture/warehouse-group-pool/?warehouse_group_id={grp.id}",
        **auth_admin_headers,
    )
    assert r.status_code == 200
    rows = json.loads(r.content.decode())["rows"]
    assert len(rows) == 1
    assert rows[0]["quantity"] == "12.0000"
    assert rows[0]["member_pond_count"] == 2


@pytest.mark.django_db
def test_stock_overview_includes_warehouse_group_fields(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    cid = company_tenant.id
    grp = AquacultureWarehouseGroup.objects.create(company_id=cid, name="Ashari")
    pond = AquaculturePond.objects.create(company_id=cid, name="Ashari-1", warehouse_group=grp)
    feed = Item.objects.create(
        company_id=cid,
        name="F",
        item_type="inventory",
        category="Feed",
        cost=Decimal("1"),
        unit_price=Decimal("2"),
        pos_category="feed",
    )
    ItemPondStock.objects.create(company_id=cid, pond=pond, item=feed, quantity=Decimal("3"))

    r = api_client.get("/api/aquaculture/pond-warehouse-stock-overview/", **auth_admin_headers)
    row = json.loads(r.content.decode())["rows"][0]
    assert row["warehouse_group_id"] == grp.id
    assert row["warehouse_group_name"] == "Ashari"
    assert row["is_shared_warehouse_member"] is True
