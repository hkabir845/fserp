"""Farm-wide scan for Ashari-2-like biomass bugs.

Flags:
- duplicate standing samples (same pond/date/species/cycle/seine)
- tiny tilapia seines (1–4 fish) that must not drive pond mass
- positive heads with no usable standing sample
- positive heads with negative book kg (growth never booked / bad fallthrough)
- single-fish huge extrapolation still stored
- pond combined biomass omitting live species buckets
"""
from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
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

from api.models import AquacultureBiomassSample, AquaculturePond  # noqa: E402
from api.services.aquaculture_partial_harvest import (  # noqa: E402
    _MIN_SEINE_HEADS_FOR_POND_MASS,
    _MAX_TILAPIA_MEAN_KG,
    biomass_sample_fields_ok_for_pond_mass,
    effective_biomass_kg_from_position_row,
    position_row_has_usable_standing_sample,
    sample_mean_weight_kg_from_fields,
)
from api.services.aquaculture_stock_service import (  # noqa: E402
    compute_fish_stock_position_breakdown_rows,
    compute_fish_stock_position_rows,
)

CID = 2
AS_OF = date.today()
OUT = ROOT / "scripts" / "_tmp_similar_biomass_bugs_scan.json"
# Ashari-2 just fixed — still report but mark resolved context
ASHARI2_ID = 14


def D(v) -> Decimal:
    if v is None or v == "":
        return Decimal("0")
    return Decimal(str(v))


