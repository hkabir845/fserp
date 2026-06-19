"""
Auto-generated empty feed sacks at ponds when feed is consumed from sacks.

Companies never purchase empty sacks; opening feed creates scrap inventory (ceil sack rule).
Empty sacks are sold via income_type empty_feed_sack_sale (weight_kg = sack count on sales).
"""
from __future__ import annotations

import math
from decimal import Decimal

from api.exceptions import StockBusinessError
from api.models import Item

EMPTY_SACK_ITEM_NUMBER = "AQ-EMPTY-SACK"
EMPTY_SACK_INCOME_TYPE = "empty_feed_sack_sale"


def feed_sack_size_kg(item: Item, sack_size_kg: int | None = None) -> Decimal | None:
    """Resolve kg per sack from item metadata or advice override."""
    if item.content_weight_kg is not None and item.content_weight_kg > 0:
        return Decimal(item.content_weight_kg)
    if sack_size_kg is not None and sack_size_kg > 0:
        return Decimal(sack_size_kg)
    unit_l = (item.unit or "").strip().lower()
    if unit_l in ("kg", "kilogram", "kilograms"):
        return None
    return Decimal("25")


def feed_sacks_opened_from_kg(applied_kg: Decimal, kg_per_sack: Decimal) -> Decimal:
    """Whole sacks opened when feed is used — any partial use counts as one sack (ceil)."""
    if applied_kg <= 0 or kg_per_sack <= 0:
        return Decimal("0")
    opened = math.ceil(float(applied_kg / kg_per_sack))
    return Decimal(max(opened, 0)).quantize(Decimal("1"))


def empty_sacks_opened_for_feed_consumption(
    *,
    item: Item,
    quantity: Decimal,
    feed_weight_kg: Decimal | None,
    sack_size_kg: int | None = None,
) -> Decimal:
    """
    Sacks opened (and thus empty sacks created) for a feed_consumed movement.
    Prefers feed_weight_kg when present; otherwise ceil(quantity) for sack-unit SKUs.
    """
    kg_per = feed_sack_size_kg(item, sack_size_kg)
    if kg_per is None or kg_per <= 0:
        return Decimal("0")
    if feed_weight_kg is not None and feed_weight_kg > 0:
        return feed_sacks_opened_from_kg(feed_weight_kg, kg_per)
    unit_l = (item.unit or "").strip().lower()
    if unit_l in ("kg", "kilogram", "kilograms"):
        return Decimal("0")
    if quantity > 0:
        return Decimal(math.ceil(float(quantity))).quantize(Decimal("1"))
    return Decimal("0")


def ensure_empty_feed_sack_catalog_item(company_id: int) -> Item:
    """Idempotent built-in empty sack SKU for pond warehouse scrap inventory."""
    item = Item.objects.filter(company_id=company_id, item_number=EMPTY_SACK_ITEM_NUMBER).first()
    if item:
        dirty: list[str] = []
        if (item.name or "").strip() != "Empty sacks":
            item.name = "Empty sacks"
            dirty.append("name")
        if (item.unit or "").strip().lower() != "sack":
            item.unit = "sack"
            dirty.append("unit")
        if (item.category or "").strip() != "Scrap":
            item.category = "Scrap"
            dirty.append("category")
        if (item.pos_category or "").lower() != "scrap":
            item.pos_category = "scrap"
            dirty.append("pos_category")
        if item.item_type != "inventory":
            item.item_type = "inventory"
            dirty.append("item_type")
        if not item.is_active:
            item.is_active = True
            dirty.append("is_active")
        if item.cost != Decimal("0"):
            item.cost = Decimal("0")
            dirty.append("cost")
        if item.unit_price != Decimal("0"):
            item.unit_price = Decimal("0")
            dirty.append("unit_price")
        if dirty:
            item.save(update_fields=dirty + ["updated_at"])
        return item

    return Item.objects.create(
        company_id=company_id,
        item_number=EMPTY_SACK_ITEM_NUMBER,
        name="Empty sacks",
        description=(
            "Auto-created when feed sacks are opened at a pond — not purchased. "
            "Sell via Pond sales → Empty feed sack sale."
        ),
        item_type="inventory",
        unit_price=Decimal("0"),
        cost=Decimal("0"),
        quantity_on_hand=Decimal("0"),
        unit="sack",
        pos_category="scrap",
        category="Scrap",
        is_active=True,
        is_pos_available=False,
    )


