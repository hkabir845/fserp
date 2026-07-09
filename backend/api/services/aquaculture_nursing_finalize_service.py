"""When a nursing pond is emptied by fingerling transfer, move leftover feed/medicine stock."""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from django.db import transaction

from api.models import AquacultureFishPondTransfer, AquaculturePond, PondWarehouseInterPondTransfer
from api.services.aquaculture_pl_service import _money_q
from api.services.aquaculture_pond_stock_service import (
    pond_warehouse_stock_matrix,
    transfer_pond_warehouse_between_ponds,
)
from api.services.aquaculture_transfer_cost import (
    _live_fingerling_heads_basis,
    _nursing_blended_line_fraction,
)

_FEED_MEDICINE_POS_CATEGORIES = frozenset({"feed", "medicine"})


def _destination_blended_shares(
    lines: list,
) -> dict[int, Decimal]:
    """Blended head + weight share per destination pond from fish transfer lines."""
    by_pond: dict[int, tuple[int, Decimal]] = {}
    for ln in lines:
        pond_id = int(ln.to_pond_id)
        fc = int(ln.fish_count or 0)
        wk = _money_q(ln.weight_kg or Decimal("0"))
        if fc <= 0:
            continue
        prev_fc, prev_wk = by_pond.get(pond_id, (0, Decimal("0")))
        by_pond[pond_id] = (prev_fc + fc, prev_wk + wk)
    if not by_pond:
        return {}

    total_fish = sum(fc for fc, _ in by_pond.values())
    total_weight = _money_q(sum(wk for _, wk in by_pond.values()))
    shares: dict[int, Decimal] = {}
    for pond_id, (fc, wk) in by_pond.items():
        shares[pond_id] = _nursing_blended_line_fraction(
            fc,
            wk,
            total_fish=total_fish,
            total_weight=total_weight,
        )
    share_sum = sum(shares.values(), Decimal("0"))
    if share_sum > 0 and share_sum != Decimal("1"):
        shares = {pid: _money_q(share / share_sum) for pid, share in shares.items()}
    return shares


def _split_quantity_by_shares(qty: Decimal, shares: dict[int, Decimal]) -> dict[int, Decimal]:
    if qty <= 0 or not shares:
        return {}
    ordered = sorted(shares.items(), key=lambda item: (-item[1], item[0]))
    out: dict[int, Decimal] = {}
    remaining = qty
    for idx, (pond_id, share) in enumerate(ordered):
        if idx == len(ordered) - 1:
            out[pond_id] = remaining
            continue
        part = _money_q(qty * share)
        if part > remaining:
            part = remaining
        out[pond_id] = part
        remaining = _money_q(remaining - part)
    return out


def _nursing_pond_is_empty(
    *,
    company_id: int,
    pond_id: int,
    production_cycle_id: int | None,
) -> bool:
    live = _live_fingerling_heads_basis(
        company_id=company_id,
        pond_id=pond_id,
        cycle_filter_id=production_cycle_id,
    )
    return live <= 0


def _feed_medicine_stock_rows(company_id: int, pond_id: int) -> list[dict]:
    rows = []
    for row in pond_warehouse_stock_matrix(company_id, pond_id=pond_id):
        cat = str(row.get("pos_category") or "").strip().lower()
        if cat not in _FEED_MEDICINE_POS_CATEGORIES:
            continue
        qty = Decimal(str(row.get("quantity") or 0))
        if qty <= 0:
            continue
        rows.append(row)
    return rows


@transaction.atomic
def maybe_transfer_nursing_warehouse_when_empty(
    *,
    company_id: int,
    xfer: AquacultureFishPondTransfer,
) -> list[dict]:
    """
    After fingerlings leave a nursing pond, move remaining feed/medicine warehouse stock
    to grow-out destination ponds in the same head + weight proportions as the fish transfer.
    """
    from_pond = (
        AquaculturePond.objects.filter(pk=xfer.from_pond_id, company_id=company_id)
        .only("pond_role")
        .first()
    )
    if not from_pond or (from_pond.pond_role or "").strip().lower() != "nursing":
        return []

    cycle_id = xfer.from_production_cycle_id
    if not _nursing_pond_is_empty(
        company_id=company_id,
        pond_id=xfer.from_pond_id,
        production_cycle_id=cycle_id,
    ):
        return []

    lines = list(xfer.lines.select_related("to_pond").all())
    if not lines:
        return []

    stock_rows = _feed_medicine_stock_rows(company_id, xfer.from_pond_id)
    if not stock_rows:
        return []

    shares = _destination_blended_shares(lines)
    if not shares:
        return []

    items_by_dest: dict[int, list[dict]] = defaultdict(list)
    for row in stock_rows:
        item_id = int(row["item_id"])
        qty = Decimal(str(row["quantity"]))
        split = _split_quantity_by_shares(qty, shares)
        for dest_id, dest_qty in split.items():
            if dest_qty <= 0:
                continue
            items_by_dest[dest_id].append({"item_id": item_id, "quantity": dest_qty})

    memo = (
        f"Auto-moved with nursing fingerling transfer #{xfer.id} "
        f"({xfer.transfer_date}) — nursing pond emptied."
    )[:5000]
    created: list[dict] = []
    for dest_id, items in items_by_dest.items():
        if not items:
            continue
        wh_xfer = transfer_pond_warehouse_between_ponds(
            company_id=company_id,
            from_pond_id=xfer.from_pond_id,
            to_pond_id=dest_id,
            items=items,
            memo=memo,
        )
        created.append(_warehouse_transfer_json(wh_xfer))

    return created


def _warehouse_transfer_json(xfer: PondWarehouseInterPondTransfer) -> dict:
    from api.models import PondWarehouseInterPondTransferLine

    lines = list(
        PondWarehouseInterPondTransferLine.objects.filter(transfer_id=xfer.pk).select_related("item")
    )
    return {
        "id": xfer.id,
        "transfer_number": xfer.transfer_number,
        "from_pond_id": xfer.from_pond_id,
        "to_pond_id": xfer.to_pond_id,
        "memo": xfer.memo,
        "lines": [
            {
                "item_id": ln.item_id,
                "item_name": (ln.item.name or "").strip() if ln.item else "",
                "quantity": str(ln.quantity),
            }
            for ln in lines
        ],
    }
