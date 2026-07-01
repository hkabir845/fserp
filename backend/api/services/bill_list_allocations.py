"""Per-entity line amounts on vendor bills — for list scoped totals and drill-down."""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Any

from api.services.aquaculture_pond_display import bill_line_pond_display_name


def _line_amount(line) -> Decimal:
    try:
        return Decimal(str(line.amount or 0))
    except Exception:
        return Decimal("0")


def bill_line_entity_scope_key(line, bill) -> str:
    """Aligns with frontend billLineEntityKey (pond, line station, tank station, header shop, ho)."""
    pid = getattr(line, "aquaculture_pond_id", None)
    if pid:
        return f"p:{int(pid)}"
    sid = getattr(line, "receipt_station_id", None)
    if sid:
        return str(int(sid))
    tank = getattr(line, "tank", None)
    if getattr(line, "tank_id", None) and tank is not None:
        ts = getattr(tank, "station_id", None)
        if ts:
            return str(int(ts))
    bs = getattr(bill, "receipt_station_id", None)
    if bs:
        return str(int(bs))
    return "ho"


def bill_line_matches_list_scope(
    line,
    bill,
    *,
    station_id: int | None,
    pond_id: int | None,
    head_office: bool,
) -> bool:
    """Mirror api.services.bill_list_filters.apply_bill_list_entity_scope at line level."""
    if pond_id:
        return getattr(line, "aquaculture_pond_id", None) == pond_id
    if station_id:
        if getattr(line, "receipt_station_id", None) == station_id:
            return True
        tank = getattr(line, "tank", None)
        if getattr(line, "tank_id", None) and tank is not None:
            return getattr(tank, "station_id", None) == station_id
        return False
    if head_office:
        if getattr(line, "aquaculture_pond_id", None):
            return False
        if getattr(line, "receipt_station_id", None):
            return False
        if getattr(line, "tank_id", None):
            return False
        if (getattr(line, "fuel_station_expense_category", None) or "").strip():
            return False
        return True
    return True


def _entity_label_for_key(key: str, bill) -> str:
    if key == "ho":
        return "Head office"
    if key.startswith("p:"):
        pid = int(key[2:])
        for line in bill.lines.all():
            if getattr(line, "aquaculture_pond_id", None) == pid:
                pond = getattr(line, "aquaculture_pond", None)
                if pond is not None:
                    return bill_line_pond_display_name(pond, line) or (pond.name or "").strip() or f"Pond #{pid}"
        return f"Pond #{pid}"
    sid = int(key)
    for line in bill.lines.all():
        if getattr(line, "receipt_station_id", None) == sid:
            st = getattr(line, "receipt_station", None)
            if st is not None and getattr(st, "station_name", None):
                return (st.station_name or "").strip() or f"Station #{sid}"
        tank = getattr(line, "tank", None)
        if tank is not None and getattr(tank, "station_id", None) == sid:
            ts = getattr(tank, "station", None)
            if ts is not None and getattr(ts, "station_name", None):
                return (ts.station_name or "").strip() or f"Station #{sid}"
    rs = getattr(bill, "receipt_station", None)
    if getattr(bill, "receipt_station_id", None) == sid and rs is not None:
        return (rs.station_name or "").strip() or f"Station #{sid}"
    return f"Station #{sid}"


def _line_row_summary(line, bill) -> dict[str, Any]:
    item = getattr(line, "item", None) if getattr(line, "item_id", None) else None
    desc = (line.description or "").strip()
    if not desc and item is not None:
        desc = (item.name or "").strip()
    return {
        "line_id": line.id,
        "line_number": getattr(line, "line_number", None),
        "description": desc,
        "amount": str(_line_amount(line)),
        "entity_scope_key": bill_line_entity_scope_key(line, bill),
    }


def summarize_bill_entity_allocations(bill) -> list[dict[str, Any]]:
    """Group bill lines by Charge-to entity for drill-down."""
    buckets: dict[str, dict[str, Any]] = {}
    for line in bill.lines.all():
        key = bill_line_entity_scope_key(line, bill)
        if key not in buckets:
            buckets[key] = {
                "entity_scope_key": key,
                "entity_label": _entity_label_for_key(key, bill),
                "amount": Decimal("0"),
                "line_count": 0,
                "lines": [],
            }
        buckets[key]["amount"] += _line_amount(line)
        buckets[key]["line_count"] += 1
        buckets[key]["lines"].append(_line_row_summary(line, bill))
    rows = list(buckets.values())
    for row in rows:
        row["amount"] = str(row["amount"])
    rows.sort(key=lambda r: (-Decimal(r["amount"]), r["entity_label"]))
    return rows


def bill_filtered_line_amount(
    bill,
    *,
    station_id: int | None,
    pond_id: int | None,
    head_office: bool,
) -> Decimal | None:
    """Sum of line amounts matching the list entity filter; None when no scope."""
    if not pond_id and not station_id and not head_office:
        return None
    total = Decimal("0")
    for line in bill.lines.all():
        if bill_line_matches_list_scope(
            line,
            bill,
            station_id=station_id,
            pond_id=pond_id,
            head_office=head_office,
        ):
            total += _line_amount(line)
    return total


def list_scope_matches_allocation(
    entity_scope_key: str,
    *,
    station_id: int | None,
    pond_id: int | None,
    head_office: bool,
) -> bool:
    if pond_id:
        return entity_scope_key == f"p:{pond_id}"
    if station_id:
        return entity_scope_key == str(station_id)
    if head_office:
        return entity_scope_key == "ho"
    return False
