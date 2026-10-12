"""Digonto stock as-of year lock 2026-02-26 vs today."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from api.models import (
    AquacultureFishSale,
    AquacultureFishStockLedger,
    AquaculturePond,
    AquacultureProductionCycle,
    BillLine,
)
from api.services.aquaculture_stock_service import (
    compute_fish_stock_position_breakdown_rows,
    compute_fish_stock_position_rows,
)


CID = 2
POND = 15
LOCK = date(2026, 2, 26)


def show(label: str, as_of: date | None) -> None:
    print(f"\n=== {label} as_of={as_of} ===")
    if as_of is None:
        rows = compute_fish_stock_position_breakdown_rows(CID, pond_id=POND)
        pond = compute_fish_stock_position_rows(CID, pond_id=POND)[0]
    else:
        rows = compute_fish_stock_position_breakdown_rows(CID, pond_id=POND, as_of_date=as_of)
        # pond-level helper has no as_of; sum breakdown
        pond = None
    total_n = 0
    for r in rows:
        n = int(r["implied_net_fish_count"] or 0)
        w = Decimal(str(r["implied_net_weight_kg"] or 0))
        if n == 0 and w == 0:
            continue
        total_n += n
        print(
            f"  cy={r.get('production_cycle_id')} {r.get('fish_species')}: "
            f"heads={n} book={w} stocked_n={r.get('stocked_fish_count')} "
            f"sale_n={r.get('sale_fish_count')}"
        )
    if pond:
        print(f"  POND_ROW heads={pond['implied_net_fish_count']}")
    else:
        print(f"  BREAKDOWN_SUM heads={total_n}")


def main() -> None:
    p = AquaculturePond.objects.get(pk=POND)
    print(p.name, p.id)
    for cy in AquacultureProductionCycle.objects.filter(company_id=CID, pond_id=POND).order_by("id"):
        print(
            f"  cycle {cy.id} {cy.code!r} {cy.name!r} start={cy.start_date} "
            f"active={cy.is_active} end={getattr(cy, 'end_date', None)}"
        )
        for f in cy._meta.fields:
            if "lock" in f.name or "close" in f.name or "year" in f.name:
                print(f"    field {f.name}={getattr(cy, f.name, None)}")

    # pond fields
    for f in p._meta.fields:
        if any(x in f.name for x in ("lock", "close", "year", "prior")):
            print(f"pond.{f.name}={getattr(p, f.name, None)}")

    show("ON year-lock day", LOCK)
    show("day before lock", date(2026, 2, 25))
    show("TODAY", None)

    print("\n=== movements on/after lock that affect old cycles ===")
    for s in AquacultureFishSale.objects.filter(
        company_id=CID, pond_id=POND, sale_date__gte=LOCK
    ).order_by("sale_date", "id")[:20]:
        print(
            f"  sale {s.sale_date} cy={s.production_cycle_id} sp={s.fish_species} "
            f"n={s.fish_count} kg={s.weight_kg}"
        )
    print("  ... sales after lock total", AquacultureFishSale.objects.filter(company_id=CID, pond_id=POND, sale_date__gte=LOCK).count())

    for r in AquacultureFishStockLedger.objects.filter(
        company_id=CID, pond_id=POND, entry_date__gte=LOCK
    ).order_by("entry_date", "id"):
        print(
            f"  led {r.entry_date} cy={r.production_cycle_id} sp={r.fish_species} "
            f"kind={r.entry_kind} dn={r.fish_count_delta} dw={r.weight_kg_delta} "
            f"memo={(r.memo or '')[:70]}"
        )

    print("\n=== Mirka C118 bill ===")
    for bl in BillLine.objects.filter(
        bill__company_id=CID, aquaculture_pond_id=POND, aquaculture_production_cycle_id=118
    ).select_related("bill", "item"):
        print(bl.bill.bill_date, bl.item.name, bl.aquaculture_fish_count, bl.aquaculture_fish_weight_kg)

    # What remained on lock day for C24 + C118
    print("\n=== Expected year-lock writeoff candidates (heads > 0 on LOCK) ===")
    rows = compute_fish_stock_position_breakdown_rows(CID, pond_id=POND, as_of_date=LOCK)
    for r in rows:
        n = int(r["implied_net_fish_count"] or 0)
        if n > 0:
            print(
                f"  STILL LIVE ON LOCK: cy={r.get('production_cycle_id')} "
                f"{r.get('fish_species')} heads={n} — should have been written off if year-locked"
            )


if __name__ == "__main__":
    main()
