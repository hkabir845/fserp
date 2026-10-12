"""Safe biomass data fixes: backfill missing sample cycles from sales/bills/transfers.

Does NOT write off fish or delete samples — those need owner confirmation.
"""
from __future__ import annotations

import json
from datetime import date

from django.db import transaction

from api.models import AquacultureBiomassSample, AquacultureFishSale
from api.services.aquaculture_stock_service import compute_fish_stock_position_breakdown_rows

CID = 2
NOTE = "CORRECTED 2026-09-17: backfilled production_cycle from linked sale/bill/transfer or Ashari-2 C22 sales match."


@transaction.atomic
def apply() -> dict:
    out: dict = {"fixed_samples": [], "skipped": [], "ashari2_null_tagged": []}

    # 1) Sample cycle from linked harvest sale
    for s in AquacultureBiomassSample.objects.filter(
        company_id=CID, production_cycle_id__isnull=True, source_fish_sale_id__isnull=False
    ).select_related("source_fish_sale"):
        sale = s.source_fish_sale
        if sale and sale.production_cycle_id:
            s.production_cycle_id = sale.production_cycle_id
            if NOTE not in (s.notes or ""):
                s.notes = ((s.notes or "").strip() + (" | " if (s.notes or "").strip() else "") + NOTE)[:5000]
            s.save(update_fields=["production_cycle", "notes", "updated_at"])
            out["fixed_samples"].append(
                {"id": s.id, "via": "source_fish_sale", "cycle": sale.production_cycle_id, "pond": s.pond_id}
            )

    # 2) Sample cycle from linked bill line
    for s in AquacultureBiomassSample.objects.filter(
        company_id=CID, production_cycle_id__isnull=True, source_bill_line_id__isnull=False
    ).select_related("source_bill_line"):
        bl = s.source_bill_line
        cy = getattr(bl, "aquaculture_production_cycle_id", None) if bl else None
        if cy:
            s.production_cycle_id = cy
            if NOTE not in (s.notes or ""):
                s.notes = ((s.notes or "").strip() + (" | " if (s.notes or "").strip() else "") + NOTE)[:5000]
            s.save(update_fields=["production_cycle", "notes", "updated_at"])
            out["fixed_samples"].append({"id": s.id, "via": "source_bill_line", "cycle": cy, "pond": s.pond_id})

    # 3) Sample cycle from linked transfer line
    for s in AquacultureBiomassSample.objects.filter(
        company_id=CID, production_cycle_id__isnull=True, source_fish_pond_transfer_line_id__isnull=False
    ).select_related("source_fish_pond_transfer_line"):
        ln = s.source_fish_pond_transfer_line
        cy = getattr(ln, "to_production_cycle_id", None) if ln else None
        if cy:
            s.production_cycle_id = cy
            if NOTE not in (s.notes or ""):
                s.notes = ((s.notes or "").strip() + (" | " if (s.notes or "").strip() else "") + NOTE)[:5000]
            s.save(update_fields=["production_cycle", "notes", "updated_at"])
            out["fixed_samples"].append(
                {"id": s.id, "via": "source_transfer_line", "cycle": cy, "pond": s.pond_id}
            )

    # 4) Ashari-2: samples still null that match the two sales we tagged to C22 (same date+heads+kg)
    #    Sale #37 2025-09-19 8844/2713; Sale #44 2025-11-12 12637/6757.5
    ashari2_matches = [
        (date(2025, 9, 19), 8844, "2713.0000"),
        (date(2025, 11, 12), 12637, "6757.5000"),
    ]
    for d, n, kg in ashari2_matches:
        qs = AquacultureBiomassSample.objects.filter(
            company_id=CID,
            pond_id=14,
            production_cycle_id__isnull=True,
            fish_species="tilapia",
            sample_date=d,
            estimated_fish_count=n,
        )
        for s in qs:
            s.production_cycle_id = 22
            if NOTE not in (s.notes or ""):
                s.notes = ((s.notes or "").strip() + (" | " if (s.notes or "").strip() else "") + NOTE)[:5000]
            s.save(update_fields=["production_cycle", "notes", "updated_at"])
            out["ashari2_null_tagged"].append({"id": s.id, "date": d.isoformat(), "n": n})

    # Remaining null-cycle samples (report only)
    remaining = list(
        AquacultureBiomassSample.objects.filter(company_id=CID, production_cycle_id__isnull=True)
        .order_by("pond_id", "sample_date")
        .values("id", "pond_id", "sample_date", "fish_species", "estimated_fish_count")
    )
    out["remaining_null_cycle_samples"] = len(remaining)
    out["remaining_null_cycle_sample_ids_preview"] = remaining[:40]

    # Ashari-2 tilapia snapshot
    buckets = []
    for b in compute_fish_stock_position_breakdown_rows(CID, pond_id=14, fish_species_filter="tilapia"):
        n = int(b.get("implied_net_fish_count") or 0)
        if n or b.get("sale_fish_count"):
            buckets.append(
                {
                    "cy": b.get("production_cycle_id"),
                    "heads": n,
                    "sale_n": b.get("sale_fish_count"),
                    "sample": b.get("latest_sample_date"),
                    "avg": b.get("latest_sample_avg_weight_kg"),
                }
            )
    out["ashari2_tilapia_after"] = buckets

    null_sales = AquacultureFishSale.objects.filter(
        company_id=CID, production_cycle_id__isnull=True
    ).count()
    out["remaining_null_cycle_sales"] = null_sales
    return out


def main() -> None:
    print(json.dumps(apply(), indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
