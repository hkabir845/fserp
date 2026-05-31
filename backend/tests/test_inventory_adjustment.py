"""Shop inventory adjustments (stock count): variance posts to 5210 shrinkage, stock is corrected,
and unpost rolls both back. The C-store analogue of a fuel tank-dip variance."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    ChartOfAccount,
    InventoryAdjustment,
    Item,
    JournalEntry,
    JournalEntryLine,
    Station,
)
from api.services.reporting import report_income_statement
from api.services.station_stock import get_station_stock, set_station_stock

pytestmark = pytest.mark.django_db


def _shrink_account(cid: int) -> ChartOfAccount:
    return ChartOfAccount.objects.create(
        company_id=cid,
        account_code="5210",
        account_name="Inventory Shrinkage - Shop / Other",
        account_type="cost_of_goods_sold",
        is_active=True,
    )


def _shop_item(cid: int, cost: str = "5") -> Item:
    return Item.objects.create(
        company_id=cid,
        name="Shelf SKU",
        item_type="inventory",
        unit="piece",
        category="General",
        cost=Decimal(cost),
        unit_price=Decimal("9"),
        quantity_on_hand=Decimal("0"),
        is_active=True,
    )


def _station(cid: int) -> Station:
    return Station.objects.create(company_id=cid, station_name="Main Shop", is_active=True)


def _lines(cid: int, adj_id: int):
    return JournalEntryLine.objects.filter(
        journal_entry__company_id=cid,
        journal_entry__entry_number=f"AUTO-INVADJ-{adj_id}",
    ).select_related("account")


def _create_and_post(api_client, headers, cid, station, item, counted):
    r = api_client.post(
        "/api/inventory/adjustments/",
        data=json.dumps(
            {
                "station_id": station.id,
                "reason": "count",
                "lines": [{"item_id": item.id, "counted_quantity": str(counted)}],
            }
        ),
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 201, r.content
    adj_id = json.loads(r.content)["id"]
    p = api_client.post(f"/api/inventory/adjustments/{adj_id}/", **headers)
    assert p.status_code == 200, p.content
    return adj_id


def test_loss_adjustment_posts_shrinkage_and_corrects_stock(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    cid = company_tenant_with_gl.id
    _shrink_account(cid)
    st = _station(cid)
    item = _shop_item(cid)
    set_station_stock(cid, st.id, item.id, Decimal("10"))

    adj_id = _create_and_post(api_client, auth_admin_headers, cid, st, item, "7")

    # Stock corrected down to the counted quantity.
    assert get_station_stock(cid, st.id, item.id) == Decimal("7")
    item.refresh_from_db()
    assert item.quantity_on_hand == Decimal("7")

    # Loss of 3 units x cost 5 = 15: Dr 5210 / Cr 1220.
    by_code = {ln.account.account_code: ln for ln in _lines(cid, adj_id)}
    assert by_code["5210"].debit == Decimal("15.00")
    assert by_code["1220"].credit == Decimal("15.00")

    pl = report_income_statement(cid, date(2026, 1, 1), date(2026, 12, 31))
    assert Decimal(str(pl["cost_of_goods_sold"]["total"])) == Decimal("15.00")


def test_gain_adjustment_credits_shrinkage(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    cid = company_tenant_with_gl.id
    _shrink_account(cid)
    st = _station(cid)
    item = _shop_item(cid)
    set_station_stock(cid, st.id, item.id, Decimal("10"))

    adj_id = _create_and_post(api_client, auth_admin_headers, cid, st, item, "14")

    assert get_station_stock(cid, st.id, item.id) == Decimal("14")
    # Gain of 4 x 5 = 20: Dr 1220 / Cr 5210.
    by_code = {ln.account.account_code: ln for ln in _lines(cid, adj_id)}
    assert by_code["1220"].debit == Decimal("20.00")
    assert by_code["5210"].credit == Decimal("20.00")


def test_unpost_restores_stock_and_removes_journal(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    cid = company_tenant_with_gl.id
    _shrink_account(cid)
    st = _station(cid)
    item = _shop_item(cid)
    set_station_stock(cid, st.id, item.id, Decimal("10"))

    adj_id = _create_and_post(api_client, auth_admin_headers, cid, st, item, "7")
    assert get_station_stock(cid, st.id, item.id) == Decimal("7")

    u = api_client.post(f"/api/inventory/adjustments/{adj_id}/unpost/", **auth_admin_headers)
    assert u.status_code == 200, u.content
    assert json.loads(u.content)["status"] == "draft"
    assert get_station_stock(cid, st.id, item.id) == Decimal("10")
    assert not JournalEntry.objects.filter(
        company_id=cid, entry_number=f"AUTO-INVADJ-{adj_id}"
    ).exists()


def test_fallback_to_5120_when_no_5210(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    """When 5210 is not in the chart, shrinkage falls back to 5120 COGS (still a COGS bucket)."""
    cid = company_tenant_with_gl.id
    st = _station(cid)
    item = _shop_item(cid)
    set_station_stock(cid, st.id, item.id, Decimal("10"))

    adj_id = _create_and_post(api_client, auth_admin_headers, cid, st, item, "8")
    by_code = {ln.account.account_code: ln for ln in _lines(cid, adj_id)}
    assert by_code["5120"].debit == Decimal("10.00")  # loss 2 x 5
    assert by_code["1220"].credit == Decimal("10.00")


def test_rejects_non_shop_item(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    cid = company_tenant_with_gl.id
    st = _station(cid)
    svc = Item.objects.create(
        company_id=cid,
        name="Car wash service",
        item_type="service",
        category="General",
        cost=Decimal("0"),
        unit_price=Decimal("100"),
        is_active=True,
    )
    r = api_client.post(
        "/api/inventory/adjustments/",
        data=json.dumps(
            {"station_id": st.id, "lines": [{"item_id": svc.id, "counted_quantity": "3"}]}
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400, r.content


def test_post_is_idempotent(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    cid = company_tenant_with_gl.id
    _shrink_account(cid)
    st = _station(cid)
    item = _shop_item(cid)
    set_station_stock(cid, st.id, item.id, Decimal("10"))

    adj_id = _create_and_post(api_client, auth_admin_headers, cid, st, item, "7")
    # Posting again must be rejected (already posted) and never double-book.
    again = api_client.post(f"/api/inventory/adjustments/{adj_id}/", **auth_admin_headers)
    assert again.status_code == 400, again.content
    assert (
        JournalEntry.objects.filter(
            company_id=cid, entry_number=f"AUTO-INVADJ-{adj_id}"
        ).count()
        == 1
    )
    assert get_station_stock(cid, st.id, item.id) == Decimal("7")
