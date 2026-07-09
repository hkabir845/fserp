"""Nursing pond emptying: auto-move feed/medicine warehouse stock with fingerling transfers."""

from __future__ import annotations

import json
from decimal import Decimal

import pytest

from api.models import (
    AquacultureExpense,
    AquacultureFishStockLedger,
    AquaculturePond,
    Company,
    Item,
)
from api.services.aquaculture_pond_stock_service import add_pond_stock, get_pond_item_stock


def _enable(c: Company) -> None:
    Company.objects.filter(pk=c.id).update(aquaculture_enabled=True, aquaculture_licensed=True)


@pytest.mark.django_db
def test_nursing_empty_moves_feed_medicine_warehouse_to_grow_out(api_client, company_tenant, auth_admin_headers):
    _enable(company_tenant)
    cid = company_tenant.id
    nursing = AquaculturePond.objects.create(
        company_id=cid,
        name="Nursing Empty Test",
        pond_role="nursing",
        is_active=True,
    )
    grow_out = AquaculturePond.objects.create(
        company_id=cid,
        name="Grow Out Dest",
        pond_role="grow_out",
        is_active=True,
    )
    feed = Item.objects.create(
        company_id=cid,
        name="Starter feed",
        item_type="inventory",
        pos_category="feed",
        cost=Decimal("50"),
        quantity_on_hand=Decimal("100"),
    )
    medicine = Item.objects.create(
        company_id=cid,
        name="Aqua medicine",
        item_type="inventory",
        pos_category="medicine",
        cost=Decimal("20"),
        quantity_on_hand=Decimal("50"),
    )
    add_pond_stock(cid, nursing.id, feed.id, Decimal("4"))
    add_pond_stock(cid, nursing.id, medicine.id, Decimal("2"))
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=nursing,
        expense_date="2026-04-01",
        expense_category="fry_stocking",
        amount=Decimal("50000.00"),
    )

    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=nursing,
        entry_date="2026-05-01",
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=10000,
        weight_kg_delta=Decimal("200"),
        memo="Fingerlings for empty test",
    )

    h = {**auth_admin_headers, "HTTP_X_COMPANY_ID": str(cid)}
    r = api_client.post(
        "/api/aquaculture/fish-pond-transfers/",
        data=json.dumps(
            {
                "from_pond_id": nursing.id,
                "transfer_date": "2026-05-17",
                "fish_species": "tilapia",
                "lines": [
                    {
                        "to_pond_id": grow_out.id,
                        "weight_kg": "200",
                        "fish_count": 10000,
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    body = json.loads(r.content)
    assert body.get("nursing_warehouse_transfers")
    assert len(body["nursing_warehouse_transfers"]) == 1
    assert body["nursing_warehouse_transfers"][0]["to_pond_id"] == grow_out.id

    assert get_pond_item_stock(cid, nursing.id, feed.id) == Decimal("0")
    assert get_pond_item_stock(cid, nursing.id, medicine.id) == Decimal("0")
    assert get_pond_item_stock(cid, grow_out.id, feed.id) == Decimal("4")
    assert get_pond_item_stock(cid, grow_out.id, medicine.id) == Decimal("2")
