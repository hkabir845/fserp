"""
Ashari-2: align C01 / Mirka standing samples with paper 11 Aug → 17 Sep gains.

- C01 Sep tilapia mean 1.6 → 1.3 (paper cycle total ~58,878 kg, not 65,303)
- Refresh Mirka (#405/#401) and C01 Aug/Sep sample extrapolation / gain fields

Run:
  cd backend && set FSERP_USE_SQLITE=0 && python ../scripts/_tmp_ashari2_c01_mirka_gain_fix.py
"""
from __future__ import annotations

import os
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
os.environ["FSERP_USE_SQLITE"] = "0"

import django

django.setup()

from api.models import AquacultureBiomassSample  # noqa: E402
from api.services.aquaculture_biomass_sample_service import (  # noqa: E402
    apply_aquaculture_biomass_sample_extrapolation,
)
from api.services.aquaculture_fcr_service import compute_fcr_for_scope  # noqa: E402

CID = 2
POND = 14
TILAPIA_SEP_ID = 411
MIRKA_IDS = (405, 401)


def main() -> None:
    s = AquacultureBiomassSample.objects.filter(id=TILAPIA_SEP_ID, company_id=CID, pond_id=POND).first()
    if s is None:
        print(f"missing tilapia sample #{TILAPIA_SEP_ID}")
    else:
        print(
            "tilapia Sep before",
            s.avg_weight_kg,
            s.estimated_total_weight_kg,
            s.extrapolated_biomass_kg,
        )
        s.avg_weight_kg = Decimal("1.300000")
        s.estimated_total_weight_kg = Decimal("13.0000")
        s.estimated_fish_count = 10
        apply_aquaculture_biomass_sample_extrapolation(s)
        s.save()
        print(
            "tilapia Sep after",
            s.avg_weight_kg,
            s.estimated_total_weight_kg,
            s.extrapolated_biomass_kg,
            "gain",
            s.biomass_gain_kg,
        )

    for sid in MIRKA_IDS:
        row = AquacultureBiomassSample.objects.filter(id=sid, company_id=CID, pond_id=POND).first()
        if row is None:
            print(f"missing Mirka sample #{sid}")
            continue
        apply_aquaculture_biomass_sample_extrapolation(row)
        row.save(
            update_fields=[
                "avg_weight_kg",
                "extrapolated_biomass_kg",
                "biomass_gain_kg",
                "stock_reference_fish_count",
                "stock_reference_net_weight_kg",
                "stock_reference_avg_weight_kg",
            ]
        )
        print(f"Mirka #{sid} extrap={row.extrapolated_biomass_kg} gain={row.biomass_gain_kg}")

    for row in AquacultureBiomassSample.objects.filter(
        company_id=CID,
        pond_id=POND,
        production_cycle_id=22,
        sample_date__in=[date(2026, 8, 11), date(2026, 9, 17)],
    ):
        apply_aquaculture_biomass_sample_extrapolation(row)
        row.save(
            update_fields=[
                "avg_weight_kg",
                "extrapolated_biomass_kg",
                "biomass_gain_kg",
                "stock_reference_fish_count",
                "stock_reference_net_weight_kg",
                "stock_reference_avg_weight_kg",
            ]
        )

    start, end = date(2026, 8, 11), date(2026, 9, 17)
    c01 = compute_fcr_for_scope(CID, start, end, pond_id=POND, production_cycle_id=22)
    mirka = compute_fcr_for_scope(CID, start, end, pond_id=POND, production_cycle_id=114)
    print(
        "C01 FCR",
        c01.get("biomass_first_kg"),
        "->",
        c01.get("biomass_last_kg"),
        "gain",
        c01.get("biomass_gain_kg"),
        "(paper ~50155 -> 58878 gain ~8723)",
    )
    print(
        "Mirka FCR",
        mirka.get("biomass_first_kg"),
        "->",
        mirka.get("biomass_last_kg"),
        "gain",
        mirka.get("biomass_gain_kg"),
        "(paper ~6743 -> 7706 gain ~963)",
    )


if __name__ == "__main__":
    main()
