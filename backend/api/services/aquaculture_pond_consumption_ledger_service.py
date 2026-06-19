"""
Read-only ledger of feed and medicine consumed from each pond's warehouse.

Source: AquacultureExpense rows with expense_category in (feed_consumed, medicine_consumed).
These are created by:
  - consume_pond_warehouse_stock(): manual feed/medicine consumption.
  - consume_pond_feed_on_advice_apply(): feeding advice apply (links expense back via
    AquacultureFeedingAdvice.linked_expense).

The COGS / inventory journal is posted with entry_number AUTO-AQ-POND-{expense_id}-COGS.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from api.models import (
    AquacultureExpense,
    AquacultureFeedingAdvice,
    AquaculturePond,
    JournalEntry,
)


CONSUMPTION_KIND_LABELS: dict[str, str] = {
    "feed_consumed": "Feed",
    "medicine_consumed": "Medicine",
}

CONSUMPTION_CATEGORIES: frozenset[str] = frozenset(CONSUMPTION_KIND_LABELS.keys())


def _d(v) -> Decimal:
    if v is None:
        return Decimal("0")
    return Decimal(str(v))


def compute_pond_warehouse_consumption_rows(
    company_id: int,
    *,
    pond_id: int | None = None,
    production_cycle_id: int | None = None,
    kind: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 500,
) -> list[dict]:
    """
    Returns chronological (newest first) consumption rows.
    `kind` accepts 'feed', 'medicine', 'feed_consumed', 'medicine_consumed' — empty/None = both.
    """
    cid = company_id

    cats: set[str] = set(CONSUMPTION_CATEGORIES)
    k = (kind or "").strip().lower()
    if k in ("feed", "feed_consumed"):
        cats = {"feed_consumed"}
    elif k in ("medicine", "medicine_consumed", "med"):
        cats = {"medicine_consumed"}

    qs = (
        AquacultureExpense.objects.filter(
            company_id=cid,
            expense_category__in=cats,
            pond_id__isnull=False,
        )
        .select_related("pond", "production_cycle", "source_station")
        .prefetch_related("inventory_lines__item")
    )
    if pond_id is not None:
        qs = qs.filter(pond_id=pond_id)
    if production_cycle_id is not None:
        qs = qs.filter(production_cycle_id=production_cycle_id)
    if date_from is not None:
        qs = qs.filter(expense_date__gte=date_from)
    if date_to is not None:
        qs = qs.filter(expense_date__lte=date_to)
    qs = qs.order_by("-expense_date", "-id")
    if limit and limit > 0:
        qs = qs[: limit]

    expenses = list(qs)
    if not expenses:
        return []

    exp_ids = [x.id for x in expenses]

    # Map expense -> feeding advice (when applied via advice).
    advice_by_expense: dict[int, AquacultureFeedingAdvice] = {}
    for adv in AquacultureFeedingAdvice.objects.filter(
        company_id=cid, linked_expense_id__in=exp_ids
    ).only("id", "linked_expense_id", "target_date", "status", "applied_at"):
        if adv.linked_expense_id:
            advice_by_expense[adv.linked_expense_id] = adv

    # Map expense -> auto journal (entry_number AUTO-AQ-POND-{id}-COGS).
    expected_numbers = {f"AUTO-AQ-POND-{eid}-COGS": eid for eid in exp_ids}
    journal_by_expense: dict[int, JournalEntry] = {}
    for je in JournalEntry.objects.filter(
        company_id=cid, entry_number__in=list(expected_numbers.keys())
    ).only("id", "entry_number", "is_posted"):
        eid = expected_numbers.get(je.entry_number)
        if eid is not None:
            journal_by_expense[eid] = je

    pond_ids = {x.pond_id for x in expenses if x.pond_id is not None}
    pond_names: dict[int, str] = {}
    for p in AquaculturePond.objects.filter(company_id=cid, pk__in=pond_ids).only("id", "name"):
        pond_names[p.id] = (p.name or "").strip() or f"Pond #{p.id}"

    rows: list[dict] = []
    for x in expenses:
        cat = x.expense_category
        adv = advice_by_expense.get(x.id)
        je = journal_by_expense.get(x.id)
        cy_name = ""
        if x.production_cycle_id and getattr(x, "production_cycle", None):
            cy_name = (x.production_cycle.name or "").strip()
        source = "feeding_advice" if adv else "manual_consume"
        source_doc = (
            f"Feeding advice #{adv.id}" if adv else f"Pond consumption #{x.id}"
        )
        inv_lines = list(x.inventory_lines.all())
        item_id: int | None = None
        item_name = ""
        quantity: str | None = None
        unit = ""
        if inv_lines:
            first = inv_lines[0]
            item_id = first.item_id
            if getattr(first, "item", None):
                item_name = (first.item.name or "").strip()
                unit = (first.item.unit or "").strip() or "unit"
            quantity = str(_d(first.quantity))
        rows.append(
            {
                "id": x.id,
                "entry_date": x.expense_date.isoformat(),
                "kind": "feed" if cat == "feed_consumed" else "medicine",
                "kind_label": CONSUMPTION_KIND_LABELS.get(cat, cat),
                "pond_id": x.pond_id,
                "pond_name": pond_names.get(x.pond_id, ""),
                "production_cycle_id": x.production_cycle_id,
                "production_cycle_name": cy_name,
                "item_id": item_id,
                "item_name": item_name,
                "quantity": quantity,
                "unit": unit,
                "amount": str(_d(x.amount)),
                "feed_weight_kg": str(x.feed_weight_kg) if x.feed_weight_kg is not None else None,
                "feed_sack_count": (
                    str(x.feed_sack_count) if x.feed_sack_count is not None else None
                ),
                "empty_sack_count": (
                    str(x.empty_sack_count) if getattr(x, "empty_sack_count", None) is not None else None
                ),
                "memo": (x.memo or "").strip(),
                "vendor_name": (x.vendor_name or "").strip(),
                "source": source,
                "source_id": adv.id if adv else x.id,
                "source_doc": source_doc,
                "feeding_advice_id": adv.id if adv else None,
                "feeding_advice_target_date": (
                    adv.target_date.isoformat() if adv and adv.target_date else None
                ),
                "source_station_id": x.source_station_id,
                "journal_entry_id": je.id if je else None,
                "journal_entry_number": (je.entry_number or "") if je else "",
                "journal_is_posted": bool(je.is_posted) if je else False,
                "created_at": x.created_at.isoformat() if x.created_at else "",
            }
        )
    return rows
