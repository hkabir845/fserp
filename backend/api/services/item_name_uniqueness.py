"""Per-company item name uniqueness (case- and whitespace-insensitive)."""
from __future__ import annotations

import re
from collections import defaultdict
from decimal import Decimal
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from api.models import Item

_MAX_NAME_LEN = 200


def normalize_item_name_for_storage(raw) -> str:
    """Trim, collapse internal whitespace, max 200 chars — used for save + duplicate detection."""
    s = re.sub(r"\s+", " ", (str(raw or "").strip()))
    if len(s) > _MAX_NAME_LEN:
        return s[:_MAX_NAME_LEN]
    return s


def find_item_name_conflict(
    company_id: int,
    canonical_name: str,
    exclude_pk: int | None = None,
) -> Item | None:
    """Return another item in the company with the same normalized name, if any."""
    from api.models import Item

    key = normalize_item_name_for_storage(canonical_name).lower()
    if not key:
        return None
    qs = Item.objects.filter(company_id=company_id).only("id", "name", "item_number")
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    for row in qs:
        if normalize_item_name_for_storage(row.name).lower() == key:
            return row
    return None


def item_name_conflicts(
    company_id: int,
    canonical_name: str,
    exclude_pk: int | None = None,
) -> bool:
    return find_item_name_conflict(company_id, canonical_name, exclude_pk=exclude_pk) is not None


def item_name_conflict_detail(conflict: Item) -> str:
    ref = (getattr(conflict, "item_number", None) or "").strip() or f"#{conflict.id}"
    return (
        f'An item named "{conflict.name}" already exists in this company (ref {ref}). '
        "Use a different name or edit that product."
    )


def _usage_score(item_id: int, models: dict) -> tuple[int, int]:
    """Higher is better; lower item id wins ties."""
    Tank = models["Tank"]
    Nozzle = models["Nozzle"]
    BillLine = models["BillLine"]
    InvoiceLine = models["InvoiceLine"]
    ItemStationStock = models["ItemStationStock"]
    ItemPondStock = models["ItemPondStock"]

    score = 0
    score += Tank.objects.filter(product_id=item_id).count() * 1000
    score += Nozzle.objects.filter(product_id=item_id).count() * 500
    score += BillLine.objects.filter(item_id=item_id).count() * 50
    score += InvoiceLine.objects.filter(item_id=item_id).count() * 50
    st_qty = ItemStationStock.objects.filter(item_id=item_id).aggregate(
        total=models["Sum"]("quantity")
    )["total"]
    if st_qty and st_qty > 0:
        score += 20
    pond_qty = ItemPondStock.objects.filter(item_id=item_id).aggregate(
        total=models["Sum"]("quantity")
    )["total"]
    if pond_qty and pond_qty > 0:
        score += 20
    return score, -item_id


def _unique_renamed_item_name(
    company_id: int,
    base_name: str,
    item_id: int,
    item_number: str,
    Item,
) -> str:
    ref = (item_number or "").strip() or f"#{item_id}"
    suffix = f" ({ref})"
    head = base_name
    if len(head) + len(suffix) > _MAX_NAME_LEN:
        head = head[: _MAX_NAME_LEN - len(suffix)]
    candidate = f"{head}{suffix}"
    n = 2
    while find_item_name_conflict(company_id, candidate, exclude_pk=item_id):
        suffix = f" ({ref}-{n})"
        head = base_name
        if len(head) + len(suffix) > _MAX_NAME_LEN:
            head = head[: _MAX_NAME_LEN - len(suffix)]
        candidate = f"{head}{suffix}"
        n += 1
    return candidate


def dedupe_company_item_names(company_id: int) -> int:
    """Rename lower-priority duplicate item names within one company. Returns rows renamed."""
    from django.db.models import Sum

    from api.models import (
        BillLine,
        InvoiceLine,
        Item,
        ItemPondStock,
        ItemStationStock,
        Nozzle,
        Tank,
    )

    models = {
        "Tank": Tank,
        "Nozzle": Nozzle,
        "BillLine": BillLine,
        "InvoiceLine": InvoiceLine,
        "ItemStationStock": ItemStationStock,
        "ItemPondStock": ItemPondStock,
        "Sum": Sum,
    }

    rows = list(Item.objects.filter(company_id=company_id).order_by("id"))
    groups: dict[str, list[Item]] = defaultdict(list)
    for row in rows:
        key = normalize_item_name_for_storage(row.name).lower()
        if key:
            groups[key].append(row)

    renamed = 0
    for _key, group in groups.items():
        if len(group) < 2:
            continue
        ranked = sorted(
            group,
            key=lambda item: _usage_score(item.id, models),
            reverse=True,
        )
        keeper = ranked[0]
        for loser in ranked[1:]:
            new_name = _unique_renamed_item_name(
                company_id,
                normalize_item_name_for_storage(keeper.name),
                loser.id,
                loser.item_number or "",
                Item,
            )
            Item.objects.filter(pk=loser.pk).update(name=new_name)
            renamed += 1
    return renamed


def dedupe_all_company_item_names() -> int:
    from api.models import Item

    total = 0
    for company_id in Item.objects.values_list("company_id", flat=True).distinct():
        total += dedupe_company_item_names(company_id)
    return total
