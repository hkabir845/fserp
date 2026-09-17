"""Mynuddin C02 tilapia: bridge negative book kg to usable sample biomass (idempotent).

C02 (cycle 80): 1,961 heads left, book −25,359.86 kg (fry stocked kg ≪ harvest kg).
Standing sample #324 (12 × 10 kg @ 0.833 kg/fish, 2026-08-12) already drives live eff = 1,634.17 kg.
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction

from api.models import AquacultureFishStockLedger
from api.services.aquaculture_partial_harvest import (
    effective_biomass_kg_from_position_row,
    position_row_has_usable_standing_sample,
)
from api.services.aquaculture_stock_service import (
    compute_fish_stock_position_breakdown_rows,
    compute_fish_stock_position_rows,
)

CID = 2
POND = 2
CYCLE = 80
SPECIES = "tilapia"
BOOK_MEMO = "CORRECTED 2026-09-17: Mynuddin C02 tilapia book bridge to sample biomass"


def _q4(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


@transaction.atomic
def apply() -> dict:
    out: dict = {"actions": []}
    brk = compute_fish_stock_position_breakdown_rows(CID, pond_id=POND)
    c02 = next(
        (
            b
            for b in brk
            if b.get("production_cycle_id") == CYCLE and b.get("fish_species") == SPECIES
        ),
        None,
    )
    if c02 is None:
        out["actions"].append({"c02_book_bridge": "bucket_missing"})
        return out

    book = Decimal(str(c02.get("implied_net_weight_kg") or 0))
    eff = effective_biomass_kg_from_position_row(c02)
    heads = int(c02.get("implied_net_fish_count") or 0)
    usable = position_row_has_usable_standing_sample(c02, date.today())
    out["before"] = {
        "heads": heads,
        "book": str(book),
        "eff": str(eff),
        "usable": usable,
        "sample": str(c02.get("latest_sample_date") or ""),
        "avg": str(c02.get("latest_sample_avg_weight_kg") or ""),
        "seine_n": c02.get("latest_sample_estimated_fish_count"),
    }

    already = AquacultureFishStockLedger.objects.filter(
        company_id=CID, pond_id=POND, memo__startswith=BOOK_MEMO
    ).exists()
    if already:
        out["actions"].append({"c02_book_bridge": "already_done", **out["before"]})
    elif heads > 0 and usable and eff > 0:
        delta = _q4(eff - book)
        if abs(delta) >= Decimal("0.01"):
            sample_date = c02.get("latest_sample_date") or date.today()
            if isinstance(sample_date, str):
                sample_date = date.fromisoformat(sample_date[:10])
            AquacultureFishStockLedger.objects.create(
                company_id=CID,
                pond_id=POND,
                production_cycle_id=CYCLE,
                entry_date=sample_date,
                entry_kind="adjustment",
                loss_reason="",
                fish_species=SPECIES,
                fish_count_delta=0,
                weight_kg_delta=delta,
                book_value=Decimal("0"),
                post_to_books=False,
                memo=f"{BOOK_MEMO} ({book} → {eff}).",
            )
            out["actions"].append(
                {
                    "c02_book_bridge": "created",
                    "delta_kg": str(delta),
                    "from_book": str(book),
                    "to_eff": str(eff),
                    "heads": heads,
                }
            )
        else:
            out["actions"].append({"c02_book_bridge": "already_aligned", **out["before"]})
    else:
        out["actions"].append({"c02_book_bridge": "skipped", **out["before"]})

    # Verify
    after_brk = compute_fish_stock_position_breakdown_rows(CID, pond_id=POND)
    after = next(
        (
            b
            for b in after_brk
            if b.get("production_cycle_id") == CYCLE and b.get("fish_species") == SPECIES
        ),
        None,
    )
    pond = compute_fish_stock_position_rows(CID, pond_id=POND)[0]
    neg = []
    for b in after_brk:
        n = int(b.get("implied_net_fish_count") or 0)
        w = Decimal(str(b.get("implied_net_weight_kg") or 0))
        if n > 0 and w < 0:
            neg.append(
                {
                    "cy": b.get("production_cycle_id"),
                    "species": b.get("fish_species"),
                    "heads": n,
                    "book": str(w),
                    "eff": str(effective_biomass_kg_from_position_row(b)),
                }
            )
    out["verify"] = {
        "c02_book": str(after.get("implied_net_weight_kg") if after else None),
        "c02_eff": str(effective_biomass_kg_from_position_row(after) if after else None),
        "pond_eff": str(effective_biomass_kg_from_position_row(pond)),
        "pond_combined": pond.get("species_combined_biomass_kg"),
        "negative_book_with_heads": neg,
    }
    return out


def main() -> None:
    print(json.dumps(apply(), indent=2, default=str))


if __name__ == "__main__":
    main()
