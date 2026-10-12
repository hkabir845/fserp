from decimal import Decimal

from api.models import BillLine, AquacultureProductionCycle
from api.services.aquaculture_stock_service import (
    compute_fish_stock_position_breakdown_rows,
    compute_fish_stock_position_rows,
)


def main() -> None:
    pond = compute_fish_stock_position_rows(2, pond_id=15)[0]
    print("POND_TOTAL_HEADS", pond["implied_net_fish_count"])
    til = other = 0
    for r in compute_fish_stock_position_breakdown_rows(2, pond_id=15):
        n = int(r["implied_net_fish_count"] or 0)
        w = Decimal(str(r["implied_net_weight_kg"] or 0))
        if n == 0 and w == 0:
            continue
        print(
            f"cy={r.get('production_cycle_id')} name={r.get('production_cycle_name')!r} "
            f"sp={r.get('fish_species')}: heads={n} stocked_n={r.get('stocked_fish_count')} "
            f"sale_n={r.get('sale_fish_count')} bill_n={r.get('vendor_bill_in_fish_count')} "
            f"book={r.get('implied_net_weight_kg')}"
        )
        if r.get("fish_species") == "tilapia":
            til += n
        else:
            other += n
    print("tilapia_sum", til)
    print("non_tilapia_sum", other)
    print("total", til + other)
    print("extra_vs_58622", int(pond["implied_net_fish_count"]) - 58622)

    print("\nC118 cycle + bills:")
    cy = AquacultureProductionCycle.objects.filter(pk=118).first()
    if cy:
        print(cy.id, cy.code, cy.name, cy.is_active)
    for bl in BillLine.objects.filter(
        bill__company_id=2,
        aquaculture_pond_id=15,
        aquaculture_production_cycle_id=118,
        aquaculture_fish_count__gt=0,
    ).select_related("bill", "item"):
        print(
            bl.bill.bill_date,
            bl.item.name if bl.item else None,
            bl.aquaculture_fish_count,
            bl.aquaculture_fish_weight_kg,
            getattr(bl, "aquaculture_fish_species", None),
        )


if __name__ == "__main__":
    main()
