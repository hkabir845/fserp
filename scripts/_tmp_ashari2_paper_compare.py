"""Compare Ashari-2 paper sampling (11/08 & 17/09/2026) vs DB."""
from __future__ import annotations

import json
import os
import sys
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
os.environ.setdefault("FSERP_USE_SQLITE", "0")

import django
from django.apps import apps

if not apps.ready:
    django.setup()

from api.models import (  # noqa: E402
    AquacultureBiomassSample,
    AquacultureFishSale,
    AquaculturePond,
    AquacultureProductionCycle,
)
from api.services.aquaculture_data_bank_service import pond_live_data_after_date  # noqa: E402
from api.services.aquaculture_partial_harvest import (  # noqa: E402
    effective_biomass_kg_from_position_row,
)
from api.services.aquaculture_stock_service import (  # noqa: E402
    compute_fish_stock_position_breakdown_rows,
    compute_fish_stock_position_rows,
)

CID = 2
D1 = date(2026, 8, 11)
D2 = date(2026, 9, 17)
PAPER = {
    "2026-08-11": {
        "tilapia_a": Decimal("41500"),
        "tilapia_b": Decimal("27860"),
        "rui": Decimal("8694"),
        "other_other": Decimal("6743"),
        "other": Decimal("946"),
        "carp": Decimal("7386"),
        "silver": Decimal("3808"),
        "grasscarp": Decimal("900"),
        "kalibaush": Decimal("561"),
        "total": Decimal("98398"),
    },
    "2026-09-17": {
        "tilapia_a": Decimal("25056"),
        "tilapia_b": Decimal("34289"),
        "rui": Decimal("14128"),
        "other_other": Decimal("7706"),
        "other": Decimal("1081"),
        "carp": Decimal("9848"),
        "silver": Decimal("4188"),
        "grasscarp": Decimal("1080"),
        "kalibaush": Decimal("686"),
        "total": Decimal("98062"),
    },
}
PAPER_HARVEST = Decimal("20163.8")
OUT = ROOT / "scripts" / "_tmp_ashari2_paper_compare.json"


def D(v) -> Decimal:
    if v is None or v == "":
        return Decimal("0")
    return Decimal(str(v))


