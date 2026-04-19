"""
Product type (Item.item_type) semantics for inventory operations and GL.

**inventory** — Perpetual inventory: physical quantity matters. Vendor receipts increase
tanks and/or quantity_on_hand; POS and fulfillment validate and decrement QOH; invoice
COGS relieves inventory asset at cost when chart accounts exist.

**non_inventory** — Sold and purchased like a product, but not tracked as balance-sheet
stock (e.g. supplies expensed on purchase, drop-ship, or resale without bin tracking).
No operational stock checks; vendor bill hits expense (or purchases), not inventory asset;
no automatic COGS/inventory relief on sale from Item.cost.

**service** — Intangible / labor-style offering (car wash, labor). No stock; revenue
without inventory movement; cost of delivery is usually handled outside perpetual
inventory (payroll, manual expense) unless extended later with a cost-of-services path.
"""
from __future__ import annotations

from typing import Optional

from api.models import Item

# Normalized keys (Item stores lowercase snake_case; accept legacy hyphenated input)
TYPE_INVENTORY = "inventory"
TYPE_NON_INVENTORY = "non_inventory"
TYPE_SERVICE = "service"


def normalize_item_type(raw: Optional[str]) -> str:
    """Return canonical type key: inventory | non_inventory | service | unknown."""
    if not raw:
        return ""
    s = str(raw).strip().lower().replace("-", "_")
    if s == "noninventory":
        s = "non_inventory"
    if s in (TYPE_INVENTORY, TYPE_NON_INVENTORY, TYPE_SERVICE):
        return s
    return s or ""


def _legacy_fuel_like_for_stock(item: Item) -> bool:
    """
    Match gl_posting._is_fuel_item + name tokens for rows with nonstandard item_type.
    Kept here to avoid circular imports with gl_posting.
    """
    unit = (item.unit or "").lower()
    pos_cat = (item.pos_category or "").lower()
    cat = (item.category or "").lower()
    name = (item.name or "").lower()
    if unit in ("l", "liter", "litre", "gal", "gallon") or "fuel" in pos_cat or "fuel" in cat:
        return True
    fuel_name_tokens = (
        "diesel",
        "petrol",
        "gasoline",
        "gasohol",
        "octane",
        "premium",
        "mogas",
        "kerosene",
        "e85",
        "biodiesel",
        "lpg",
        "cng",
    )
    return any(tok in name for tok in fuel_name_tokens)


def item_tracks_physical_stock(item: Optional[Item]) -> bool:
    """
    True when the item participates in operational stock (tank receipt, shop QOH, POS checks).

    Explicit service and non-inventory never track stock. Inventory always does.
    Unknown/legacy labels fall back to fuel-like heuristics (backward compatibility).
    """
    if not item:
        return False
    itype = normalize_item_type(getattr(item, "item_type", None))
    if itype == TYPE_SERVICE or itype == TYPE_NON_INVENTORY:
        return False
    if itype == TYPE_INVENTORY:
        return True
    if not itype:
        return _legacy_fuel_like_for_stock(item)
    # Custom item_type strings: do not assume inventory unless fuel-like (safe default)
    return _legacy_fuel_like_for_stock(item)