def apply_empty_sacks_from_feed_consumption(
    *,
    company_id: int,
    pond_id: int,
    item: Item,
    quantity: Decimal,
    feed_weight_kg: Decimal | None,
    sack_size_kg: int | None = None,
) -> Decimal:
    """Increment pond empty-sack inventory; returns sacks added (may be 0)."""
    from api.services.aquaculture_pond_stock_service import add_pond_stock

    opened = empty_sacks_opened_for_feed_consumption(
        item=item,
        quantity=quantity,
        feed_weight_kg=feed_weight_kg,
        sack_size_kg=sack_size_kg,
    )
    if opened <= 0:
        return Decimal("0")
    empty_item = ensure_empty_feed_sack_catalog_item(company_id)
    add_pond_stock(company_id, pond_id, empty_item.id, opened)
    return opened


def reverse_empty_sacks_from_feed_consumption(
    *,
    company_id: int,
    pond_id: int,
    empty_sack_count: Decimal | None,
) -> None:
    from api.services.aquaculture_pond_stock_service import add_pond_stock

    if empty_sack_count is None or empty_sack_count <= 0:
        return
    empty_item = Item.objects.filter(
        company_id=company_id, item_number=EMPTY_SACK_ITEM_NUMBER
    ).first()
    if not empty_item:
        return
    add_pond_stock(company_id, pond_id, empty_item.id, -empty_sack_count)


def is_empty_feed_sack_sale_income(income_type: str | None) -> bool:
    return (income_type or "").strip() == EMPTY_SACK_INCOME_TYPE


def assert_empty_sacks_available(company_id: int, pond_id: int, sack_count: Decimal) -> None:
    from api.services.aquaculture_pond_stock_service import get_pond_item_stock

    if sack_count <= 0:
        raise StockBusinessError("Sack count must be greater than zero.")
    empty_item = Item.objects.filter(
        company_id=company_id, item_number=EMPTY_SACK_ITEM_NUMBER
    ).first()
    if not empty_item:
        raise StockBusinessError(
            "No empty sacks on hand at this pond. Empty sacks are created automatically when feed is consumed."
        )
    qoh = get_pond_item_stock(company_id, pond_id, empty_item.id)
    if sack_count > qoh:
        need = sack_count.quantize(Decimal("0.0001"))
        have = qoh.quantize(Decimal("0.0001"))
        raise StockBusinessError(
            f"Not enough empty feed sacks at this pond: need {need}, have {have}. "
            "Empty sacks are created when feed is consumed from sacks."
        )


def deduct_empty_sacks_for_sale(company_id: int, pond_id: int, sack_count: Decimal) -> None:
    from api.services.aquaculture_pond_stock_service import add_pond_stock

    assert_empty_sacks_available(company_id, pond_id, sack_count)
    empty_item = ensure_empty_feed_sack_catalog_item(company_id)
    add_pond_stock(company_id, pond_id, empty_item.id, -sack_count)


def restore_empty_sacks_for_sale(company_id: int, pond_id: int, sack_count: Decimal) -> None:
    from api.services.aquaculture_pond_stock_service import add_pond_stock

    if sack_count <= 0:
        return
    empty_item = Item.objects.filter(
        company_id=company_id, item_number=EMPTY_SACK_ITEM_NUMBER
    ).first()
    if not empty_item:
        empty_item = ensure_empty_feed_sack_catalog_item(company_id)
    add_pond_stock(company_id, pond_id, empty_item.id, sack_count)


def reconcile_empty_sack_sale_stock(
    *,
    company_id: int,
    old_pond_id: int,
    old_income_type: str,
    old_sack_count: Decimal,
    new_pond_id: int,
    new_income_type: str,
    new_sack_count: Decimal,
) -> None:
    """Adjust pond empty-sack QOH when an empty-sack sale line is created, edited, or reclassified."""
    old_is = is_empty_feed_sack_sale_income(old_income_type)
    new_is = is_empty_feed_sack_sale_income(new_income_type)
    if old_is and old_sack_count > 0:
        restore_empty_sacks_for_sale(company_id, old_pond_id, old_sack_count)
    if new_is and new_sack_count > 0:
        deduct_empty_sacks_for_sale(company_id, new_pond_id, new_sack_count)
