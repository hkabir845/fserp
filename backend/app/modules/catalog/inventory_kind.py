"""How an item relates to stocked inventory — ERP-friendly primary classification."""

INVENTORY_KINDS = frozenset({"inventory", "non_inventory", "service", "other"})


def infer_inventory_kind(
    *,
    type_value: str | None,
    is_stock_tracked: bool,
    stored_kind: str | None = None,
) -> str:
    """Resolve effective kind for API responses and reconciliation."""
    if type_value == "service":
        return "service"
    if is_stock_tracked:
        return "inventory"
    # Untracked, non-service: preserve explicit 'other' label; else default to non-inventory
    if stored_kind == "other":
        return "other"
    return "non_inventory"


def apply_inventory_rules(
    inventory_kind: str,
    *,
    type_value: str | None,
) -> tuple[str, bool]:
    """
    Returns (type, is_stock_tracked) after applying kind rules.
    Service kind always forces type=service and not stock-tracked.
    """
    if inventory_kind not in INVENTORY_KINDS:
        raise ValueError(f"inventory_kind must be one of {sorted(INVENTORY_KINDS)}")

    if inventory_kind == "service":
        return "service", False

    t = (type_value or "raw_material").strip()
    if t == "service":
        t = "raw_material"

    if inventory_kind == "inventory":
        return t, True

    # non_inventory, other: no quantity-on-hand tracking in this system
    return t, False
