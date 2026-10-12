from decimal import Decimal

from api.models import AquacultureFishSale, AquacultureProductionCycle
from api.services.aquaculture_data_bank_service import pond_live_data_after_date
from api.services.aquaculture_partial_harvest import effective_biomass_kg_from_position_row
from api.services.aquaculture_stock_service import (
    compute_fish_stock_position_breakdown_rows,
    compute_fish_stock_position_rows,
)

CID = 2
POND = 14


def main() -> None:
    after = pond_live_data_after_date(CID, POND)
    print(f"Ashari-2 live_after_lock={after}")
    for cy in AquacultureProductionCycle.objects.filter(company_id=CID, pond_id=POND).order_by("id"):
        print(
            f"  cycle {cy.id} {cy.code} active={cy.is_active} "
            f"start={cy.start_date} end={cy.end_date}"
        )

    pond = compute_fish_stock_position_rows(CID, pond_id=POND, entries_after_date=after)[0]
    eff = effective_biomass_kg_from_position_row(pond)
    print(
        f"\nPOND TOTAL heads={pond['implied_net_fish_count']} "
        f"book_kg={pond['implied_net_weight_kg']} eff_kg={eff}"
    )

    print("\nBREAKDOWN (all species with stock/sales):")
    for b in compute_fish_stock_position_breakdown_rows(
        CID, pond_id=POND, entries_after_date=after
    ):
        n = int(b["implied_net_fish_count"] or 0)
        w = Decimal(str(b["implied_net_weight_kg"] or 0))
        sale = int(b.get("sale_fish_count") or 0)
        if not (n or w or sale):
            continue
        print(
            f"  cy={b.get('production_cycle_id')} {b.get('fish_species')}: "
            f"heads={n} book={w} sale_n={sale} "
            f"sample={b.get('latest_sample_date')} avg={b.get('latest_sample_avg_weight_kg')} "
            f"eff={effective_biomass_kg_from_position_row(b)}"
        )

    null_n = AquacultureFishSale.objects.filter(
        company_id=CID, pond_id=POND, production_cycle_id__isnull=True
    ).count()
    print(f"\nnull-cycle sales rows left: {null_n}")

    tilapia_heads = sum(
        int(b["implied_net_fish_count"] or 0)
        for b in compute_fish_stock_position_breakdown_rows(
            CID, pond_id=POND, entries_after_date=after
        )
        if b.get("fish_species") == "tilapia"
    )
    print(f"tilapia heads sum: {tilapia_heads}")


if __name__ == "__main__":
    main()
