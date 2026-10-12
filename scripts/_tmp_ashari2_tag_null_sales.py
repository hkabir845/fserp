"""Ashari-2: tag null-cycle tilapia sales to C22 (cycle 22). Idempotent."""
from __future__ import annotations

import json
from decimal import Decimal

from django.db import transaction

from api.models import AquacultureFishSale, AquacultureProductionCycle
from api.services.aquaculture_stock_service import compute_fish_stock_position_breakdown_rows

CID = 2
POND = 14
TARGET_CYCLE = 22
MEMO_NOTE = "CORRECTED 2026-09-17: assigned production_cycle_id=22 (C01) — was null."


@transaction.atomic
def apply() -> dict:
    cy = AquacultureProductionCycle.objects.filter(
        pk=TARGET_CYCLE, company_id=CID, pond_id=POND
    ).first()
    if not cy:
        return {"error": f"cycle {TARGET_CYCLE} not found on pond {POND}"}

    qs = AquacultureFishSale.objects.filter(
        company_id=CID,
        pond_id=POND,
        production_cycle_id__isnull=True,
        fish_species="tilapia",
    ).order_by("sale_date", "id")

    before = []
    total_n = 0
    total_kg = Decimal("0")
    for s in qs:
        n = int(s.fish_count or 0)
        w = Decimal(str(s.weight_kg or 0))
        total_n += n
        total_kg += w
        before.append(
            {
                "id": s.id,
                "date": s.sale_date.isoformat(),
                "n": n,
                "kg": str(w),
                "income_type": s.income_type,
            }
        )

    updated = 0
    for s in qs:
        s.production_cycle_id = TARGET_CYCLE
        # keep a short trail in memo if field exists
        if hasattr(s, "memo"):
            note = MEMO_NOTE
            if note not in (s.memo or ""):
                s.memo = ((s.memo or "").strip() + (" | " if (s.memo or "").strip() else "") + note)[
                    :5000
                ]
                s.save(update_fields=["production_cycle_id", "memo", "updated_at"])
            else:
                s.save(update_fields=["production_cycle_id", "updated_at"])
        else:
            s.save(update_fields=["production_cycle_id", "updated_at"])
        updated += 1

    # verify buckets
    null_left = AquacultureFishSale.objects.filter(
        company_id=CID,
        pond_id=POND,
        production_cycle_id__isnull=True,
        fish_species="tilapia",
    ).count()

    buckets = []
    for b in compute_fish_stock_position_breakdown_rows(CID, pond_id=POND):
        n = int(b.get("implied_net_fish_count") or 0)
        if b.get("fish_species") != "tilapia" and n == 0:
            continue
        if b.get("fish_species") == "tilapia" or n:
            if b.get("fish_species") == "tilapia" or (
                b.get("production_cycle_id") is None and n
            ):
                buckets.append(
                    {
                        "cy": b.get("production_cycle_id"),
                        "sp": b.get("fish_species"),
                        "heads": n,
                        "sale_n": b.get("sale_fish_count"),
                        "book": b.get("implied_net_weight_kg"),
                    }
                )

    return {
        "target_cycle": TARGET_CYCLE,
        "cycle_name": cy.name,
        "sales_updated": updated,
        "heads_moved": total_n,
        "kg_moved": str(total_kg),
        "sales_before": before,
        "null_cycle_tilapia_sales_left": null_left,
        "tilapia_buckets_after": [
            x for x in buckets if x["sp"] == "tilapia" or x["cy"] is None
        ],
    }


def main() -> None:
    print(json.dumps(apply(), indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
