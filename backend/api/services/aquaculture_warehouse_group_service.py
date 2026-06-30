"""Shared pond warehouse groups and pooled stock views."""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from django.db.models import Sum

from api.models import AquaculturePond, AquacultureWarehouseGroup, Item, ItemPondStock
from api.utils.measured_quantity import format_measured_quantity_for_api


def warehouse_group_for_pond(pond: AquaculturePond) -> AquacultureWarehouseGroup | None:
    gid = getattr(pond, "warehouse_group_id", None)
    if not gid:
        return None
    wg = getattr(pond, "warehouse_group", None)
    if wg is not None:
        return wg
    return AquacultureWarehouseGroup.objects.filter(pk=gid, company_id=pond.company_id).first()


def assert_ponds_allow_inter_warehouse_transfer(
    company_id: int,
    from_pond: AquaculturePond,
    to_pond: AquaculturePond,
) -> None:
    from api.exceptions import StockBusinessError

    if from_pond.id == to_pond.id:
        raise StockBusinessError("Source and destination pond must be different.")
    fg = from_pond.warehouse_group_id
    tg = to_pond.warehouse_group_id
    if fg and tg:
        if fg != tg:
            raise StockBusinessError(
                "Ponds belong to different shared warehouse groups. "
                "Only reallocate within the same group, or between ponds with no group."
            )
        return
    if fg or tg:
        raise StockBusinessError(
            "One pond uses a shared warehouse group and the other does not. "
            "Assign both to the same group, or clear the group on the member pond first."
        )


def warehouse_group_pool_rows(company_id: int, *, group_id: int | None = None) -> list[dict]:
    """
    Pooled on-hand per item for each active warehouse group (sum of member pond allocations).
    """
    ponds = AquaculturePond.objects.filter(
        company_id=company_id,
        is_active=True,
        warehouse_group_id__isnull=False,
    )
    if group_id is not None:
        ponds = ponds.filter(warehouse_group_id=group_id)
    pond_ids_by_group: dict[int, list[int]] = defaultdict(list)
    for pid, gid in ponds.values_list("id", "warehouse_group_id"):
        if gid:
            pond_ids_by_group[int(gid)].append(int(pid))

    if not pond_ids_by_group:
        return []

    groups = {
        g.id: g
        for g in AquacultureWarehouseGroup.objects.filter(
            company_id=company_id,
            pk__in=pond_ids_by_group.keys(),
        )
    }

    agg = (
        ItemPondStock.objects.filter(
            company_id=company_id,
            pond_id__in=[p for ids in pond_ids_by_group.values() for p in ids],
            quantity__gt=0,
        )
        .values("pond__warehouse_group_id", "item_id")
        .annotate(total_qty=Sum("quantity"))
    )
    item_ids = {row["item_id"] for row in agg}
    items = {it.id: it for it in Item.objects.filter(company_id=company_id, pk__in=item_ids)}

    from api.services.gl_posting import item_inventory_unit_cost

    out: list[dict] = []
    for row in agg:
        gid = row["pond__warehouse_group_id"]
        if not gid or gid not in groups:
            continue
        g = groups[gid]
        it = items.get(row["item_id"])
        if not it:
            continue
        q = row["total_qty"] if row["total_qty"] is not None else Decimal("0")
        if q <= 0:
            continue
        member_count = len(pond_ids_by_group.get(gid, []))
        uc = item_inventory_unit_cost(it)
        out.append(
            {
                "warehouse_group_id": g.id,
                "warehouse_group_name": (g.name or "").strip(),
                "warehouse_group_code": (g.code or "").strip(),
                "member_pond_count": member_count,
                "item_id": it.id,
                "item_name": (it.name or "").strip(),
                "unit": (it.unit or "").strip() or "unit",
                "quantity": format_measured_quantity_for_api(q),
                "pos_category": (getattr(it, "pos_category", None) or "general").strip().lower(),
                "reporting_category": (getattr(it, "category", None) or "").strip() or "General",
                "unit_cost": str(uc.quantize(Decimal("0.0001"))),
            }
        )
    out.sort(key=lambda r: (r["warehouse_group_name"].lower(), r["item_name"].lower(), r["item_id"]))
    return out
