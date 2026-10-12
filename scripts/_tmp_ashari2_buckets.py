from collections import Counter
from datetime import date
from decimal import Decimal

from api.models import AquacultureDataBankPondClose, AquacultureFishSale, AquacultureProductionCycle
from api.services.aquaculture_data_bank_service import pond_live_data_after_date
from api.services.aquaculture_stock_service import (
    compute_fish_stock_position_breakdown_rows,
    compute_fish_stock_position_rows,
)

CID = 2
POND = 14


def main() -> None:
    after = pond_live_data_after_date(CID, POND)
    print("live_after", after)
    closes = list(
        AquacultureDataBankPondClose.objects.filter(company_id=CID, pond_id=POND)
        .order_by("-period_end")
        .values("id", "period_end", "is_data_locked", "settlement_fish_count", "label")
    )
    print("closes", closes)
    for cy in AquacultureProductionCycle.objects.filter(company_id=CID, pond_id=POND).order_by("id"):
        print(
            f"cycle {cy.id} {cy.code} active={cy.is_active} "
            f"start={cy.start_date} end={cy.end_date} name={cy.name!r}"
        )

    print("--- LIFETIME ---")
    life = compute_fish_stock_position_rows(CID, pond_id=POND)[0]
    print("pond", life["implied_net_fish_count"], life["implied_net_weight_kg"])
    for b in compute_fish_stock_position_breakdown_rows(CID, pond_id=POND):
        n = int(b["implied_net_fish_count"] or 0)
        w = Decimal(str(b["implied_net_weight_kg"] or 0))
        if n or w:
            print(
                f"  cy={b.get('production_cycle_id')} {b.get('fish_species')}: "
                f"n={n} book={w} stocked={b.get('stocked_fish_count')} sale={b.get('sale_fish_count')}"
            )

    print("--- LIVE ---")
    live = compute_fish_stock_position_rows(CID, pond_id=POND, entries_after_date=after)[0]
    print("pond", live["implied_net_fish_count"], live["implied_net_weight_kg"])
    for b in compute_fish_stock_position_breakdown_rows(
        CID, pond_id=POND, entries_after_date=after
    ):
        n = int(b["implied_net_fish_count"] or 0)
        w = Decimal(str(b["implied_net_weight_kg"] or 0))
        if n or w:
            print(
                f"  cy={b.get('production_cycle_id')} {b.get('fish_species')}: "
                f"n={n} book={w} stocked={b.get('stocked_fish_count')} sale={b.get('sale_fish_count')}"
            )

    c: Counter = Counter()
    kg = Decimal(0)
    for s in AquacultureFishSale.objects.filter(
        company_id=CID, pond_id=POND, production_cycle_id__isnull=True, fish_species="tilapia"
    ):
        c[str(s.sale_date)] += int(s.fish_count or 0)
        kg += Decimal(str(s.weight_kg or 0))
    print("null-cycle tilapia sale rows", len(c), "total_heads", sum(c.values()), "kg", kg)
    if after:
        after_n = sum(
            int(s.fish_count or 0)
            for s in AquacultureFishSale.objects.filter(
                company_id=CID,
                pond_id=POND,
                production_cycle_id__isnull=True,
                fish_species="tilapia",
                sale_date__gt=after,
            )
        )
        print("null-cycle tilapia heads AFTER lock", after_n)


if __name__ == "__main__":
    main()
