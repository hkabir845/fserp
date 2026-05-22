"""
Pond-side inventory: transfer shop (station) stock to a pond warehouse, then consume on feeding advice apply.

Premium Agro–style hubs hold feed/medicine without fuel; goods move to each pond's store, then deduct on feeding advice apply (feed) or pond-warehouse consume (feed or medicine).
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date
from decimal import Decimal

from django.db import transaction
from django.db.models import F

from api.exceptions import GlPostingError, StockBusinessError
from api.models import (
    AquacultureExpense,
    AquacultureExpenseInventoryLine,
    AquaculturePond,
    AquacultureProductionCycle,
    Item,
    ItemPondStock,
    PondWarehouseInterPondTransfer,
    PondWarehouseInterPondTransferLine,
    PondWarehouseStockReceipt,
    PondWarehouseStockReceiptLine,
    Station,
)
from api.services.aquaculture_warehouse_group_service import assert_ponds_allow_inter_warehouse_transfer
from api.services.aquaculture_shop_stock import _parse_shop_issue_items, _total_cost_at_issue
from api.services.gl_posting import (
    _item_receives_physical_stock,
    item_inventory_unit_cost,
    item_tracks_physical_stock,
    post_aquaculture_pond_feed_consumption_journal,
)
from api.services.inventory_validation import assert_pos_general_lines_within_qoh
from api.services.station_stock import add_station_stock, decrement_station_lines, item_uses_station_bins

logger = logging.getLogger(__name__)

POND_WAREHOUSE_CONSUMPTION_CATEGORIES = frozenset({"feed_consumed", "medicine_consumed"})


def feed_inventory_qty_from_kg(
    item: Item,
    applied_kg: Decimal,
    sack_size_kg: int | None,
) -> Decimal:
    """Convert applied feed kg to inventory units (sacks or kg)."""
    unit_l = (item.unit or "").strip().lower()
    if unit_l in ("kg", "kilogram", "kilograms"):
        return applied_kg.quantize(Decimal("0.0001"))
    kg_per = item.content_weight_kg
    if kg_per is None or kg_per <= 0:
        if sack_size_kg is not None and sack_size_kg > 0:
            kg_per = Decimal(sack_size_kg)
        else:
            kg_per = Decimal("25")
    else:
        kg_per = Decimal(kg_per)
    if kg_per <= 0:
        raise StockBusinessError("Set content_weight_kg on the feed item (or sack size on the advice).")
    return (applied_kg / kg_per).quantize(Decimal("0.0001"))


def _fmt_qty(d: Decimal) -> str:
    s = format(d, "f")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s or "0"


def assert_pond_lines_within_qoh(company_id: int, pond_id: int, lines_data: list) -> None:
    per: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    for d in lines_data:
        item = d.get("item")
        if not item or not _item_receives_physical_stock(item):
            continue
        q = d.get("quantity")
        if q is None:
            continue
        try:
            qq = q if isinstance(q, Decimal) else Decimal(str(q))
        except Exception:
            continue
        if qq <= 0:
            continue
        per[item.pk] += qq
    if not per:
        return
    ids = sorted(per.keys())
    locked: dict[int, ItemPondStock] = {}
    for iid in ids:
        r, _ = ItemPondStock.objects.select_for_update().get_or_create(
            company_id=company_id,
            pond_id=pond_id,
            item_id=iid,
            defaults={"quantity": Decimal("0")},
        )
        locked[iid] = r
    pond = AquaculturePond.objects.filter(pk=pond_id, company_id=company_id).first()
    pond_label = (pond.name or f"Pond #{pond_id}").strip() if pond else str(pond_id)
    for iid, need in per.items():
        it = Item.objects.filter(pk=iid, company_id=company_id).only("name", "unit").first()
        if not it:
            continue
        r = locked.get(iid)
        if not r:
            continue
        qoh = r.quantity if r.quantity is not None else Decimal("0")
        if need > qoh:
            unit = (it.unit or "units").strip() or "units"
            raise StockBusinessError(
                f'Not enough "{it.name}" at {pond_label} warehouse: need {_fmt_qty(need)} {unit}, '
                f"have {_fmt_qty(qoh)} {unit}. Transfer stock from your shop station first."
            )


def get_pond_item_stock(company_id: int, pond_id: int, item_id: int) -> Decimal:
    row = (
        ItemPondStock.objects.filter(company_id=company_id, pond_id=pond_id, item_id=item_id)
        .only("quantity")
        .first()
    )
    if not row:
        return Decimal("0")
    return row.quantity if row.quantity is not None else Decimal("0")


def add_pond_stock(company_id: int, pond_id: int, item_id: int, qty_delta: Decimal) -> None:
    if qty_delta == 0:
        return
    row, _ = ItemPondStock.objects.select_for_update().get_or_create(
        company_id=company_id,
        pond_id=pond_id,
        item_id=item_id,
        defaults={"quantity": Decimal("0")},
    )
    ItemPondStock.objects.filter(pk=row.pk).update(quantity=F("quantity") + qty_delta)
    from api.services.station_stock import refresh_item_quantity_on_hand

    refresh_item_quantity_on_hand(company_id, item_id)


def decrement_pond_lines(company_id: int, pond_id: int, lines_data: list) -> None:
    for d in lines_data:
        item = d.get("item")
        if not item:
            continue
        q = d.get("quantity")
        if q is None:
            continue
        try:
            qq = q if isinstance(q, Decimal) else Decimal(str(q))
        except Exception:
            continue
        if qq <= 0:
            continue
        add_pond_stock(company_id, pond_id, item.id, -qq)


@transaction.atomic
def transfer_station_stock_to_pond_warehouse(
    *,
    company_id: int,
    station_id: int,
    pond_id: int,
    items: list,
) -> None:
    """
    Move inventory from a station bin to the pond warehouse. No expense or COGS (still company inventory).
    Only station-tracked shop SKUs (same rules as shop issue).
    """
    st = Station.objects.filter(pk=station_id, company_id=company_id, is_active=True).first()
    if not st:
        raise StockBusinessError("Station not found or inactive for this company.")
    pond = AquaculturePond.objects.filter(pk=pond_id, company_id=company_id).first()
    if not pond:
        raise StockBusinessError("Pond not found for this company.")

    lines_data = _parse_shop_issue_items(company_id, items)
    for d in lines_data:
        if not item_uses_station_bins(company_id, d["item"]):
            raise StockBusinessError(
                "Pond warehouse transfer only supports shop items tracked per station. "
                "Use a station-stocked feed/medicine SKU (not tank fuel or non_pos hatchery stock)."
            )
    assert_pos_general_lines_within_qoh(company_id, lines_data, station_id)
    decrement_station_lines(company_id, station_id, lines_data)
    for d in lines_data:
        add_pond_stock(company_id, pond_id, d["item"].id, d["quantity"])

    rec = PondWarehouseStockReceipt.objects.create(
        company_id=company_id,
        from_station_id=st.id,
        pond_id=pond.id,
    )
    PondWarehouseStockReceipt.objects.filter(pk=rec.pk).update(
        receipt_number=f"PWR-{rec.pk}",
    )
    for d in lines_data:
        PondWarehouseStockReceiptLine.objects.create(
            receipt_id=rec.pk,
            item_id=d["item"].id,
            quantity=d["quantity"],
        )


@transaction.atomic
def reverse_pond_warehouse_stock_receipt(*, company_id: int, receipt_id: int) -> None:
    """
    Undo a shop → pond warehouse move: return quantities to the source station bin, remove from pond.
    Fails if the pond no longer holds enough of any line (e.g. already consumed).
    """
    rec = (
        PondWarehouseStockReceipt.objects.select_for_update()
        .filter(pk=receipt_id, company_id=company_id)
        .select_related("pond", "from_station")
        .first()
    )
    if not rec:
        raise StockBusinessError("Pond warehouse receipt not found.")
    lines = list(
        PondWarehouseStockReceiptLine.objects.filter(receipt_id=rec.pk).select_related("item")
    )
    if not lines:
        raise StockBusinessError("Receipt has no lines.")
    for ln in lines:
        it = ln.item
        qty = ln.quantity if ln.quantity is not None else Decimal("0")
        if qty <= 0:
            continue
        if not item_uses_station_bins(company_id, it):
            raise StockBusinessError(
                f'"{(it.name or "").strip()}" cannot be moved via pond warehouse reversal (not a station-bin SKU).'
            )
        have = get_pond_item_stock(company_id, rec.pond_id, it.id)
        if have < qty:
            raise StockBusinessError(
                f'Not enough "{(it.name or "").strip()}" at pond warehouse to reverse this receipt: '
                f"need {_fmt_qty(qty)} but only {_fmt_qty(have)} remain (may have been consumed)."
            )
    for ln in lines:
        it = ln.item
        qty = ln.quantity if ln.quantity is not None else Decimal("0")
        if qty <= 0:
            continue
        add_pond_stock(company_id, rec.pond_id, it.id, -qty)
        add_station_stock(company_id, rec.from_station_id, it.id, qty)
    PondWarehouseStockReceipt.objects.filter(pk=rec.pk).delete()


@transaction.atomic
def transfer_pond_warehouse_between_ponds(
    *,
    company_id: int,
    from_pond_id: int,
    to_pond_id: int,
    items: list,
    memo: str = "",
) -> PondWarehouseInterPondTransfer:
    """
    Move feed/medicine allocation from one pond warehouse to another (no GL).
    Allowed between private ponds, or between members of the same shared warehouse group.
    """
    from_pond = AquaculturePond.objects.filter(pk=from_pond_id, company_id=company_id).first()
    to_pond = AquaculturePond.objects.filter(pk=to_pond_id, company_id=company_id).first()
    if not from_pond or not to_pond:
        raise StockBusinessError("Source or destination pond not found for this company.")
    assert_ponds_allow_inter_warehouse_transfer(company_id, from_pond, to_pond)

    lines_data = _parse_shop_issue_items(company_id, items)
    for d in lines_data:
        if not item_uses_station_bins(company_id, d["item"]):
            raise StockBusinessError(
                "Pond-to-pond transfer only supports shop-style feed/medicine SKUs (station-bin inventory)."
            )
    assert_pond_lines_within_qoh(company_id, from_pond_id, lines_data)
    decrement_pond_lines(company_id, from_pond_id, lines_data)
    for d in lines_data:
        add_pond_stock(company_id, to_pond_id, d["item"].id, d["quantity"])

    xfer = PondWarehouseInterPondTransfer.objects.create(
        company_id=company_id,
        from_pond_id=from_pond.id,
        to_pond_id=to_pond.id,
        memo=(memo or "")[:5000],
    )
    PondWarehouseInterPondTransfer.objects.filter(pk=xfer.pk).update(
        transfer_number=f"PWIP-{xfer.pk}",
    )
    for d in lines_data:
        PondWarehouseInterPondTransferLine.objects.create(
            transfer_id=xfer.pk,
            item_id=d["item"].id,
            quantity=d["quantity"],
        )
    return (
        PondWarehouseInterPondTransfer.objects.filter(pk=xfer.pk)
        .select_related("from_pond", "to_pond")
        .first()
        or xfer
    )


@transaction.atomic
def consume_pond_warehouse_stock(
    *,
    company_id: int,
    pond: AquaculturePond,
    production_cycle_id: int | None,
    expense_category: str,
    expense_date: date,
    item: Item,
    quantity: Decimal,
    memo: str,
    feed_weight_kg: Decimal | None = None,
    feed_sack_count: Decimal | None = None,
) -> AquacultureExpense:
    """
    Dr COGS / Cr inventory at average cost; creates expense; decrements pond warehouse.
    Use expense_category feed_consumed or medicine_consumed (same GL pattern as POS-less pond use).
    """
    ec = (expense_category or "").strip()
    if ec not in POND_WAREHOUSE_CONSUMPTION_CATEGORIES:
        raise StockBusinessError("expense_category must be feed_consumed or medicine_consumed.")
    if item.company_id != company_id:
        raise StockBusinessError("Item not found for this company.")
    if not item_tracks_physical_stock(item):
        raise StockBusinessError("Item must be a perpetual-inventory product.")
    if not _item_receives_physical_stock(item):
        raise StockBusinessError("This SKU is not set up for inventory movement.")
    if quantity <= 0:
        raise StockBusinessError("Consumption quantity must be greater than zero.")

    lines_data = [{"item": item, "quantity": quantity}]
    assert_pond_lines_within_qoh(company_id, pond.id, lines_data)
    amt = _total_cost_at_issue(lines_data)

    cycle_obj: AquacultureProductionCycle | None = None
    if production_cycle_id is not None:
        cycle_obj = AquacultureProductionCycle.objects.filter(
            pk=production_cycle_id, company_id=company_id
        ).first()
        if not cycle_obj:
            raise StockBusinessError("Production cycle not found for this company.")
        if cycle_obj.pond_id != pond.id:
            raise StockBusinessError("production_cycle_id does not belong to the selected pond.")

    x = AquacultureExpense(
        company_id=company_id,
        pond=pond,
        production_cycle=cycle_obj,
        expense_category=ec,
        expense_date=expense_date,
        amount=amt,
        memo=(memo or "")[:5000],
        vendor_name="",
        feed_weight_kg=feed_weight_kg,
        feed_sack_count=feed_sack_count,
    )
    x.save()

    AquacultureExpenseInventoryLine.objects.create(
        expense=x,
        item=item,
        quantity=quantity,
        source_station=None,
    )

    row_tuples: list[tuple[Item, Decimal]] = [(item, quantity)]
    posted = post_aquaculture_pond_feed_consumption_journal(
        company_id,
        expense_id=x.id,
        entry_date=expense_date,
        line_rows=row_tuples,
    )
    if not posted:
        raise GlPostingError(
            "Could not post COGS / inventory journal (check chart of accounts for shop COGS and inventory)."
        )

    decrement_pond_lines(company_id, pond.id, lines_data)

    out = (
        AquacultureExpense.objects.filter(pk=x.pk)
        .select_related("pond", "production_cycle")
        .first()
    )
    assert out is not None
    return out


@transaction.atomic
def consume_pond_feed_on_advice_apply(
    *,
    company_id: int,
    pond: AquaculturePond,
    production_cycle_id: int | None,
    advice_id: int,
    applied_kg: Decimal,
    sack_size_kg: int | None,
    feed_item_id: int,
    expense_date: date,
) -> AquacultureExpense:
    """Dr COGS / Cr inventory; creates feed_consumed expense; decrements pond warehouse."""
    item = Item.objects.filter(pk=feed_item_id, company_id=company_id).first()
    if not item:
        raise StockBusinessError("Feed item not found for this company.")

    qty = feed_inventory_qty_from_kg(item, applied_kg, sack_size_kg)
    if qty <= 0:
        raise StockBusinessError("Computed consumption quantity is zero.")

    sack_count: Decimal | None = None
    if item.content_weight_kg and item.content_weight_kg > 0:
        sack_count = (applied_kg / Decimal(item.content_weight_kg)).quantize(Decimal("0.0001"))
    elif sack_size_kg and sack_size_kg > 0:
        sack_count = (applied_kg / Decimal(sack_size_kg)).quantize(Decimal("0.0001"))

    memo = f"Pond warehouse feed consumed · feeding advice #{advice_id}"[:5000]
    return consume_pond_warehouse_stock(
        company_id=company_id,
        pond=pond,
        production_cycle_id=production_cycle_id,
        expense_category="feed_consumed",
        expense_date=expense_date,
        item=item,
        quantity=qty,
        memo=memo,
        feed_weight_kg=applied_kg,
        feed_sack_count=sack_count,
    )


def pond_warehouse_stock_rows(company_id: int, pond_id: int) -> list[dict]:
    rows = (
        ItemPondStock.objects.filter(company_id=company_id, pond_id=pond_id)
        .select_related("item")
        .order_by("item__name", "item_id")
    )
    out: list[dict] = []
    for r in rows:
        q = r.quantity if r.quantity is not None else Decimal("0")
        if q <= 0:
            continue
        it = r.item
        cw = it.content_weight_kg
        uc = item_inventory_unit_cost(it)
        out.append(
            {
                "item_id": it.id,
                "item_name": (it.name or "").strip(),
                "unit": (it.unit or "").strip() or "unit",
                "quantity": str(q),
                "pos_category": (getattr(it, "pos_category", None) or "general").strip().lower(),
                "reporting_category": (getattr(it, "category", None) or "").strip() or "General",
                "content_weight_kg": str(cw) if cw is not None and cw > 0 else None,
                "unit_cost": str(uc.quantize(Decimal("0.0001"))),
            }
        )
    return out


def pond_warehouse_stock_matrix(company_id: int, *, pond_id: int | None = None) -> list[dict]:
    """On-hand pond-warehouse quantities across ponds (same shape as single-pond rows, plus pond fields)."""
    qs = ItemPondStock.objects.filter(company_id=company_id).select_related(
        "pond",
        "pond__warehouse_group",
        "item",
    )
    if pond_id is not None:
        qs = qs.filter(pond_id=pond_id)
    qs = qs.order_by("pond__name", "item__name", "item_id")
    out: list[dict] = []
    for r in qs:
        q = r.quantity if r.quantity is not None else Decimal("0")
        if q <= 0:
            continue
        pond = r.pond
        it = r.item
        cw = it.content_weight_kg
        uc = item_inventory_unit_cost(it)
        wg = getattr(pond, "warehouse_group", None)
        out.append(
            {
                "pond_id": pond.id,
                "pond_name": (pond.name or "").strip(),
                "warehouse_group_id": wg.id if wg else None,
                "warehouse_group_name": (wg.name or "").strip() if wg else "",
                "warehouse_group_code": (wg.code or "").strip() if wg else "",
                "is_shared_warehouse_member": bool(wg),
                "item_id": it.id,
                "item_name": (it.name or "").strip(),
                "unit": (it.unit or "").strip() or "unit",
                "quantity": str(q),
                "pos_category": (getattr(it, "pos_category", None) or "general").strip().lower(),
                "reporting_category": (getattr(it, "category", None) or "").strip() or "General",
                "content_weight_kg": str(cw) if cw is not None and cw > 0 else None,
                "unit_cost": str(uc.quantize(Decimal("0.0001"))),
            }
        )
    return out