def q2(v: Decimal) -> str:
    return str(v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def is_standing(s: AquacultureBiomassSample) -> bool:
    return (
        s.source_fish_sale_id is None
        and s.source_bill_line_id is None
        and s.source_fish_pond_transfer_id is None
        and s.source_fish_pond_transfer_line_id is None
    )


def main() -> dict:
    ponds = {
        p.id: p.name
        for p in AquaculturePond.objects.filter(company_id=CID, is_active=True).order_by("id")
    }
    samples = list(
        AquacultureBiomassSample.objects.filter(company_id=CID, pond_id__in=ponds.keys())
        .order_by("pond_id", "sample_date", "id")
    )

    issues: list[dict] = []

    # --- Duplicate standing samples ---
    groups: dict[tuple, list] = defaultdict(list)
    for s in samples:
        if not is_standing(s):
            continue
        key = (
            s.pond_id,
            str(s.sample_date),
            s.fish_species,
            s.fish_species_other or "",
            s.production_cycle_id,
            int(s.estimated_fish_count or 0),
            str(D(s.estimated_total_weight_kg)),
        )
        groups[key].append(s.id)
    for key, ids in groups.items():
        if len(ids) < 2:
            continue
        pid = key[0]
        issues.append(
            {
                "code": "duplicate_standing_sample",
                "severity": "error",
                "pond_id": pid,
                "pond_name": ponds.get(pid),
                "sample_ids": ids,
                "date": key[1],
                "species": key[2],
                "cycle_id": key[4],
                "seine": f"{key[5]} x {key[6]} kg",
                "detail": f"{len(ids)} identical standing rows",
            }
        )

    # --- Dangerous / unusable tilapia seines still on file ---
    for s in samples:
        if s.fish_species != "tilapia":
            continue
        n = int(s.estimated_fish_count or 0)
        avg = sample_mean_weight_kg_from_fields(
            fish_count=s.estimated_fish_count,
            total_weight_kg=s.estimated_total_weight_kg,
            avg_weight_kg=s.avg_weight_kg,
        )
        extrap = D(s.extrapolated_biomass_kg)
        if 0 < n < _MIN_SEINE_HEADS_FOR_POND_MASS and is_standing(s):
            issues.append(
                {
                    "code": "tilapia_tiny_seine_standing",
                    "severity": "warning" if extrap < 5000 else "error",
                    "pond_id": s.pond_id,
                    "pond_name": ponds.get(s.pond_id),
                    "sample_id": s.id,
                    "date": str(s.sample_date),
                    "cycle_id": s.production_cycle_id,
                    "seine_n": n,
                    "avg_kg": str(avg) if avg is not None else None,
                    "extrap_kg": q2(extrap),
                    "detail": "1–4 fish tilapia standing sample (ignored for pond mass if latest)",
                }
            )
        if (
            is_standing(s)
            and avg is not None
            and avg > _MAX_TILAPIA_MEAN_KG
        ):
            issues.append(
                {
                    "code": "tilapia_impossible_mean",
                    "severity": "error",
                    "pond_id": s.pond_id,
                    "pond_name": ponds.get(s.pond_id),
                    "sample_id": s.id,
                    "date": str(s.sample_date),
                    "avg_kg": str(avg),
                    "extrap_kg": q2(extrap),
                    "detail": f"tilapia mean > {_MAX_TILAPIA_MEAN_KG} kg",
                }
            )
        if n == 1 and extrap >= 10000 and is_standing(s):
            issues.append(
                {
                    "code": "single_fish_huge_extrap",
                    "severity": "error",
                    "pond_id": s.pond_id,
                    "pond_name": ponds.get(s.pond_id),
                    "sample_id": s.id,
                    "date": str(s.sample_date),
                    "avg_kg": str(avg) if avg is not None else None,
                    "extrap_kg": q2(extrap),
                    "detail": "1-fish standing with ≥10 t extrapolated biomass",
                }
            )

    # --- Live position buckets ---
    brk = compute_fish_stock_position_breakdown_rows(CID, include_inactive_ponds=False)
    pond_rows = {r["pond_id"]: r for r in compute_fish_stock_position_rows(CID, include_inactive_ponds=False)}

    omitted_by_pond: dict[int, list] = defaultdict(list)
    for b in brk:
        pid = int(b["pond_id"])
        heads = int(b.get("implied_net_fish_count") or 0)
        book = D(b.get("implied_net_weight_kg"))
        eff = effective_biomass_kg_from_position_row(b)
        usable = position_row_has_usable_standing_sample(b, AS_OF)
        sp = b.get("fish_species")
        cy = b.get("production_cycle_id")

        if heads > 0 and book < 0:
            issues.append(
                {
                    "code": "negative_book_with_heads",
                    "severity": "error" if not usable else "warning",
                    "pond_id": pid,
                    "pond_name": ponds.get(pid),
                    "cycle_id": cy,
                    "species": sp,
                    "heads": heads,
                    "book_kg": q2(book),
                    "eff_kg": q2(eff),
                    "sample_date": str(b.get("latest_sample_date") or ""),
                    "sample_avg": str(b.get("latest_sample_avg_weight_kg") or ""),
                    "usable_sample": usable,
                    "detail": "heads > 0 but book kg negative"
                    + ("" if usable else " — no usable sample, eff falls back to book"),
                }
            )

        if heads > 0 and not usable:
            issues.append(
                {
                    "code": "heads_without_usable_sample",
                    "severity": "error" if book <= 0 or eff <= 0 else "warning",
                    "pond_id": pid,
                    "pond_name": ponds.get(pid),
                    "cycle_id": cy,
                    "species": sp,
                    "heads": heads,
                    "book_kg": q2(book),
                    "eff_kg": q2(eff),
                    "sample_date": str(b.get("latest_sample_date") or ""),
                    "sample_avg": str(b.get("latest_sample_avg_weight_kg") or ""),
                    "detail": "live heads excluded from species_combined (no usable standing sample)",
                }
            )
            omitted_by_pond[pid].append(
                {
                    "cycle_id": cy,
                    "species": sp,
                    "heads": heads,
                    "book_kg": q2(book),
                    "eff_kg": q2(eff),
                }
            )

    # Pond-level: combined vs raw book when omitted species exist
    for pid, omitted in omitted_by_pond.items():
        row = pond_rows.get(pid)
        if not row:
            continue
        combined = D(row.get("species_combined_biomass_kg") or 0)
        book = D(row.get("implied_net_weight_kg"))
        eff = effective_biomass_kg_from_position_row(row)
        issues.append(
            {
                "code": "pond_omits_live_species",
                "severity": "error",
                "pond_id": pid,
                "pond_name": ponds.get(pid),
                "omitted_buckets": omitted,
                "pond_book_kg": q2(book),
                "pond_combined_kg": q2(combined) if combined else q2(eff),
                "detail": f"{len(omitted)} live species bucket(s) omitted from combined biomass",
            }
        )

    # Summaries
    by_code: dict[str, int] = defaultdict(int)
    by_pond: dict[str, int] = defaultdict(int)
    for i in issues:
        by_code[i["code"]] += 1
        by_pond[f"{i.get('pond_name')}#{i.get('pond_id')}"] += 1

    # Focus list excluding pure warnings on Ashari-2 post-fix noise if any
    open_errors = [
        i
        for i in issues
        if i.get("severity") == "error" and int(i.get("pond_id") or 0) != ASHARI2_ID
    ]
    ashari2_left = [i for i in issues if int(i.get("pond_id") or 0) == ASHARI2_ID]

    out = {
        "as_of": str(AS_OF),
        "pond_count": len(ponds),
        "issue_count": len(issues),
        "by_code": dict(sorted(by_code.items(), key=lambda x: (-x[1], x[0]))),
        "by_pond": dict(sorted(by_pond.items(), key=lambda x: (-x[1], x[0]))),
        "open_errors_excluding_ashari2": open_errors,
        "ashari2_remaining": ashari2_left,
        "all_issues": issues,
    }
    OUT.write_text(json.dumps(out, indent=2, default=str), encoding="utf-8")

    print(f"Wrote {OUT}")
    print(f"ponds={len(ponds)} issues={len(issues)}")
    print("by_code:", json.dumps(by_code, indent=2))
    print(f"\nOPEN ERRORS (excl Ashari-2): {len(open_errors)}")
    for i in open_errors:
        print(
            f"  [{i['code']}] {i.get('pond_name')} cy={i.get('cycle_id')} "
            f"{i.get('species') or ''} {i.get('detail')}"
            + (f" sample=#{i.get('sample_id')}" if i.get("sample_id") else "")
            + (f" ids={i.get('sample_ids')}" if i.get("sample_ids") else "")
        )
    print(f"\nAshari-2 remaining flags: {len(ashari2_left)}")
    for i in ashari2_left:
        if i.get("severity") == "error":
            print(f"  [{i['code']}] {i.get('detail')}")
    return out


main()
