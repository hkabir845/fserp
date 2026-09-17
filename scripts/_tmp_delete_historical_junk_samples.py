"""Delete leftover historical junk biomass samples (idempotent).

Removes:
- Tilapia standing seines with 1–4 fish (rejected for pond mass; can block newer standing)
- Digonto Nursing duplicate standing #287 (keep #306 — same 164×3.0 kg seine)

Does NOT touch harvest-linked auto samples or valid multi-fish standing rows.
"""
from __future__ import annotations

import json
from decimal import Decimal

from django.db import transaction

from api.models import AquacultureBiomassSample
from api.services.aquaculture_partial_harvest import _MIN_SEINE_HEADS_FOR_POND_MASS
from api.services.aquaculture_partial_harvest import effective_biomass_kg_from_position_row
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows

CID = 2

# Explicit allow-list from farm scan (safe historical junk only)
TINY_TILAPIA_STANDING_IDS = (93, 110, 223, 228, 269, 336)
DUPLICATE_STANDING_IDS = (287,)  # Digonto Nursing twin of #306


def _is_junk_tiny_tilapia_standing(s: AquacultureBiomassSample) -> bool:
    if s.fish_species != "tilapia":
        return False
    if s.source_fish_sale_id or s.source_bill_line_id:
        return False
    if s.source_fish_pond_transfer_id or s.source_fish_pond_transfer_line_id:
        return False
    n = int(s.estimated_fish_count or 0)
    return 0 < n < _MIN_SEINE_HEADS_FOR_POND_MASS


@transaction.atomic
def apply() -> dict:
    out: dict = {"deleted": [], "skipped": []}

    for sid in TINY_TILAPIA_STANDING_IDS:
        s = AquacultureBiomassSample.objects.filter(pk=sid, company_id=CID).first()
        if not s:
            out["skipped"].append({"id": sid, "reason": "already_gone"})
            continue
        if not _is_junk_tiny_tilapia_standing(s):
            out["skipped"].append(
                {
                    "id": sid,
                    "reason": "safety_guard_not_tiny_tilapia_standing",
                    "species": s.fish_species,
                    "seine_n": s.estimated_fish_count,
                    "sale": s.source_fish_sale_id,
                }
            )
            continue
        out["deleted"].append(
            {
                "id": s.id,
                "pond_id": s.pond_id,
                "date": str(s.sample_date),
                "cycle_id": s.production_cycle_id,
                "seine_n": s.estimated_fish_count,
                "avg": str(s.avg_weight_kg),
                "extrap": str(s.extrapolated_biomass_kg),
                "kind": "tiny_tilapia_standing",
            }
        )
        s.delete()

    for sid in DUPLICATE_STANDING_IDS:
        s = AquacultureBiomassSample.objects.filter(pk=sid, company_id=CID).first()
        if not s:
            out["skipped"].append({"id": sid, "reason": "already_gone"})
            continue
        # Confirm twin #306 still exists with same seine
        twin = AquacultureBiomassSample.objects.filter(pk=306, company_id=CID).first()
        if twin is None:
            out["skipped"].append({"id": sid, "reason": "twin_306_missing_keep_287"})
            continue
        same = (
            s.pond_id == twin.pond_id
            and s.sample_date == twin.sample_date
            and s.fish_species == twin.fish_species
            and s.production_cycle_id == twin.production_cycle_id
            and int(s.estimated_fish_count or 0) == int(twin.estimated_fish_count or 0)
            and Decimal(str(s.estimated_total_weight_kg or 0))
            == Decimal(str(twin.estimated_total_weight_kg or 0))
        )
        if not same:
            out["skipped"].append({"id": sid, "reason": "no_longer_duplicate_of_306"})
            continue
        out["deleted"].append(
            {
                "id": s.id,
                "pond_id": s.pond_id,
                "date": str(s.sample_date),
                "cycle_id": s.production_cycle_id,
                "seine_n": s.estimated_fish_count,
                "kind": "duplicate_standing",
                "kept_twin": 306,
            }
        )
        s.delete()

    # Live sanity — pond combined should stay positive / unchanged class
    ponds = []
    for r in compute_fish_stock_position_rows(CID):
        ponds.append(
            {
                "pond": r["pond_name"],
                "heads": r["implied_net_fish_count"],
                "eff": str(effective_biomass_kg_from_position_row(r)),
                "combined": r.get("species_combined_biomass_kg"),
            }
        )
    out["ponds_after"] = ponds
    out["remaining_tiny_tilapia_standing"] = AquacultureBiomassSample.objects.filter(
        company_id=CID,
        fish_species="tilapia",
        estimated_fish_count__gt=0,
        estimated_fish_count__lt=_MIN_SEINE_HEADS_FOR_POND_MASS,
        source_fish_sale__isnull=True,
        source_bill_line__isnull=True,
        source_fish_pond_transfer_line__isnull=True,
    ).count()
    return out


def main() -> None:
    print(json.dumps(apply(), indent=2, default=str))


if __name__ == "__main__":
    main()
