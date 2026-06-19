"""Auto-generated empty feed sacks when feed is consumed at ponds."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import AquacultureExpense, AquacultureFishSale, AquaculturePond, ChartOfAccount, Company, Item, ItemPondStock
from api.services.aquaculture_empty_sack_service import (
    EMPTY_SACK_ITEM_NUMBER,
    ensure_empty_feed_sack_catalog_item,
    feed_sacks_opened_from_kg,
    is_empty_feed_sack_sale_income,
)
from api.services.aquaculture_expense_cleanup import cleanup_aquaculture_expense_posting_effects
from api.services.aquaculture_pond_stock_service import add_pond_stock, consume_pond_warehouse_stock, get_pond_item_stock
from api.services.aquaculture_sale_cleanup import cleanup_aquaculture_fish_sale_effects


def _enable_aq(c: Company) -> None:
    Company.objects.filter(pk=c.id).update(aquaculture_enabled=True, aquaculture_licensed=True)


def _feed_item(company_id: int, *, sack_kg: int = 25) -> Item:
    inv = ChartOfAccount.objects.filter(company_id=company_id, account_type="asset", is_active=True).first()
    cogs = ChartOfAccount.objects.filter(
        company_id=company_id, account_type="cost_of_goods_sold", is_active=True
    ).first()
    return Item.objects.create(
        company_id=company_id,
        name="Grower feed 25kg",
        item_number=f"FEED-TEST-{sack_kg}",
        unit="sack",
        content_weight_kg=Decimal(sack_kg),
        item_type="inventory",
        quantity_on_hand=Decimal("100"),
        cost=Decimal("2000"),
        inventory_account=inv,
        cogs_account=cogs,
    )


@pytest.mark.parametrize(
    ("applied_kg", "sack_kg", "expected"),
    [
        (Decimal("10"), Decimal("25"), Decimal("1")),
        (Decimal("25"), Decimal("25"), Decimal("1")),
        (Decimal("26"), Decimal("25"), Decimal("2")),
        (Decimal("30"), Decimal("10"), Decimal("3")),
    ],
)
def test_feed_sacks_opened_from_kg_uses_ceil(applied_kg, sack_kg, expected):
    assert feed_sacks_opened_from_kg(applied_kg, sack_kg) == expected


@pytest.mark.django_db
def test_consume_feed_creates_empty_sacks_at_pond(company_tenant_with_gl):
    company_tenant = company_tenant_with_gl
    _enable_aq(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="P-empty", is_active=True)
    feed = _feed_item(cid, sack_kg=25)
    add_pond_stock(cid, pond.id, feed.id, Decimal("10"))

    exp = consume_pond_warehouse_stock(
        company_id=cid,
        pond=pond,
        production_cycle_id=None,
        expense_category="feed_consumed",
        expense_date=date(2026, 6, 1),
        item=feed,
        quantity=Decimal("0.4"),
        memo="10 kg from 25 kg sack",
        feed_weight_kg=Decimal("10"),
    )

    assert exp.empty_sack_count == Decimal("1")
    assert exp.feed_sack_count == Decimal("1")
    empty = Item.objects.get(company_id=cid, item_number=EMPTY_SACK_ITEM_NUMBER)
    assert get_pond_item_stock(cid, pond.id, empty.id) == Decimal("1")


@pytest.mark.django_db
def test_delete_feed_consumption_reverses_empty_sacks(company_tenant_with_gl):
    company_tenant = company_tenant_with_gl
    _enable_aq(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="P-rev", is_active=True)
    feed = _feed_item(cid)
    add_pond_stock(cid, pond.id, feed.id, Decimal("5"))
    exp = consume_pond_warehouse_stock(
        company_id=cid,
        pond=pond,
        production_cycle_id=None,
        expense_category="feed_consumed",
        expense_date=date(2026, 6, 2),
        item=feed,
        quantity=Decimal("0.4"),
        memo="feed",
        feed_weight_kg=Decimal("10"),
    )
    empty = ensure_empty_feed_sack_catalog_item(cid)
    assert get_pond_item_stock(cid, pond.id, empty.id) == Decimal("1")

    cleanup_aquaculture_expense_posting_effects(cid, exp.id)
    AquacultureExpense.objects.filter(pk=exp.id).delete()

    assert get_pond_item_stock(cid, pond.id, empty.id) == Decimal("0")


@pytest.mark.django_db
def test_empty_feed_sack_sale_deducts_pond_stock(company_tenant):
    _enable_aq(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="P-sell", is_active=True)
    empty = ensure_empty_feed_sack_catalog_item(cid)
    ItemPondStock.objects.create(company_id=cid, pond=pond, item=empty, quantity=Decimal("5"))

    sale = AquacultureFishSale.objects.create(
        company_id=cid,
        pond=pond,
        income_type="empty_feed_sack_sale",
        fish_species="not_applicable",
        sale_date=date(2026, 6, 3),
        weight_kg=Decimal("2"),
        total_amount=Decimal("100.00"),
    )
    from api.services.aquaculture_empty_sack_service import deduct_empty_sacks_for_sale

    deduct_empty_sacks_for_sale(cid, pond.id, Decimal("2"))
    assert get_pond_item_stock(cid, pond.id, empty.id) == Decimal("3")

    ok, err = cleanup_aquaculture_fish_sale_effects(cid, sale)
    assert ok, err
    sale.delete()
    assert get_pond_item_stock(cid, pond.id, empty.id) == Decimal("5")


@pytest.mark.django_db
def test_empty_sack_sale_api_blocks_insufficient_stock(api_client, company_tenant, auth_admin_headers):
    _enable_aq(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="P-api", is_active=True)
    ensure_empty_feed_sack_catalog_item(cid)

    r = api_client.post(
        "/api/aquaculture/sales/",
        {
            "pond_id": pond.id,
            "sale_date": "2026-06-04",
            "income_type": "empty_feed_sack_sale",
            "weight_kg": "3",
            "total_amount": "150",
        },
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400, r.content.decode()
    assert "empty" in r.json()["detail"].lower()


def test_is_empty_feed_sack_sale_income():
    assert is_empty_feed_sack_sale_income("empty_feed_sack_sale")
    assert not is_empty_feed_sack_sale_income("fish_harvest_sale")
