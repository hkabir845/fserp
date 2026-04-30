"""
Per-station shop inventory: bins for items without fuel tanks, sync with Item.quantity_on_hand.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from decimal import Decimal
from django.db.models import F
from django.db import transaction

from api.models import Item, ItemStationStock, Station, Tank
from api.services.item_catalog import item_tracks_physical_stock
from django.db.models import Sum as DjSum

logger = logging.getLogger(__name__)


def tanks_exist_for_item(company_id: int, item_id: int) -> bool:
    return Tank.objects.filter(company_id=company_id, product_id=item_id).exists()


def item_uses_station_bins(company_id: int, item: Item) -> bool:
    """
    True when this SKU's physical stock is tracked per station (ItemStationStock), not in tanks.
    """
    if not item_tracks_physical_stock(item):
        return False
    return not tanks_exist_for_item(company_id, item.id)


def get_or_create_default_station(company_id: int) -> Station:
    s = (
        Station.objects.filter(company_id=company_id, is_active=True)
        .order_by("id")
        .first()
    )
    if s:
        return s
    logger.warning(
        "get_or_create_default_station: company_id=%s has no active station; creating active row 'Default'. "
        "Prefer at least one real active site (Stations) and investigate callers.",
        company_id,
    )
    return Station.objects.create(company_id=company_id, station_name="Default", is_active=True)


def refresh_item_quantity_on_hand(company_id: int, item_id: int) -> None:
    """Recompute Item.quantity_on_hand from tanks (if any) or sum of station bins."""
    it = Item.objects.filter(pk=item_id, company_id=company_id).only("id", "item_type").first()
    if not it:
        return
    if tanks_exist_for_item(company_id, item_id):
        active = Tank.objects.filter(
            company_id=company_id, product_id=item_id, is_active=True
        )
        if active.exists():
            agg = active.aggregate(s=DjSum("current_stock"))["s"]
        else:
            agg = Tank.objects.filter(company_id=company_id, product_id=item_id).aggregate(
                s=DjSum("current_stock")
            )["s"]
        total = agg if agg is not None else Decimal("0")
        Item.objects.filter(pk=item_id, company_id=company_id).update(quantity_on_hand=total)
        return
    if not item_tracks_physical_stock(it):
        return
    agg = ItemStationStock.objects.filter(company_id=company_id, item_id=item_id).aggregate(
        s=DjSum("quantity")
    )["s"]
    total = agg if agg is not None else Decimal("0")
    Item.objects.filter(pk=item_id, company_id=company_id).update(quantity_on_hand=total)


def get_station_stock(company_id: int, station_id: int, item_id: int) -> Decimal:
    row = (
        ItemStationStock.objects.filter(
            company_id=company_id, station_id=station_id, item_id=item_id
        )
        .only("quantity")
        .first()
    )
    if not row:
        return Decimal("0")
    return row.quantity if row.quantity is not None else Decimal("0")


@transaction.atomic
def add_station_stock(
    company_id: int, station_id: int, item_id: int, qty_delta: Decimal
) -> None:
    if qty_delta == 0:
        return
    row, _ = ItemStationStock.objects.select_for_update().get_or_create(
        company_id=company_id,
        station_id=station_id,
        item_id=item_id,
        defaults={"quantity": Decimal("0")},
    )
    ItemStationStock.objects.filter(pk=row.pk).update(quantity=F("quantity") + qty_delta)
    refresh_item_quantity_on_hand(company_id, item_id)


def set_station_stock(
    company_id: int, station_id: int, item_id: int, quantity: Decimal
) -> None:
    """Set absolute quantity at a station bin; refreshes item QOH."""
    if quantity < 0:
        quantity = Decimal("0")
    get_or_create_default_station(company_id)  # ensure at least one station exists
    row, _ = ItemStationStock.objects.get_or_create(
        company_id=company_id,
        station_id=station_id,
        item_id=item_id,
        defaults={"quantity": quantity},
    )
    if row.quantity != quantity:
        ItemStationStock.objects.filter(pk=row.pk).update(quantity=quantity)
    refresh_item_quantity_on_hand(company_id, item_id)


def ensure_item_station_row_for_new_shop_item(company_id: int, item: Item) -> None:
    """
    On product create: put initial shop QOH on the default (first) station.
    No-op for tank-tracked or non-physical items.
    """
    if not item_uses_station_bins(company_id, item):
        return
    st = get_or_create_default_station(company_id)
    q = item.quantity_on_hand or Decimal("0")
    set_station_stock(company_id, st.id, item.pk, q)


def per_station_quantities(company_id: int, item_id: int) -> list[dict]:
    out: list[dict] = []
    for row in (
        ItemStationStock.objects.filter(company_id=company_id, item_id=item_id)
        .select_related("station")
        .order_by("station__station_name", "station_id")
    ):
        st = row.station
        out.append(
            {
                "station_id": st.id,
                "station_name": (st.station_name or f"Station {st.id}").strip(),
                "station_number": st.station_number or "",
                "quantity": str(row.quantity or Decimal("0")),
            }
        )
    return out


def assert_shop_lines_within_station_qoh(
    company_id: int, station_id: int, lines_data: list
) -> None:
    """
    For station-bin items: validate quantities against this station's bin.
    for_movement: True when called before decrement (POS); expects rows locked in caller txn.
    """
    from api.exceptions import StockBusinessError
    from api.services.gl_posting import _item_receives_physical_stock

    per: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    for d in lines_data:
        item = d.get("item")
        if not item or not _item_receives_physical_stock(item):
            continue
        if not item_uses_station_bins(company_id, item):
            # validated elsewhere (Item.quantity_on_hand for legacy / tank-mirrored)
            continue
        if item.quantity_on_hand is None:
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
    def _fmt_qty(d: Decimal) -> str:
        s = format(d, "f")
        if "." in s:
            s = s.rstrip("0").rstrip(".")
        return s or "0"

    ids = sorted(per.keys())
    # Lock ItemStationStock rows in deterministic order, create missing as zero
    locked: dict[tuple[int, int], ItemStationStock] = {}
    for iid in ids:
        r, _ = ItemStationStock.objects.select_for_update().get_or_create(
            company_id=company_id,
            station_id=station_id,
            item_id=iid,
            defaults={"quantity": Decimal("0")},
        )
        locked[(station_id, iid)] = r
    for iid, need in per.items():
        it = (
            Item.objects.filter(pk=iid, company_id=company_id)
            .only("name", "unit", "quantity_on_hand")
            .first()
        )
        if not it:
            continue
        r = locked.get((station_id, iid))
        if not r:
            continue
        qoh = r.quantity if r.quantity is not None else Decimal("0")
        if need > qoh:
            unit = (it.unit or "units").strip() or "units"
            st = Station.objects.filter(pk=station_id, company_id=company_id).first()
            st_name = (st.station_name or f"#{station_id}").strip() if st else str(station_id)
            raise StockBusinessError(
                f'Not enough stock for "{it.name}" at {st_name}: this sale needs {_fmt_qty(need)} {unit} '
                f"but only {_fmt_qty(qoh)} {unit} is on hand at this location. "
                f"Transfer stock from another station, reduce the quantity, or sell from a station that has stock."
            )


def decrement_station_lines(company_id: int, station_id: int, lines_data: list) -> None:
    for d in lines_data:
        item = d.get("item")
        if not item:
            continue
        if not item_uses_station_bins(company_id, item):
            continue
        if item.quantity_on_hand is None:
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
        add_station_stock(company_id, station_id, item.id, -qq)