def q2(v: Decimal) -> str:
    return str(v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def main() -> None:
    ponds = list(
        AquaculturePond.objects.filter(company_id=CID, name__icontains="ashari")
        .order_by("id")
        .values("id", "name", "is_active")
    )
    print("ponds", ponds)
    pond = (
        AquaculturePond.objects.filter(company_id=CID, name__icontains="ashari")
        .filter(name__icontains="2")
        .first()
    )
    if not pond:
        raise SystemExit("Ashari-2 pond not found")
    pid = pond.id
    print(f"using pond id={pid} name={pond.name!r}")

    cycles = list(
        AquacultureProductionCycle.objects.filter(company_id=CID, pond_id=pid)
        .order_by("id")
        .values("id", "code", "name", "is_active", "start_date", "end_date")
    )
    print("cycles", cycles)

    samples = list(
        AquacultureBiomassSample.objects.filter(company_id=CID, pond_id=pid)
        .filter(sample_date__in=[D1, D2])
        .select_related("production_cycle")
        .order_by("sample_date", "id")
    )
    # also nearby dates for context
    nearby = list(
        AquacultureBiomassSample.objects.filter(company_id=CID, pond_id=pid)
        .filter(sample_date__gte=date(2026, 8, 1), sample_date__lte=date(2026, 9, 30))
        .select_related("production_cycle")
        .order_by("sample_date", "id")
    )

    def samp_row(s: AquacultureBiomassSample) -> dict:
        return {
            "id": s.id,
            "date": str(s.sample_date),
            "species": s.fish_species,
            "species_other": s.fish_species_other or "",
            "cycle_id": s.production_cycle_id,
            "cycle_code": s.production_cycle.code if s.production_cycle_id else None,
            "seine_n": s.estimated_fish_count,
            "seine_kg": q2(D(s.estimated_total_weight_kg)),
            "avg_kg": str(D(s.avg_weight_kg)),
            "ref_heads": s.stock_reference_fish_count,
            "ref_kg": q2(D(s.stock_reference_net_weight_kg)),
            "extrap_kg": q2(D(s.extrapolated_biomass_kg)),
            "gain_kg": q2(D(s.biomass_gain_kg)),
            "notes": (s.notes or "")[:200],
        }

    by_date: dict[str, list] = {}
    for s in samples:
        by_date.setdefault(str(s.sample_date), []).append(samp_row(s))

    print("\n=== SAMPLES ON PAPER DATES ===")
    for d in (str(D1), str(D2)):
        rows = by_date.get(d, [])
        tot = sum((D(r["extrap_kg"]) for r in rows), Decimal("0"))
        print(f"\n{d}: {len(rows)} rows, sum(extrap)={q2(tot)} paper={PAPER[d]['total']}")
        for r in rows:
            print(
                f"  #{r['id']} {r['species']}/{r['species_other'] or '-'} "
                f"cy={r['cycle_code']} extrap={r['extrap_kg']} "
                f"seine={r['seine_n']}x{r['seine_kg']} avg={r['avg_kg']} "
                f"ref_n={r['ref_heads']}"
            )

    print("\n=== ALL SAMPLES Aug-Sep 2026 ===")
    for s in nearby:
        r = samp_row(s)
        print(
            f"  {r['date']} #{r['id']} {r['species']}/{r['species_other'] or '-'} "
            f"cy={r['cycle_code']} extrap={r['extrap_kg']}"
        )

    # Harvest between exclusive after D1 through D2 inclusive (paper: in between)
    # Paper: harvest between 11/08 and 17/09 = 20163.8
    sales = list(
        AquacultureFishSale.objects.filter(
            company_id=CID,
            pond_id=pid,
            sale_date__gt=D1,
            sale_date__lte=D2,
        ).order_by("sale_date", "id")
    )
    # also include sales ON D1 after sampling? try both windows
    sales_incl_d1 = list(
        AquacultureFishSale.objects.filter(
            company_id=CID,
            pond_id=pid,
            sale_date__gte=D1,
            sale_date__lt=D2,
        ).order_by("sale_date", "id")
    )
    sales_both_incl = list(
        AquacultureFishSale.objects.filter(
            company_id=CID,
            pond_id=pid,
            sale_date__gte=D1,
            sale_date__lte=D2,
        ).order_by("sale_date", "id")
    )

    def sales_summary(rows):
        by_sp: dict[str, dict] = {}
        tot_kg = Decimal("0")
        tot_n = 0
        day_rows = []
        for s in rows:
            sp = s.fish_species
            if sp == "other" and s.fish_species_other:
                sp = f"other:{s.fish_species_other}"
            slot = by_sp.setdefault(sp, {"kg": Decimal("0"), "n": 0, "rows": 0})
            kg = D(s.weight_kg)
            n = int(s.fish_count or 0)
            slot["kg"] += kg
            slot["n"] += n
            slot["rows"] += 1
            tot_kg += kg
            tot_n += n
            day_rows.append(
                {
                    "id": s.id,
                    "date": str(s.sale_date),
                    "species": s.fish_species,
                    "other": s.fish_species_other or "",
                    "cycle_id": s.production_cycle_id,
                    "kg": q2(kg),
                    "n": n,
                }
            )
        return {
            "total_kg": q2(tot_kg),
            "total_n": tot_n,
            "by_species": {k: {"kg": q2(v["kg"]), "n": v["n"], "rows": v["rows"]} for k, v in by_sp.items()},
            "events": day_rows,
            "delta_vs_paper": q2(tot_kg - PAPER_HARVEST),
        }

    harvest_windows = {
        "gt_D1_lte_D2": sales_summary(sales),
        "gte_D1_lt_D2": sales_summary(sales_incl_d1),
        "gte_D1_lte_D2": sales_summary(sales_both_incl),
    }
    print("\n=== HARVEST WINDOWS vs paper 20163.8 ===")
    for k, v in harvest_windows.items():
        print(f"  {k}: kg={v['total_kg']} delta={v['delta_vs_paper']} events={len(v['events'])}")
        for sp, info in sorted(v["by_species"].items()):
            print(f"    {sp}: {info['kg']} kg / {info['n']} heads ({info['rows']} rows)")

    # Position as-of each sample date
    print("\n=== POSITION AS-OF DATES ===")
    asof = {}
    for d in (D1, D2):
        pond_row = compute_fish_stock_position_rows(CID, pond_id=pid, as_of_date=d)[0]
        brk = compute_fish_stock_position_breakdown_rows(CID, pond_id=pid, as_of_date=d)
        eff = effective_biomass_kg_from_position_row(pond_row)
        species_rows = []
        for b in brk:
            n = int(b["implied_net_fish_count"] or 0)
            w = D(b["implied_net_weight_kg"])
            e = effective_biomass_kg_from_position_row(b)
            if not (n or w or e):
                continue
            species_rows.append(
                {
                    "cycle_id": b.get("production_cycle_id"),
                    "species": b.get("fish_species"),
                    "heads": n,
                    "book_kg": q2(w),
                    "eff_kg": q2(e),
                    "sample_date": str(b.get("latest_sample_date") or ""),
                    "sample_avg": str(b.get("latest_sample_avg_weight_kg") or ""),
                }
            )
        asof[str(d)] = {
            "book_kg": q2(D(pond_row["implied_net_weight_kg"])),
            "heads": int(pond_row["implied_net_fish_count"] or 0),
            "eff_kg": q2(eff),
            "breakdown": species_rows,
        }
        print(
            f"  {d}: book={asof[str(d)]['book_kg']} eff={asof[str(d)]['eff_kg']} "
            f"heads={asof[str(d)]['heads']}"
        )
        for r in species_rows:
            print(
                f"    cy={r['cycle_id']} {r['species']}: heads={r['heads']} "
                f"book={r['book_kg']} eff={r['eff_kg']} sample={r['sample_date']} avg={r['sample_avg']}"
            )

    after = pond_live_data_after_date(CID, pid)
    live = compute_fish_stock_position_rows(CID, pond_id=pid, entries_after_date=after)[0]
    live_eff = effective_biomass_kg_from_position_row(live)

    # Compare sample extrap totals to paper
    comparisons = {}
    for d, paper in PAPER.items():
        rows = by_date.get(d, [])
        db_total = sum((D(r["extrap_kg"]) for r in rows), Decimal("0"))
        by_sp: dict[str, Decimal] = {}
        for r in rows:
            key = r["species"]
            if r["species_other"]:
                key = f"{r['species']}:{r['species_other']}"
            # keep duplicate tilapia rows separate by cycle
            key = f"{key}|cy={r['cycle_code']}|id={r['id']}"
            by_sp[key] = D(r["extrap_kg"])
        comparisons[d] = {
            "paper_total": str(paper["total"]),
            "db_extrap_sum": q2(db_total),
            "delta": q2(db_total - paper["total"]),
            "db_rows": rows,
            "row_count": len(rows),
        }

    out = {
        "pond": {"id": pid, "name": pond.name},
        "cycles": cycles,
        "paper": {k: {kk: str(vv) for kk, vv in v.items()} for k, v in PAPER.items()},
        "paper_harvest_kg": str(PAPER_HARVEST),
        "paper_remaining_after_harvest": str(Decimal("98398") - PAPER_HARVEST),
        "paper_biomass_gain": str(Decimal("98062") - (Decimal("98398") - PAPER_HARVEST)),
        "samples_on_dates": by_date,
        "nearby_samples": [samp_row(s) for s in nearby],
        "harvest_windows": harvest_windows,
        "as_of_positions": asof,
        "live_after_lock": str(after),
        "live_eff_kg": q2(live_eff),
        "live_book_kg": q2(D(live["implied_net_weight_kg"])),
        "comparisons": comparisons,
    }
    OUT.write_text(json.dumps(out, indent=2, default=str), encoding="utf-8")
    print(f"\nWrote {OUT}")


main()
