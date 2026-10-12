from decimal import Decimal

from api.services.aquaculture_partial_harvest import effective_biomass_kg_from_position_row
from api.services.aquaculture_stock_service import (
    compute_fish_stock_position_breakdown_rows,
    compute_fish_stock_position_rows,
)


def main() -> None:
    print("ALL PONDS")
    total_e = Decimal(0)
    total_h = 0
    for r in compute_fish_stock_position_rows(2):
        e = effective_biomass_kg_from_position_row(r)
        total_e += e
        total_h += int(r["implied_net_fish_count"] or 0)
        print(
            f"{r['pond_name']:24} h={r['implied_net_fish_count']:>8} "
            f"book={r['implied_net_weight_kg']:>14} eff={e}"
        )
    print("TOTAL", total_h, total_e)
    print("ASHARI-2 BREAKDOWN")
    for r in compute_fish_stock_position_breakdown_rows(2, pond_id=14):
        n = int(r["implied_net_fish_count"] or 0)
        w = Decimal(str(r["implied_net_weight_kg"] or 0))
        if n or w:
            print(
                f"  cy={r.get('production_cycle_id')} {r.get('fish_species')}: "
                f"n={n} book={w} eff={effective_biomass_kg_from_position_row(r)} "
                f"samp={r.get('latest_sample_date')} avg={r.get('latest_sample_avg_weight_kg')}"
            )


if __name__ == "__main__":
    main()
