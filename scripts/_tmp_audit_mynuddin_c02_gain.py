"""Audit Mynuddin C02 production biomass gain for a period (read-only)."""
from __future__ import annotations

import json
import os
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.chdir(ROOT / "backend")

# Load backend/.env
env_path = ROOT / "backend" / ".env"
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

os.environ.setdefault("FSERP_USE_SQLITE", "0")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")

import django

django.setup()

from api.models import (  # noqa: E402
    AquacultureBiomassSample,
    AquacultureFishSale,
    AquacultureFishStockLedger,
    AquaculturePond,
    AquacultureProductionCycle,
)
from api.services.aquaculture_fcr_service import compute_fcr_for_scope  # noqa: E402
from api.services.aquaculture_biomass_book_revaluation_service import (  # noqa: E402
    is_book_revaluation_ledger_row,
)

START = date(2025, 2, 20)
END = date(2026, 2, 20)
POND_NAME = "Mynuddin"
CYCLE_CODE = "C02"


def main() -> None:
    pond = AquaculturePond.objects.filter(name__icontains=POND_NAME).order_by("id").first()
    if not pond:
        print(json.dumps({"error": "pond not found"}))
        return
    cid = pond.company_id
    cycles = list(
        AquacultureProductionCycle.objects.filter(company_id=cid, pond_id=pond.id).values(
            "id", "code", "name", "fish_species", "start_date", "end_date"
        )
    )
    c02 = next((c for c in cycles if (c.get("code") or "").upper() == CYCLE_CODE), None)
    if not c02:
        # fallback by name
        c02 = next((c for c in cycles if CYCLE_CODE.lower() in (c.get("name") or "").lower()), None)
    out: dict = {
        "pond": {"id": pond.id, "name": pond.name, "company_id": cid},
        "cycles": cycles,
        "c02": c02,
        "period": {"start": START.isoformat(), "end": END.isoformat()},
    }
    if not c02:
        print(json.dumps(out, indent=2, default=str))
        return
    cy = int(c02["id"])
    fcr = compute_fcr_for_scope(cid, START, END, pond_id=pond.id, production_cycle_id=cy)
    out["fcr"] = fcr

    sales = list(
        AquacultureFishSale.objects.filter(
            company_id=cid,
            pond_id=pond.id,
            sale_date__gte=START,
            sale_date__lte=END,
        )
        .order_by("sale_date", "id")
        .values(
            "id",
            "sale_date",
            "income_type",
            "weight_kg",
            "production_cycle_id",
            "fish_species",
        )
    )
    by_cy: dict[str, Decimal] = {}
    null_kg = Decimal("0")
    null_n = 0
    c02_kg = Decimal("0")
    for s in sales:
        w = Decimal(str(s["weight_kg"] or 0))
        if (s.get("income_type") or "") != "fish_harvest_sale":
            continue
        pid = s.get("production_cycle_id")
        key = str(pid) if pid else "null"
        by_cy[key] = by_cy.get(key, Decimal("0")) + w
        if pid is None:
            null_kg += w
            null_n += 1
        if pid == cy:
            c02_kg += w
    out["harvest_by_cycle_kg"] = {k: str(v) for k, v in sorted(by_cy.items())}
    out["harvest_null_cycle"] = {"count": null_n, "kg": str(null_kg)}
    out["harvest_c02_kg"] = str(c02_kg)

    samples = list(
        AquacultureBiomassSample.objects.filter(
            company_id=cid,
            pond_id=pond.id,
            sample_date__gte=START,
            sample_date__lte=END,
            production_cycle_id=cy,
        )
        .order_by("sample_date", "id")
        .values(
            "id",
            "sample_date",
            "fish_species",
            "estimated_fish_count",
            "estimated_total_weight_kg",
            "extrapolated_biomass_kg",
            "stock_reference_fish_count",
            "biomass_gain_kg",
        )
    )
    out["c02_samples"] = [
        {
            **s,
            "estimated_total_weight_kg": str(s["estimated_total_weight_kg"] or ""),
            "extrapolated_biomass_kg": str(s["extrapolated_biomass_kg"] or ""),
            "biomass_gain_kg": str(s["biomass_gain_kg"] or ""),
        }
        for s in samples
    ]

    ledger = list(
        AquacultureFishStockLedger.objects.filter(
            company_id=cid,
            pond_id=pond.id,
            production_cycle_id=cy,
            entry_date__gte=START,
            entry_date__lte=END,
        )
        .order_by("entry_date", "id")
        .values("id", "entry_date", "entry_kind", "weight_kg_delta", "fish_count_delta", "memo")
    )
    led_rows = []
    for r in ledger:
        row_obj = type("R", (), r)()
        led_rows.append(
            {
                **{k: (str(v) if isinstance(v, Decimal) else v) for k, v in r.items()},
                "is_book_reval": is_book_revaluation_ledger_row(row_obj),
            }
        )
    out["c02_ledger"] = led_rows

    # Null-cycle tilapia sales that might belong to C02 by date overlap with C02 window
    null_sales = [
        {
            "id": s["id"],
            "sale_date": s["sale_date"].isoformat() if hasattr(s["sale_date"], "isoformat") else s["sale_date"],
            "weight_kg": str(s["weight_kg"] or 0),
            "fish_species": s.get("fish_species"),
        }
        for s in sales
        if s.get("production_cycle_id") is None
        and (s.get("income_type") or "") == "fish_harvest_sale"
        and (s.get("fish_species") or "tilapia") == "tilapia"
    ]
    out["null_cycle_tilapia_sales"] = null_sales

    print(json.dumps(out, indent=2, default=str))


if __name__ == "__main__":
    main()
