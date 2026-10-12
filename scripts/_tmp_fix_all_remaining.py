"""Fix all remaining safe biomass tagging issues (local then VPS).

1) Mynuddin: null-cycle tilapia sales Aug–Dec 2025 → C01 (cycle 2)
2) Mynuddin: Jun 2026 polyculture null sales → species cycles
3) Mynuddin: Jul 14 transfer 110k tilapia to_cy None → cycle 2
4) Samples: backfill cycle from linked sale / date+species match
5) Ashari-1 Sep–Oct 2025 null samples → C01 (cycle 23) matching sales
6) Ashari-3 nursing samples in C01 window → cycle 79
7) Ashari-2 #394: already rejected by code; add note (no delete)

Year-lock is a user decision — this script does not apply it.
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

from django.db import transaction

from api.models import (
    AquacultureBiomassSample,
    AquacultureFishPondTransferLine,
    AquacultureFishSale,
)
from api.services.aquaculture_stock_service import compute_fish_stock_position_breakdown_rows
from api.services.tenant_reporting_categories import income_type_is_non_biological_for_company

CID = 2
MYN = 2
NOTE = "CORRECTED 2026-09-17: assigned production_cycle (null-cycle cleanup)."

# Mynuddin species → cycle for polyculture sales
SPECIES_CYCLE = {
    "common_carp": 91,
    "rui": 107,
    "silver_carp": 109,
    "bighead_carp": 122,
    "kalibaush": 92,
    "grass_carp": 123,
    "other": 124,
}
C01_TILAPIA = 2  # First cycle — Jul 2025 stocking
C02_TILAPIA = 80  # from 2025-12-06
C03_TILAPIA = 126  # from 2026-06-06


def _note(obj) -> None:
    if not hasattr(obj, "memo") and hasattr(obj, "notes"):
        field = "notes"
        cur = obj.notes or ""
    else:
        field = "memo"
        cur = getattr(obj, "memo", None) or ""
    if NOTE in cur:
        return
    new = (cur.strip() + (" | " if cur.strip() else "") + NOTE)[:5000]
    setattr(obj, field, new)


@transaction.atomic
def apply() -> dict:
    out: dict = {"sales": [], "samples": [], "transfers": [], "notes": []}

    # --- Sales: Mynuddin null-cycle ---
    for s in AquacultureFishSale.objects.filter(
        company_id=CID, pond_id=MYN, production_cycle_id__isnull=True
    ).order_by("sale_date", "id"):
        if income_type_is_non_biological_for_company(CID, s.income_type or ""):
            continue
        sp = (s.fish_species or "tilapia").strip()
        cy = None
        if sp == "tilapia":
            if s.sale_date < date(2025, 12, 6):
                cy = C01_TILAPIA
            elif s.sale_date < date(2026, 6, 6):
                cy = C02_TILAPIA
            else:
                cy = C03_TILAPIA
        else:
            cy = SPECIES_CYCLE.get(sp)
        if cy is None:
            out["notes"].append(f"sale#{s.id} no cycle map for {sp}")
            continue
        s.production_cycle_id = cy
        _note(s)
        s.save(update_fields=["production_cycle", "memo", "updated_at"])
        out["sales"].append({"id": s.id, "date": str(s.sale_date), "sp": sp, "cy": cy, "n": s.fish_count})

    # --- Transfer: Jul 14 110000 to_cy None → C01 ---
    for ln in AquacultureFishPondTransferLine.objects.filter(
        transfer__company_id=CID,
        to_pond_id=MYN,
        to_production_cycle_id__isnull=True,
    ).select_related("transfer"):
        tr = ln.transfer
        if tr.fish_species == "tilapia" and tr.transfer_date <= date(2025, 12, 5):
            ln.to_production_cycle_id = C01_TILAPIA
            ln.save(update_fields=["to_production_cycle"])
            out["transfers"].append(
                {
                    "line_id": ln.id,
                    "transfer_id": tr.id,
                    "date": str(tr.transfer_date),
                    "n": ln.fish_count,
                    "to_cy": C01_TILAPIA,
                }
            )

    # --- Samples: from linked sale ---
    for s in AquacultureBiomassSample.objects.filter(
        company_id=CID, production_cycle_id__isnull=True, source_fish_sale_id__isnull=False
    ).select_related("source_fish_sale"):
        sale = s.source_fish_sale
        if sale and sale.production_cycle_id:
            s.production_cycle_id = sale.production_cycle_id
            _note(s)
            s.save(update_fields=["production_cycle", "notes", "updated_at"])
            out["samples"].append({"id": s.id, "via": "sale", "cy": sale.production_cycle_id})

    # --- Samples: Mynuddin null tilapia by date window ---
    for s in AquacultureBiomassSample.objects.filter(
        company_id=CID, pond_id=MYN, production_cycle_id__isnull=True
    ).order_by("sample_date", "id"):
        sp = (s.fish_species or "tilapia").strip()
        cy = None
        if sp == "tilapia":
            if s.sample_date < date(2025, 12, 6):
                cy = C01_TILAPIA
            elif s.sample_date < date(2026, 6, 6):
                cy = C02_TILAPIA
            else:
                cy = C03_TILAPIA
        else:
            cy = SPECIES_CYCLE.get(sp)
        if cy is None:
            continue
        s.production_cycle_id = cy
        _note(s)
        s.save(update_fields=["production_cycle", "notes", "updated_at"])
        out["samples"].append({"id": s.id, "via": "date_species", "cy": cy, "sp": sp})

    # --- Nursing ponds: only-one-cycle backfill if possible ---
    from api.models import AquacultureProductionCycle

    for pond_id in (16, 17, 19):  # nursing
        cycles = list(
            AquacultureProductionCycle.objects.filter(company_id=CID, pond_id=pond_id).order_by("id")
        )
        if len(cycles) != 1:
            continue
        cy_id = cycles[0].id
        for s in AquacultureBiomassSample.objects.filter(
            company_id=CID, pond_id=pond_id, production_cycle_id__isnull=True
        ):
            s.production_cycle_id = cy_id
            _note(s)
            s.save(update_fields=["production_cycle", "notes", "updated_at"])
            out["samples"].append({"id": s.id, "via": "sole_nursing_cycle", "cy": cy_id})

    # --- Ashari-1 (pond 13): Sep–Oct 2025 samples match C01 sales (cycle 23) ---
    ASHARI1_C01 = 23
    for s in AquacultureBiomassSample.objects.filter(
        company_id=CID, pond_id=13, production_cycle_id__isnull=True, fish_species="tilapia"
    ):
        if date(2025, 9, 1) <= s.sample_date <= date(2025, 10, 31):
            s.production_cycle_id = ASHARI1_C01
            _note(s)
            s.save(update_fields=["production_cycle", "notes", "updated_at"])
            out["samples"].append({"id": s.id, "via": "ashari1_sale_window", "cy": ASHARI1_C01})

    # --- Ashari-3 (pond 17): samples before C02 start (2025-12-16) → C01 (79) ---
    ASHARI3_C01 = 79
    ASHARI3_C02_START = date(2025, 12, 16)
    for s in AquacultureBiomassSample.objects.filter(
        company_id=CID, pond_id=17, production_cycle_id__isnull=True
    ):
        if s.sample_date < ASHARI3_C02_START:
            s.production_cycle_id = ASHARI3_C01
            _note(s)
            s.save(update_fields=["production_cycle", "notes", "updated_at"])
            out["samples"].append({"id": s.id, "via": "ashari3_c01_window", "cy": ASHARI3_C01})

    # --- Ashari-2 #394 note (already ignored by seine-size guard) ---
    s394 = AquacultureBiomassSample.objects.filter(pk=394).first()
    if s394:
        note = (
            "NOTE 2026-09-17: 1-fish seine — ignored for pond mass "
            "(biomass_sample_fields_ok_for_pond_mass). C22 leftovers still present; "
            "use larger seines for size."
        )
        if "NOTE 2026-09-17: 1-fish seine" not in (s394.notes or ""):
            s394.notes = ((s394.notes or "").strip() + (" | " if (s394.notes or "").strip() else "") + note)[
                :5000
            ]
            s394.save(update_fields=["notes", "updated_at"])
            out["notes"].append("annotated sample #394")

    # --- Fix Mynuddin C01 start_date if wrongly set in 2026 ---
    cy2 = AquacultureProductionCycle.objects.filter(pk=C01_TILAPIA).first()
    if cy2 and cy2.start_date and cy2.start_date.year == 2026:
        cy2.start_date = date(2025, 7, 14)
        cy2.save(update_fields=["start_date"])
        out["notes"].append("C01 start_date → 2025-07-14")

    # --- Verify ---
    null_sales = AquacultureFishSale.objects.filter(
        company_id=CID, production_cycle_id__isnull=True
    ).count()
    null_samp = AquacultureBiomassSample.objects.filter(
        company_id=CID, production_cycle_id__isnull=True
    ).count()
    out["remaining_null_sales"] = null_sales
    out["remaining_null_samples"] = null_samp

    out["mynuddin_tilapia"] = []
    for b in compute_fish_stock_position_breakdown_rows(CID, pond_id=MYN, fish_species_filter="tilapia"):
        n = int(b.get("implied_net_fish_count") or 0)
        if n or int(b.get("sale_fish_count") or 0):
            out["mynuddin_tilapia"].append(
                {
                    "cy": b.get("production_cycle_id"),
                    "heads": n,
                    "sale_n": b.get("sale_fish_count"),
                    "sample": b.get("latest_sample_date"),
                }
            )

    out["year_lock"] = "skipped — user decision"
    return out


def main() -> None:
    print(json.dumps(apply(), indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
