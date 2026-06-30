"""Editing an inter-pond fish transfer replaces lines and rebalances pond stock."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquaculturePond,
    Bill,
    BillLine,
    Item,
    Vendor,
)
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows


def _pond_stock_heads(company_id: int, pond_id: int) -> int:
    rows = compute_fish_stock_position_rows(company_id, pond_id=pond_id)
    return int(rows[0]["implied_net_fish_count"]) if rows else 0


@pytest.mark.django_db
def test_edit_fish_transfer_changes_destination_stock(api_client, company_tenant, auth_admin_headers):
    cid = company_tenant.id
    nursing = AquaculturePond.objects.create(
        company_id=cid, name="Digonta Nursing", pond_role="nursing", is_active=True
    )
    grow_a = AquaculturePond.objects.create(
        company_id=cid, name="Ashari-1", pond_role="grow_out", is_active=True
    )
    grow_b = AquaculturePond.objects.create(
        company_id=cid, name="Ashari-2", pond_role="grow_out", is_active=True
    )
    vendor = Vendor.objects.create(company_id=cid, company_name="Fry Vendor")
    fish_item = Item.objects.create(
        company_id=cid,
        name="Tilapia Fry",
        pos_category="fish",
        unit="kg",
        unit_price=Decimal("100"),
        cost=Decimal("80"),
    )
    bill = Bill.objects.create(
        company_id=cid,
        vendor=vendor,
        bill_number="B-FRY-DIG",
        bill_date=date(2026, 5, 1),
        status="posted",
        stock_receipt_applied=True,
        total=Decimal("5000"),
    )
    BillLine.objects.create(
        bill=bill,
        item=fish_item,
        quantity=Decimal("500"),
        amount=Decimal("5000"),
        aquaculture_pond=nursing,
        aquaculture_fish_count=15000,
        aquaculture_fish_weight_kg=Decimal("300"),
    )

    h = auth_admin_headers
    payload = {
        "from_pond_id": nursing.id,
        "transfer_date": "2026-06-15",
        "fish_species": "tilapia",
        "lines": [
            {
                "to_pond_id": grow_a.id,
                "weight_kg": "300",
                "fish_count": 15000,
                "cost_amount": "0",
            }
        ],
    }
    r = api_client.post(
        "/api/aquaculture/fish-pond-transfers/",
        data=json.dumps(payload),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content
    transfer_id = r.json()["transfer"]["id"]

    assert _pond_stock_heads(cid, nursing.id) == 0
    assert _pond_stock_heads(cid, grow_a.id) == 15000
    assert _pond_stock_heads(cid, grow_b.id) == 0

    payload["lines"] = [
        {
            "to_pond_id": grow_b.id,
            "weight_kg": "300",
            "fish_count": 15000,
            "cost_amount": "0",
        }
    ]
    r2 = api_client.put(
        f"/api/aquaculture/fish-pond-transfers/{transfer_id}/",
        data=json.dumps(payload),
        content_type="application/json",
        **h,
    )
    assert r2.status_code == 200, r2.content

    assert _pond_stock_heads(cid, nursing.id) == 0
    assert _pond_stock_heads(cid, grow_a.id) == 0
    assert _pond_stock_heads(cid, grow_b.id) == 15000

    assert AquacultureFishPondTransferLine.objects.filter(transfer_id=transfer_id).count() == 1
    line = AquacultureFishPondTransferLine.objects.get(transfer_id=transfer_id)
    assert line.to_pond_id == grow_b.id
    assert line.fish_count == 15000


@pytest.mark.django_db
def test_edit_transfer_allows_same_outbound_with_exclude_transfer_id(company_tenant):
    """PUT validation adds back this transfer's prior outbound from the same source pond."""
    cid = company_tenant.id
    nursing = AquaculturePond.objects.create(
        company_id=cid, name="Digonta Nursing", pond_role="nursing", is_active=True
    )
    dest = AquaculturePond.objects.create(
        company_id=cid, name="Ashari-1", pond_role="grow_out", is_active=True
    )
    vendor = Vendor.objects.create(company_id=cid, company_name="Fry Vendor")
    fish_item = Item.objects.create(
        company_id=cid,
        name="Tilapia Fry",
        pos_category="fish",
        unit="kg",
        unit_price=Decimal("100"),
        cost=Decimal("80"),
    )
    bill = Bill.objects.create(
        company_id=cid,
        vendor=vendor,
        bill_number="B-FRY-2",
        bill_date=date(2026, 5, 1),
        status="posted",
        stock_receipt_applied=True,
        total=Decimal("5000"),
    )
    BillLine.objects.create(
        bill=bill,
        item=fish_item,
        quantity=Decimal("500"),
        amount=Decimal("5000"),
        aquaculture_pond=nursing,
        aquaculture_fish_count=15000,
        aquaculture_fish_weight_kg=Decimal("300"),
    )
    tr = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=nursing,
        transfer_date=date(2026, 6, 15),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=tr,
        to_pond=dest,
        weight_kg=Decimal("300"),
        fish_count=15000,
        cost_amount=Decimal("1000"),
    )

    from api.services.aquaculture_stock_service import assert_outbound_fish_within_implied_stock

    err_without = assert_outbound_fish_within_implied_stock(
        cid,
        nursing.id,
        production_cycle_id=None,
        fish_species="tilapia",
        fish_count=15000,
        weight_kg=Decimal("300"),
    )
    assert err_without is not None

    err_with = assert_outbound_fish_within_implied_stock(
        cid,
        nursing.id,
        production_cycle_id=None,
        fish_species="tilapia",
        fish_count=15000,
        weight_kg=Decimal("300"),
        exclude_transfer_id=tr.id,
    )
    assert err_with is None
