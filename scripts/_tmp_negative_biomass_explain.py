"""Explain negative biomass: per-pond, per-cycle/species breakdown."""
from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

from api.models import AquacultureFishSale, AquacultureProductionCycle
from api.services.aquaculture_partial_harvest import effective_biomass_kg_from_position_row
from api.services.aquaculture_stock_service import (
    compute_fish_stock_position_breakdown_rows,
    compute_fish_stock_position_rows,
)
from api.services.tenant_reporting_categories import income_type_is_non_biological_for_company

CID = 2
OUT = Path(__file__).resolve().parents[1] / "scripts" / "_tmp_negative_biomass_explain.json"


def main() -> None:
    ponds = []
    for r in compute_fish_stock_position_rows(CID):
        pid = r["pond_id"]
        brk = compute_fish_stock_position_breakdown_rows(CID, pond_id=pid)
        neg_buckets = []
        pos_buckets = []
        for b in brk:
            n = int(b.get("implied_net_fish_count") or 0)
            book = Decimal(str(b.get("implied_net_weight_kg") or 0))
            eff = effective_biomass_kg_from_position_row(b)
            if n == 0 and book == 0:
                continue
            row = {
                "cycle_id": b.get("production_cycle_id"),
                "cycle_name": b.get("production_cycle_name"),
                "species": b.get("fish_species"),
                "heads": n,
                "book_kg": str(book),
                "eff_kg": str(eff),
                "stocked_n": int(b.get("stocked_fish_count") or 0),
                "stocked_kg": str(b.get("stocked_weight_kg") or 0),
                "sale_n": int(b.get("sale_fish_count") or 0),
                "sale_kg": str(b.get("sale_weight_kg") or 0),
                "tin_kg": str(b.get("transfer_in_weight_kg") or 0),
                "tout_kg": str(b.get("transfer_out_weight_kg") or 0),
                "bill_kg": str(b.get("vendor_bill_in_weight_kg") or 0),
                "ledger_kg": str(b.get("ledger_weight_kg_delta") or 0),
                "mort_n": int(b.get("mortality_fish_count") or 0),
                "sample_date": b.get("latest_sample_date"),
                "sample_avg": b.get("latest_sample_avg_weight_kg"),
            }
            # Classify why negative
            reasons = []
            if book < 0:
                stocked_w = Decimal(str(b.get("stocked_weight_kg") or 0))
                sale_w = Decimal(str(b.get("sale_weight_kg") or 0))
                if sale_w > stocked_w and stocked_w >= 0:
                    reasons.append(
                        "harvest_kg_exceeds_stocked_kg (growth not in book until reval)"
                    )
                if n < 0:
                    reasons.append("oversold_or_over_mortality_vs_stocked_heads")
                if b.get("production_cycle_id") is None and int(b.get("sale_fish_count") or 0) > 0:
                    reasons.append("sales_missing_production_cycle_id")
                if Decimal(str(b.get("ledger_weight_kg_delta") or 0)) < 0 and sale_w == 0:
                    reasons.append("ledger_mortality_or_adj_weight_without_matching_stock_kg")
                if not reasons:
                    reasons.append("net_of_stocked_minus_outflows_negative")
            row["neg_reasons"] = reasons
            if book < 0 or n < 0 or eff < 0:
                neg_buckets.append(row)
            else:
                pos_buckets.append(row)

        # Null-cycle sales count
        null_sales = AquacultureFishSale.objects.filter(
            company_id=CID, pond_id=pid, production_cycle_id__isnull=True
        )
        null_n = sum(
            int(s.fish_count or 0)
            for s in null_sales
            if not income_type_is_non_biological_for_company(CID, s.income_type or "")
        )
        null_kg = sum(
            (
                Decimal(str(s.weight_kg or 0))
                for s in null_sales
                if not income_type_is_non_biological_for_company(CID, s.income_type or "")
            ),
            Decimal(0),
        )

        cycles = list(
            AquacultureProductionCycle.objects.filter(company_id=CID, pond_id=pid)
            .order_by("id")
            .values("id", "code", "name", "is_active", "start_date")
        )
        for c in cycles:
            if c["start_date"]:
                c["start_date"] = c["start_date"].isoformat()

        ponds.append(
            {
                "pond_id": pid,
                "pond_name": r["pond_name"],
                "pond_role": r.get("pond_role"),
                "pond_heads": r["implied_net_fish_count"],
                "pond_book_kg": r["implied_net_weight_kg"],
                "pond_eff_kg": str(effective_biomass_kg_from_position_row(r)),
                "null_cycle_sale_heads": null_n,
                "null_cycle_sale_kg": str(null_kg),
                "cycles": cycles,
                "negative_buckets": neg_buckets,
                "positive_live_buckets": [
                    p for p in pos_buckets if int(p["heads"]) > 0
                ],
            }
        )

    payload = {
        "formula": {
            "book_kg": "stocked_kg (bills+xfer_in+pos_adj) − xfer_out − harvest_kg + ledger_deltas",
            "why_negative": [
                "Fry/fingerling enter at small kg; harvest leaves at market kg → book kg goes negative even when heads are fine (growth never booked).",
                "Sales tagged with wrong/missing production_cycle_id debit a bucket that has no matching stock-in.",
                "Mortality/transfer-out recorded at grown weight against fry purchase weight.",
                "Effective biomass falls back to book kg when no usable seine sample → negatives show in UI.",
            ],
            "present_stock_should_use": "effective = sample mean × heads (not raw book kg)",
        },
        "ponds": ponds,
    }
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {OUT}")
    for p in ponds:
        neg = p["negative_buckets"]
        print(
            f"\n=== {p['pond_name']} pond_book={p['pond_book_kg']} eff={p['pond_eff_kg']} "
            f"null_cycle_sales={p['null_cycle_sale_heads']} ==="
        )
        print(f"  negative buckets: {len(neg)}")
        for b in neg:
            print(
                f"  - cy={b['cycle_id']} {b['species']}: heads={b['heads']} book={b['book_kg']} "
                f"stocked_kg={b['stocked_kg']} sale_kg={b['sale_kg']} | {', '.join(b['neg_reasons'])}"
            )


if __name__ == "__main__":
    main()
