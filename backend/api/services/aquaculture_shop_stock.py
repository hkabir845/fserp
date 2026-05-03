"""
Optional internal path: issue shop inventory to a pond at average cost (no POS invoice).

Preferred workflow in product copy: sell inventoried feed/medicine/supplies via Cashier (POS) on account to the
pond’s linked customer so quantities and AR/revenue follow standard retail posting. Use this service only for true
at-cost internal transfers—and never for the same physical goods already sold on POS (avoids double-counting).
"""
from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal

from django.db import transaction
from django.db.models import F

from api.exceptions import GlPostingError, StockBusinessError
from api.models import AquacultureExpense, AquaculturePond, AquacultureProductionCycle, Item, Station
from api.services.gl_posting import (
    _item_receives_physical_stock,
    item_inventory_unit_cost,
    item_tracks_physical_stock,
    post_aquaculture_shop_stock_issue_journal,
)
from api.services.inventory_validation import assert_pos_general_lines_within_qoh
from api.services.station_stock import decrement_station_lines, item_uses_station_bins

logger = logging.getLogger(__name__)


def _parse_shop_issue_items(company_id: int, raw: list) -> list[dict]:
    """Build POS-shaped line dicts: item, quantity, unit_price, amount (amount ignored for stock)."""
    if not isinstance(raw, list) or not raw:
        raise StockBusinessError("items must be a non-empty array of {item_id, quantity}.")
    lines_data: list[dict] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        item_id = row.get("item_id")
        qty = row.get("quantity")
        if item_id is None or qty is None:
            continue
        try:
            iid = int(item_id)
            q = Decimal(str(qty))
        except (TypeError, ValueError, Exception):
            continue
        if q <= 0:
            continue
        item = Item.objects.filter(pk=iid, company_id=company_id).first()
        if not item:
            raise StockBusinessError(f"Unknown item_id {item_id} for this company.")
        if not item_tracks_physical_stock(item):
            raise StockBusinessError(
                f'"{item.name}" is not tracked as physical inventory; pick an inventory item (feed, medicine, etc.).'
            )
        if not _item_receives_physical_stock(item):
            raise StockBusinessError(f'"{item.name}" has no stock movement for this operation.')
        up = item.unit_price or Decimal("0")
        lines_data.append(
            {
                "item": item,
                "quantity": q,
                "unit_price": up,
                "discount_percent": Decimal("0"),
                "amount": (q * up).quantize(Decimal("0.01")),
            }
        )
    if not lines_data:
        raise StockBusinessError("No valid lines. Send items: [{item_id, quantity}, …].")
    return lines_data


def _total_cost_at_issue(lines_data: list[dict]) -> Decimal:
    total = Decimal("0")
    for d in lines_data:
        it = d["item"]
        q = d["quantity"]
        uc = item_inventory_unit_cost(it)
        if uc <= 0:
            raise StockBusinessError(
                f'Set a cost (or unit price) on "{it.name}" before issuing shop stock to a pond.'
            )
        total += (q * uc).quantize(Decimal("0.01"))
    return total.quantize(Decimal("0.01"))


def _decrement_shop_stock(company_id: int, station_id: int, lines_data: list) -> None:
    decrement_station_lines(company_id, station_id, lines_data)
    for d in lines_data:
        it = d["item"]
        if not _item_receives_physical_stock(it) or it.quantity_on_hand is None:
            continue
        if item_uses_station_bins(company_id, it):
            continue
        Item.objects.filter(pk=it.pk, company_id=company_id).update(
            quantity_on_hand=F("quantity_on_hand") - d["quantity"]
        )


def execute_aquaculture_shop_stock_issue(
    *,
    company_id: int,
    station_id: int,
    pond_id: int,
    production_cycle_id: int | None,
    expense_category: str,
    expense_date: date,
    items: list,
    memo: str,
    vendor_name: str,
    feed_sack_count: Decimal | None = None,
    feed_weight_kg: Decimal | None = None,
) -> AquacultureExpense:
    """
    Validates pond/cycle; checks stock; creates expense; posts COGS/inventory journal; decrements shop stock.
    """
    st = Station.objects.filter(pk=station_id, company_id=company_id, is_active=True).first()
    if not st:
        raise StockBusinessError("Station not found or inactive for this company.")
    pond = AquaculturePond.objects.filter(pk=pond_id, company_id=company_id).first()
    if not pond:
        raise StockBusinessError("Pond not found for this company.")
    cycle_obj: AquacultureProductionCycle | None = None
    if production_cycle_id is not None:
        cycle_obj = AquacultureProductionCycle.objects.filter(
            pk=production_cycle_id, company_id=company_id
        ).first()
        if not cycle_obj:
            raise StockBusinessError("Production cycle not found for this company.")
        if cycle_obj.pond_id != pond.id:
            raise StockBusinessError("production_cycle_id does not belong to the selected pond.")

    lines_data = _parse_shop_issue_items(company_id, items)
    amt = _total_cost_at_issue(lines_data)

    memo_bits = [
        memo.strip() if memo else "",
        f"Shop issue from station #{station_id}",
    ]
    full_memo = " ".join(x for x in memo_bits if x).strip()[:5000]
    vend = (vendor_name or "").strip()[:200]

    with transaction.atomic():
        lines_data = _parse_shop_issue_items(company_id, items)
        assert_pos_general_lines_within_qoh(company_id, lines_data, station_id)
        amt = _total_cost_at_issue(lines_data)

        x = AquacultureExpense(
            company_id=company_id,
            pond=pond,
            production_cycle=cycle_obj,
            expense_category=expense_category,
            expense_date=expense_date,
            amount=amt,
            memo=full_memo,
            vendor_name=vend,
            source_station_id=station_id,
            feed_sack_count=feed_sack_count,
            feed_weight_kg=feed_weight_kg,
        )
        x.save()

        row_tuples: list[tuple[Item, Decimal]] = [(d["item"], d["quantity"]) for d in lines_data]
        posted = post_aquaculture_shop_stock_issue_journal(
            company_id,
            expense_id=x.id,
            entry_date=expense_date,
            station_id=station_id,
            line_rows=row_tuples,
        )
        if not posted:
            raise GlPostingError(
                "Could not post COGS / inventory journal (check chart of accounts for shop COGS and inventory)."
            )

        _decrement_shop_stock(company_id, station_id, lines_data)

    out = (
        AquacultureExpense.objects.filter(pk=x.pk)
        .select_related("pond", "production_cycle", "source_station")
        .prefetch_related("pond_shares__pond")
        .first()
    )
    assert out is not None
    return out

