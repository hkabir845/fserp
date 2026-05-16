"""
Per-station shop inventory: bins for items without fuel tanks, sync with Item.quantity_on_hand.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from decimal import Decimal
from django.db.models import F
from django.db import transaction

from api.models import AquaculturePond, Item, ItemPondStock, ItemStationStock, Station, Tank
from api.services.item_catalog import item_tracks_physical_stock
from django.db.models import Sum as DjSum

logger = logging.getLogger(__name__)


def tanks_exist_for_item(company_id: int, item_id: int) -> bool:
    return Tank.objects.filter(company_id=company_id, product_id=item_id).exists()


def item_uses_station_bins(company_id: int, item: Item) -> bool:
    """
    True when this SKU's physical stock is tracked per station (ItemStationStock), not in tanks.

    POS categories ``non_pos`` and ``fish`` are for aquaculture hatchery / internal stock (e.g. fish fry moved to
    ponds) — not shop or warehouse bins.
    """
    if not item_tracks_physical_stock(item):
        return False
    if tanks_exist_for_item(company_id, item.id):
        return False
    pos_cat = (getattr(item, "pos_category", None) or "").strip().lower()
    if pos_cat in ("non_pos", "fish"):
        return False
    return True


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


def receipt_station_id_for_vendor(company_id: int, vendor) -> int:
    """
    Default receiving station for new vendor bills / payment register when not overridden.
    Prefer vendor.default_station; else a shop whose default_aquaculture_pond matches vendor.default_aquaculture_pond;
    else first active station.
    """
    if vendor is not None:
        ds = getattr(vendor, "default_station_id", None)
        if ds and Station.objects.filter(pk=ds, company_id=company_id, is_active=True).exists():
            return int(ds)
        pid = getattr(vendor, "default_aquaculture_pond_id", None)
        if pid:
            st = Station.objects.filter(
                company_id=company_id,
                is_active=True,
                default_aquaculture_pond_id=int(pid),
            ).first()
            if st:
                return int(st.id)
    return int(get_or_create_default_station(company_id).id)


def refresh_item_quantity_on_hand(company_id: int, item_id: int) -> None:
    """Recompute Item.quantity_on_hand from tanks (if any) or sum of station bins."""
    it = Item.objects.filter(pk=item_id, company_id=company_id).only("id", "item_type", "pos_category").first()
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
    pos_cat = (getattr(it, "pos_category", None) or "").strip().lower()
    if pos_cat == "fish":
        n_active_ponds = AquaculturePond.objects.filter(company_id=company_id, is_active=True).count()
        if n_active_ponds == 0:
            return
        if not ItemPondStock.objects.filter(company_id=company_id, item_id=item_id).exists():
            return
        agg_pond = ItemPondStock.objects.filter(company_id=company_id, item_id=item_id).aggregate(
            s=DjSum("quantity")
        )["s"]
        total = agg_pond if agg_pond is not None else Decimal("0")
        Item.objects.filter(pk=item_id, company_id=company_id).update(quantity_on_hand=total)
        return
    if not item_uses_station_bins(company_id, it):
        return
    agg_st = ItemStationStock.objects.filter(company_id=company_id, item_id=item_id).aggregate(
        s=DjSum("quantity")
    )["s"]
    agg_pond = ItemPondStock.objects.filter(company_id=company_id, item_id=item_id).aggregate(
        s=DjSum("quantity")
    )["s"]
    st = agg_st if agg_st is not None else Decimal("0")
    pd = agg_pond if agg_pond is not None else Decimal("0")
    total = st + pd
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


@transaction.atomic
def move_shop_stock_to_station(
    company_id: int, station_id: int, item_id: int, quantity: Decimal
) -> None:
    """Clear other shop bins, then set quantity at the target station (relocate, not duplicate)."""
    if quantity < 0:
        quantity = Decimal("0")
    ItemStationStock.objects.filter(company_id=company_id, item_id=item_id).exclude(
        station_id=station_id
    ).update(quantity=Decimal("0"))
    set_station_stock(company_id, station_id, item_id, quantity)


def resolve_active_station_id(company_id: int, raw_station_id) -> int | None:
    if raw_station_id is None or raw_station_id == "":
        return None
    try:
        sid = int(raw_station_id)
    except (TypeError, ValueError):
        return None
    if Station.objects.filter(pk=sid, company_id=company_id, is_active=True).exists():
        return sid
    return None


def ensure_item_station_row_for_new_shop_item(
    company_id: int,
    item: Item,
    *,
    station_id: int | None = None,
    move_all: bool = False,
) -> None:
    """
    On product create: put initial shop QOH on the chosen or default station.
    No-op for tank-tracked or non-physical items.
    """
    if not item_uses_station_bins(company_id, item):
        return
    target_sid = resolve_active_station_id(company_id, station_id)
    if target_sid is None:
        target_sid = int(get_or_create_default_station(company_id).id)
    q = item.quantity_on_hand or Decimal("0")
    if move_all:
        move_shop_stock_to_station(company_id, target_sid, item.pk, q)
    else:
        set_station_stock(company_id, target_sid, item.pk, q)


def per_pond_quantities(company_id: int, item_id: int) -> list[dict]:
    """Per-pond quantities for fish SKUs (ItemPondStock), all active ponds included."""
    qty_by_pond: dict[int, Decimal] = {}
    for row in ItemPondStock.objects.filter(company_id=company_id, item_id=item_id).only(
        "pond_id", "quantity"
    ):
        q = row.quantity if row.quantity is not None else Decimal("0")
        qty_by_pond[int(row.pond_id)] = q
    out: list[dict] = []
    for p in AquaculturePond.objects.filter(company_id=company_id, is_active=True).order_by(
        "sort_order", "id"
    ):
        q = qty_by_pond.get(int(p.id), Decimal("0"))
        out.append(
            {
                "pond_id": p.id,
                "pond_name": (p.name or f"Pond #{p.id}").strip(),
                "quantity": str(q),
            }
        )
    return out


def set_pond_stock(company_id: int, pond_id: int, item_id: int, quantity: Decimal) -> None:
    """Set absolute fish-SKU quantity at a pond; refreshes Item.quantity_on_hand when pond rows exist."""
    if quantity < 0:
        quantity = Decimal("0")
    if not AquaculturePond.objects.filter(
        pk=pond_id, company_id=company_id, is_active=True
    ).exists():
        raise ValueError("pond_id is not an active pond for this company")
    row, _ = ItemPondStock.objects.get_or_create(
        company_id=company_id,
        pond_id=pond_id,
        item_id=item_id,
        defaults={"quantity": quantity},
    )
    if row.quantity != quantity:
        ItemPondStock.objects.filter(pk=row.pk).update(quantity=quantity)
    refresh_item_quantity_on_hand(company_id, item_id)


def per_station_quantities(company_id: int, item_id: int) -> list[dict]:
    """All active stations with on-hand qty (0 when no bin row yet)."""
    qty_by_station: dict[int, Decimal] = {}
    for row in ItemStationStock.objects.filter(company_id=company_id, item_id=item_id).only(
        "station_id", "quantity"
    ):
        q = row.quantity if row.quantity is not None else Decimal("0")
        qty_by_station[int(row.station_id)] = q
    out: list[dict] = []
    for st in Station.objects.filter(company_id=company_id, is_active=True).order_by(
        "station_name", "id"
    ):
        out.append(
            {
                "station_id": st.id,
                "station_name": (st.station_name or f"Station {st.id}").strip(),
                "station_number": st.station_number or "",
                "quantity": str(qty_by_station.get(int(st.id), Decimal("0"))),
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
