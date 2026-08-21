"""
Fish is sold, not transferred. The pond-to-pond transfer document is closed for fish and stays
open for feed, medicine, equipment and other supplies.
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import AquacultureFishPondTransfer, AquaculturePond, Company, Item
from api.services.aquaculture_fish_transfer_policy import fish_pond_transfers_allowed

pytestmark = pytest.mark.django_db


def _enable(company):
    Company.objects.filter(pk=company.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )


def _ponds(cid):
    return (
        AquaculturePond.objects.create(
            company_id=cid, name="Src Retired", pond_role="nursing", is_active=True
        ),
        AquaculturePond.objects.create(
            company_id=cid, name="Dst Retired", pond_role="grow_out", is_active=True
        ),
    )


def test_the_policy_is_off_by_default():
    assert fish_pond_transfers_allowed() is False


def test_creating_a_fish_transfer_is_refused(api_client, company_tenant, auth_admin_headers):
    _enable(company_tenant)
    cid = company_tenant.id
    h = {**auth_admin_headers, "HTTP_X_COMPANY_ID": str(cid)}
    src, dst = _ponds(cid)

    r = api_client.post(
        "/api/aquaculture/fish-pond-transfers/",
        data=json.dumps(
            {
                "from_pond_id": src.id,
                "transfer_date": "2026-04-10",
                "fish_species": "tilapia",
                "lines": [{"to_pond_id": dst.id, "weight_kg": "100", "fish_count": 5000}],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 409, r.content.decode()
    body = json.loads(r.content)
    assert body["code"] == "fish_transfer_retired"
    assert "raises a sale" in body["detail"]
    assert "feed, medicine, equipment" in body["detail"]
    assert AquacultureFishPondTransfer.objects.filter(company_id=cid).count() == 0


def test_editing_an_existing_fish_transfer_is_refused(
    api_client, company_tenant, auth_admin_headers
):
    _enable(company_tenant)
    cid = company_tenant.id
    h = {**auth_admin_headers, "HTTP_X_COMPANY_ID": str(cid)}
    src, dst = _ponds(cid)
    t = AquacultureFishPondTransfer.objects.create(
        company_id=cid, from_pond=src, transfer_date=date(2026, 4, 10), fish_species="tilapia"
    )

    r = api_client.put(
        f"/api/aquaculture/fish-pond-transfers/{t.id}/",
        data=json.dumps(
            {
                "from_pond_id": src.id,
                "transfer_date": "2026-04-11",
                "fish_species": "tilapia",
                "lines": [{"to_pond_id": dst.id, "weight_kg": "50", "fish_count": 2500}],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 409, r.content.decode()
    t.refresh_from_db()
    assert t.transfer_date == date(2026, 4, 10), "a refused edit must not change the record"


def test_history_stays_readable_and_removable(
    api_client, company_tenant, auth_admin_headers
):
    """Retiring the document must not strand the records already recorded under it."""
    _enable(company_tenant)
    cid = company_tenant.id
    h = {**auth_admin_headers, "HTTP_X_COMPANY_ID": str(cid)}
    src, _dst = _ponds(cid)
    t = AquacultureFishPondTransfer.objects.create(
        company_id=cid, from_pond=src, transfer_date=date(2026, 4, 10), fish_species="tilapia"
    )

    assert api_client.get("/api/aquaculture/fish-pond-transfers/", **h).status_code == 200
    assert api_client.get(f"/api/aquaculture/fish-pond-transfers/{t.id}/", **h).status_code == 200
    assert api_client.delete(f"/api/aquaculture/fish-pond-transfers/{t.id}/", **h).status_code == 200
    assert not AquacultureFishPondTransfer.objects.filter(pk=t.id).exists()


def test_supplies_still_move_between_ponds(api_client, company_tenant, auth_admin_headers):
    """Feed, medicine, equipment and other items keep their pond-to-pond movement."""
    from api.services.aquaculture_pond_stock_service import (
        add_pond_stock,
        get_pond_item_stock,
        transfer_pond_warehouse_between_ponds,
    )

    _enable(company_tenant)
    cid = company_tenant.id
    src, dst = _ponds(cid)
    feed = Item.objects.create(
        company_id=cid, name="Grower Feed Retired", item_type="inventory",
        pos_category="feed", unit="kg", cost=Decimal("50.00"), unit_price=Decimal("60.00"),
    )
    add_pond_stock(cid, src.id, feed.id, Decimal("100"))

    xfer = transfer_pond_warehouse_between_ponds(
        company_id=cid,
        from_pond_id=src.id,
        to_pond_id=dst.id,
        items=[{"item_id": feed.id, "quantity": "40"}],
        memo="feed move",
    )
    assert xfer is not None
    assert get_pond_item_stock(cid, src.id, feed.id) == Decimal("60")
    assert get_pond_item_stock(cid, dst.id, feed.id) == Decimal("40")
