"""
Reporting / merchandising categories for items (separate from POS tab: fuel vs general).

Used for item forms, report grouping, and API validation. Companies may add custom
values; presets cover fuel stations and aquaculture / ag retail.
"""
from __future__ import annotations

# Display order: General first, then domain groups; keep labels user-facing (Title Case).
SUGGESTED_ITEM_REPORTING_CATEGORIES: tuple[str, ...] = (
    "General",
    "Fuel",
    "Fish feed",
    "Poultry feed",
    "Medicine",
    "Pond care",
    "Aquaculture",
    "Fish buying and selling",
    "Equipment & tools",
    "Packaging & supplies",
    "Labor & services (non-POS description)",
    "Other",
)

DEFAULT_ITEM_REPORTING_CATEGORY = "General"
FUEL_REPORTING_CATEGORY = "Fuel"


def is_fuel_pos_category(pos_category: str | None) -> bool:
    pos = (pos_category or "").strip().lower()
    return pos == "fuel" or pos.startswith("fuel_") or pos.startswith("fuel-")


def normalize_item_reporting_category(raw) -> str | None:
    """
    Strip and cap length. Returns None if empty after trim (invalid for required saves).
    """
    if raw is None:
        return None
    s = " ".join(str(raw).strip().split())
    if not s:
        return None
    return s[:100]


def resolve_item_reporting_category_for_storage(
    category: str | None,
    pos_category: str | None,
) -> str:
    """
    Persisted reporting category. Fuel-tab (POS) products default to Fuel when still General.
    """
    cat = normalize_item_reporting_category(category) or DEFAULT_ITEM_REPORTING_CATEGORY
    if (
        cat.lower() == DEFAULT_ITEM_REPORTING_CATEGORY.lower()
        and is_fuel_pos_category(pos_category)
    ):
        return FUEL_REPORTING_CATEGORY
    return cat
