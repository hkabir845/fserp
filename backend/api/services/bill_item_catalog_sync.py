"""
Bill line -> Item catalog write-back.

An Item line on a vendor bill can edit the catalog fields of the item it points at (the
"Edit item" panel on the line). Saving the bill applies those edits to the Item, so the
catalog and the next bill that uses the item agree with what was just typed.

Two sources feed the write-back for one line:

- ``item_catalog`` on the line row: name / description / unit / category / unit_price, i.e.
  the fields the inline panel exposes. Only keys actually present are touched.
- the line Rate (``unit_cost``): the newest bill rate becomes ``Item.cost``.

The Rate mirror is applied AFTER posting and the AVCO reconciliation
(``recompute_item_average_cost``), so the rate the owner typed is what survives the save
instead of being replaced by the weighted average of the receipt history.

Line pieces_per_kg is also written here (from the Line field / item_catalog) AFTER posting,
so Update Bill keeps the number the owner typed instead of the old catalog value.
Weight/heads still derive from it during parse in ``api.views.bill_views._parse_bill_line_fish_dims``.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from api.models import Item
from api.services.item_name_uniqueness import (
    find_item_name_conflict,
    normalize_item_name_for_storage,
)
from api.services.item_reporting_categories import normalize_item_reporting_category

# Catalog fields the bill line's "Edit item" panel may write.
CATALOG_PANEL_FIELDS = ("name", "description", "unit", "category", "unit_price", "pieces_per_kg")


def _decimal_or_none(raw):
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    try:
        return Decimal(str(raw))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _implied_pieces_per_kg(row: dict) -> Decimal | None:
    """heads ÷ weight on this bill row — the Line actually used, e.g. 64878 ÷ 7483.05 ≈ 8.67."""
    c_raw = row.get("aquaculture_fish_count")
    w_raw = row.get("aquaculture_fish_weight_kg")
    if c_raw in (None, "") or w_raw in (None, ""):
        return None
    try:
        heads = int(c_raw)
    except (TypeError, ValueError):
        return None
    weight = _decimal_or_none(w_raw)
    if heads <= 0 or weight is None or weight <= 0:
        return None
    return (Decimal(heads) / weight).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def _pcs_disagree(a: Decimal, b: Decimal) -> bool:
    if a <= 0 or b <= 0:
        return False
    return abs(a - b) / max(a, b) > Decimal("0.005")


def effective_bill_line_pieces_per_kg(row: dict) -> tuple[Decimal | None, str | None]:
    """
    Line (pcs/kg) to store on the Item from this bill row.

    Typed ``pieces_per_kg`` is kept when it matches heads÷kg (or weight is still blank).
    If the payload still says catalog 3000 while this bill's heads and kg imply 8.67,
    8.67 wins so Update Bill cannot snap the Item back to the old catalog.
    """
    implied = _implied_pieces_per_kg(row)
    raw = row.get("pieces_per_kg", row.get("fish_pcs_per_kg"))
    panel = row.get("item_catalog") if isinstance(row.get("item_catalog"), dict) else None
    if raw in (None, "") and panel is not None and "pieces_per_kg" in panel:
        raw = panel.get("pieces_per_kg")

    typed = None
    if raw not in (None, ""):
        typed = _decimal_or_none(raw)
        if typed is None or typed <= 0:
            return None, "pieces_per_kg must be a number greater than zero."
        typed = typed.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)

    if implied is not None:
        if typed is not None and not _pcs_disagree(typed, implied):
            return typed, None
        return implied, None
    return typed, None


def _money(value: Decimal) -> Decimal:
    """Item.cost / Item.unit_price are 2dp — quantize here so re-saving a bill is a no-op."""
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _coerce_item_id(row: dict):
    """Same rule as ``bill_views._coerce_item_id`` — only a row that becomes an Item line counts."""
    raw = row.get("item_id")
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def parse_bill_line_item_catalog_updates(
    company_id: int, lines_body: list | None
) -> tuple[dict[int, dict], str | None]:
    """
    Build ``{item_id: {field: value}}`` from the request lines.

    Later lines win over earlier ones when the same item appears twice on a bill.
    Returns ``(updates, error_detail_or_None)``; a non-None detail is a 400 for the caller.
    """
    updates: dict[int, dict] = {}
    for idx, row in enumerate(lines_body or [], start=1):
        if not isinstance(row, dict):
            continue
        item_id = _coerce_item_id(row)
        if not item_id:
            continue
        item = (
            Item.objects.filter(pk=item_id, company_id=company_id)
            .only(
                "id",
                "name",
                "description",
                "unit",
                "category",
                "unit_price",
                "cost",
                "pieces_per_kg",
            )
            .first()
        )
        if not item:
            continue
        fields = updates.setdefault(item_id, {})

        # Line Rate -> Item.cost (last bill rate is the purchase cost).
        rate = _decimal_or_none(row.get("unit_cost", row.get("unit_price")))
        if rate is not None and rate > 0:
            fields["cost"] = _money(rate)

        # Line (pcs/kg): typed value, else heads÷kg on this bill. Stale catalog 3000
        # is ignored when this row's heads and kg already imply 8.67.
        ppk, ppk_err = effective_bill_line_pieces_per_kg(row)
        if ppk_err:
            return {}, f"Line {idx}: {ppk_err}"
        if ppk is not None:
            fields["pieces_per_kg"] = ppk

        panel = row.get("item_catalog")
        if not isinstance(panel, dict):
            continue

        if "name" in panel:
            nm = normalize_item_name_for_storage(panel.get("name"))
            if nm:  # blank keeps the existing name, as on the item form
                conflict = find_item_name_conflict(company_id, nm, exclude_pk=item_id)
                if conflict:
                    return {}, (
                        f"Line {idx}: another item already uses the name \"{conflict.name}\" "
                        f"({conflict.item_number or 'no item number'}). Pick a different name."
                    )
                fields["name"] = nm

        if "description" in panel:
            fields["description"] = str(panel.get("description") or "")[:10000]

        if "unit" in panel:
            unit = str(panel.get("unit") or "").strip()[:20]
            if unit:  # blank keeps the existing unit
                fields["unit"] = unit

        if "category" in panel:
            cat = normalize_item_reporting_category(panel.get("category"))
            if not cat:
                return {}, (
                    f"Line {idx}: item category cannot be empty. "
                    "Set a reporting category for this product."
                )
            fields["category"] = cat

        if "unit_price" in panel:
            up = _decimal_or_none(panel.get("unit_price"))
            if up is None:
                return {}, f"Line {idx}: invalid item unit_price."
            if up < 0:
                return {}, f"Line {idx}: item unit_price cannot be negative."
            fields["unit_price"] = _money(up)

    return {item_id: f for item_id, f in updates.items() if f}, None


def apply_bill_line_item_catalog_updates(company_id: int, updates: dict[int, dict]) -> int:
    """Write the parsed updates onto the Items. Returns how many items changed."""
    changed = 0
    for item_id, fields in (updates or {}).items():
        item = (
            Item.objects.filter(pk=item_id, company_id=company_id)
            .only(
                "id",
                "name",
                "description",
                "unit",
                "category",
                "unit_price",
                "cost",
                "pieces_per_kg",
            )
            .first()
        )
        if not item:
            continue
        diff = {k: v for k, v in fields.items() if getattr(item, k, None) != v}
        if not diff:
            continue
        Item.objects.filter(pk=item_id, company_id=company_id).update(**diff)
        changed += 1
    return changed
