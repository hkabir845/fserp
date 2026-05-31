"""G/L posting for inventory item opening stock at go-live.

Mirrors the customer/vendor/employee opening pattern: opening on-hand is capitalized to the
inventory asset (1200/1220 or the item's override) with the offset to Opening Balance Equity (3200),
so selling opening stock relieves a real asset instead of driving inventory negative.

Fish / biological SKUs are excluded here — those are capitalized via the aquaculture biological
opening (1581) and must not be double-booked.
"""
from __future__ import annotations

import logging
from decimal import Decimal

from django.db import transaction

from api.models import Item, JournalEntry
from api.services.gl_posting import _create_posted_entry, _inventory_account_for_item
from api.services.item_catalog import item_tracks_physical_stock
from api.services.loan_counterparty_opening import resolve_opening_balance_equity

logger = logging.getLogger(__name__)

_MONEY = Decimal("0.01")


def item_is_biological_stock(item: Item) -> bool:
    """Fish/biological SKUs are capitalized via the aquaculture biological opening (1581), not here."""
    return (getattr(item, "pos_category", None) or "").strip().lower() == "fish"


def item_opening_stock_value(item: Item) -> Decimal:
    """Opening inventory value = opening qty x opening unit cost (0 when either is unset)."""
    qty = item.opening_stock_quantity or Decimal("0")
    cost = item.opening_stock_unit_cost or Decimal("0")
    if qty <= 0 or cost <= 0:
        return Decimal("0")
    return (qty * cost).quantize(_MONEY)


def item_opening_fields_for_api(item: Item) -> dict:
    locked = bool(item.opening_balance_journal_id)
    je_num = ""
    if item.opening_balance_journal_id and item.opening_balance_journal:
        je_num = (item.opening_balance_journal.entry_number or "").strip()
    return {
        "opening_stock_quantity": str(item.opening_stock_quantity or Decimal("0")),
        "opening_stock_unit_cost": str(item.opening_stock_unit_cost or Decimal("0")),
        "opening_balance_date": item.opening_balance_date.isoformat() if item.opening_balance_date else None,
        "opening_balance_locked": locked,
        "opening_balance_journal_id": item.opening_balance_journal_id,
        "opening_balance_journal_number": je_num,
    }


def _entry_number(item_id: int) -> str:
    return f"AUTO-ITEM-OB-{item_id}"


def _remove_opening_gl(company_id: int, item_id: int) -> int:
    deleted, _ = JournalEntry.objects.filter(
        company_id=company_id, entry_number=_entry_number(item_id)
    ).delete()
    Item.objects.filter(pk=item_id, company_id=company_id).update(opening_balance_journal_id=None)
    return deleted


def post_item_opening_stock_gl(
    company_id: int, item: Item, *, post_to_gl: bool = True, force_repost: bool = False
) -> bool:
    """
    Capitalize opening stock: Dr inventory asset (1200/1220 or item override) / Cr Opening Balance Equity (3200).

    Idempotent via entry_number AUTO-ITEM-OB-{id}. Returns True when the journal exists/was created or
    nothing is needed; False only on a real posting failure (missing accounts or as-of date).
    """
    # Service / non-inventory / fish-biological items never carry item opening stock.
    if item_is_biological_stock(item) or not item_tracks_physical_stock(item):
        if item.opening_balance_journal_id:
            _remove_opening_gl(company_id, item.id)
            item.opening_balance_journal_id = None
        return True

    value = item_opening_stock_value(item)
    if value <= 0:
        if item.opening_balance_journal_id:
            _remove_opening_gl(company_id, item.id)
            item.opening_balance_journal_id = None
        return True
    if not item.opening_balance_date:
        return False
    if not post_to_gl:
        return True
    if item.opening_balance_journal_id and not force_repost:
        return True

    inv_acc = _inventory_account_for_item(company_id, item)
    equity = resolve_opening_balance_equity(company_id)
    if not inv_acc or not equity:
        logger.warning(
            "company %s item %s: missing inventory asset or Opening Balance Equity (3200) for opening stock G/L",
            company_id,
            item.id,
        )
        return False

    name = (item.name or f"Item #{item.id}").strip()[:120]
    memo = f"Opening stock — {name}"[:280]
    desc = f"Opening inventory — {name}"[:500]
    lines = [
        (inv_acc, value, Decimal("0"), memo),
        (equity, Decimal("0"), value, memo),
    ]

    with transaction.atomic():
        _remove_opening_gl(company_id, item.id)
        je = _create_posted_entry(company_id, item.opening_balance_date, _entry_number(item.id), desc, lines)
        if not je:
            return False
        Item.objects.filter(pk=item.pk, company_id=company_id).update(opening_balance_journal_id=je.id)
    item.opening_balance_journal_id = je.id
    return True


def apply_item_opening_stock_gl(company_id: int, item: Item, *, post_to_gl: bool = True) -> str | None:
    """Best-effort wrapper; returns a user-facing error string when posting was expected but failed."""
    if not post_item_opening_stock_gl(company_id, item, post_to_gl=post_to_gl):
        if post_to_gl and item_opening_stock_value(item) > 0 and item.opening_balance_date:
            return (
                "Could not post opening stock to the general ledger. "
                "Ensure the inventory asset account (1200/1220) and 3200 Opening Balance Equity exist."
            )
    return None
