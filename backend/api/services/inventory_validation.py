"""User-facing validation for tank capacity, fuel availability, and shop QOH."""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from api.exceptions import StockBusinessError
from api.models import Bill, BillLine, Item, Tank
from api.services.gl_posting import (
    _item_receives_physical_stock,
    _pick_tank_for_bill_line,
    _tanks_for_stock_receipt,
)


def _fmt_qty(d: Decimal) -> str:
    s = format(d, "f")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s or "0"


def compute_tank_receipt_additions(bill: Bill) -> dict[int, Decimal]:
    """Total receipt quantity per tank for this bill (same routing as stock receipt posting)."""
    company_id = bill.company_id
    per: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    for line in BillLine.objects.filter(bill_id=bill.id).select_related("item", "tank"):
        item = line.item
        if not item:
            continue
        qty = line.quantity if line.quantity is not None else Decimal("0")
        if qty <= 0:
            continue
        if not _item_receives_physical_stock(item):
            continue
        tanks_qs = _tanks_for_stock_receipt(company_id, item)
        if not tanks_qs.exists():
            continue
        tank = _pick_tank_for_bill_line(line, item, tanks_qs)
        if tank:
            per[tank.pk] += qty
    return dict(per)


def lock_tanks_and_assert_receipt_capacity(
    bill: Bill, *, acknowledge_tank_overfill: bool = False
) -> None:
    """
    For vendor fuel/inventory received into tanks: current_stock + receipt must not exceed capacity
    (when capacity > 0). Call inside an existing transaction.atomic() with select_for_update.
    If acknowledge_tank_overfill is True, skip the capacity check (e.g. overflow stored in drums).
    """
    if acknowledge_tank_overfill:
        return
    additions = compute_tank_receipt_additions(bill)
    if not additions:
        return
    ids = sorted(additions.keys())
    locked_list = list(
        Tank.objects.select_for_update()
        .filter(pk__in=ids, company_id=bill.company_id)
        .order_by("id")
    )
    locked = {t.id: t for t in locked_list}
    for tid in ids:
        if tid not in locked:
            raise StockBusinessError(
                "A bill line refers to a tank that was removed or is not in this company. "
                "Refresh the page and pick a valid receiving tank."
            )
    for tid, add_qty in additions.items():
        t = locked[tid]
        cap = t.capacity or Decimal("0")
        if cap <= 0:
            continue
        cur = t.current_stock or Decimal("0")
        new_level = cur + add_qty
        if new_level > cap:
            u = (t.unit_of_measure or "L").strip() or "L"
            raise StockBusinessError(
                f'Cannot receive this fuel into tank "{t.tank_name}": it already holds '
                f"{_fmt_qty(cur)} {u} and this bill would add {_fmt_qty(add_qty)} {u}, "
                f"for a total of {_fmt_qty(new_level)} {u}, which is more than the tank capacity "
                f'of {_fmt_qty(cap)} {u}. Reduce the line quantity, choose another tank, or '
                f"increase the tank capacity."
            )


def assert_pos_fuel_sale_within_stock(company_id: int, fuel_entries: list) -> None:
    """Fuel POS lines: total quantity per tank must not exceed current_stock."""
    per: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    for fe in fuel_entries:
        tank = fe.get("tank")
        qty = fe.get("quantity")
        if not tank or qty is None:
            continue
        try:
            q = qty if isinstance(qty, Decimal) else Decimal(str(qty))
        except Exception:
            continue
        if q <= 0:
            continue
        per[tank.pk] += q
    if not per:
        return
    ids = sorted(per.keys())
    locked = {
        t.id: t
        for t in Tank.objects.select_for_update()
        .filter(pk__in=ids, company_id=company_id)
        .order_by("id")
    }
    for tid, need in per.items():
        t = locked.get(tid)
        if not t:
            raise StockBusinessError(
                "A selected nozzle’s tank is missing or not in this company. "
                "Reload the cashier screen or pick another nozzle."
            )
        cur = t.current_stock or Decimal("0")
        if need > cur:
            u = (t.unit_of_measure or "L").strip() or "L"
            raise StockBusinessError(
                f'Not enough fuel in tank "{t.tank_name}": this sale is for {_fmt_qty(need)} {u} '
                f"but only {_fmt_qty(cur)} {u} is available. Reduce the quantity or receive more stock first."
            )


def assert_pos_general_lines_within_qoh(company_id: int, lines_data: list) -> None:
    """Shop inventory lines: quantity must not exceed quantity_on_hand when tracked."""
    per: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    for d in lines_data:
        item = d.get("item")
        if not item:
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
    ids = sorted(per.keys())
    locked = {
        i.id: i
        for i in Item.objects.select_for_update()
        .filter(pk__in=ids, company_id=company_id)
        .order_by("id")
    }
    for iid, need in per.items():
        it = locked.get(iid)
        if not it:
            continue
        qoh = it.quantity_on_hand if it.quantity_on_hand is not None else Decimal("0")
        if need > qoh:
            unit = (it.unit or "units").strip() or "units"
            raise StockBusinessError(
                f'Not enough stock for "{it.name}": this sale needs {_fmt_qty(need)} {unit} '
                f"but only {_fmt_qty(qoh)} {unit} is on hand. Reduce the quantity or adjust inventory."
            )
