"""Resync AUTO biomass book revaluations to latest samples."""
from __future__ import annotations

from api.models import AquacultureBiomassSample, AquaculturePond
from api.services.aquaculture_biomass_book_revaluation_service import (
    sync_biomass_book_weight_for_pond,
    sync_biomass_book_weight_from_sample,
)
from api.services.aquaculture_partial_harvest import effective_biomass_kg_from_position_row
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows

CID = 2
SPECIES = [
    "tilapia",
    "rui",
    "bighead_carp",
    "silver_carp",
    "grass_carp",
    "common_carp",
    "kalibaush",
    "other",
    "catla",
]


def main() -> None:
    for p in AquaculturePond.objects.filter(company_id=CID, is_active=True, pond_role="grow_out"):
        row = sync_biomass_book_weight_for_pond(company_id=CID, pond_id=p.id, fish_species="tilapia")
        print(
            p.name,
            "tilapia reval",
            None if row is None else (row.id, str(row.weight_kg_delta), (row.memo or "")[:90]),
        )

    for sp in SPECIES:
        if sp == "tilapia":
            continue
        for p in AquaculturePond.objects.filter(company_id=CID, is_active=True, pond_role="grow_out"):
            latest = (
                AquacultureBiomassSample.objects.filter(
                    company_id=CID, pond_id=p.id, fish_species=sp
                )
                .order_by("-sample_date", "-id")
                .first()
            )
            if not latest:
                continue
            row = sync_biomass_book_weight_from_sample(latest)
            if row:
                print(p.name, sp, "reval", row.id, row.weight_kg_delta, latest.sample_date)

    print("--- AFTER ---")
    total_h = 0
    total_b = 0
    total_e = 0
    from decimal import Decimal

    for p in AquaculturePond.objects.filter(company_id=CID, is_active=True).order_by(
        "sort_order", "id"
    ):
        r = compute_fish_stock_position_rows(CID, pond_id=p.id)[0]
        eff = effective_biomass_kg_from_position_row(r)
        h = int(r["implied_net_fish_count"] or 0)
        b = Decimal(str(r["implied_net_weight_kg"] or 0))
        total_h += h
        total_b += b
        total_e += eff
        print(f"{p.name:22} heads={h:>8} book={b:>12} eff={eff}")
    print(f"{'TOTAL':22} heads={total_h:>8} book={total_b:>12} eff={total_e}")


if __name__ == "__main__":
    main()
