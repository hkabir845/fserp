"""Match biomass samples to pond + cycle + batch; flag mismatches."""
from __future__ import annotations

import json
from pathlib import Path

from api.models import AquacultureBiomassSample, AquaculturePond, AquacultureProductionCycle

CID = 2
OUT = Path(__file__).resolve().parents[1] / "scripts" / "_tmp_sample_pond_cycle_match.json"


def _kind(s: AquacultureBiomassSample) -> str:
    if s.source_bill_line_id:
        return "lot_purchase"
    if s.source_fish_pond_transfer_line_id or s.source_fish_pond_transfer_id:
        return "lot_transfer"
    if s.source_fish_sale_id:
        return "harvest_linked"
    return "standing"


def main() -> None:
    ponds = {p.id: p for p in AquaculturePond.objects.filter(company_id=CID)}
    cycles = {
        c.id: c
        for c in AquacultureProductionCycle.objects.filter(company_id=CID).select_related("pond")
    }

    mismatches = []
    by_pond: dict[str, list] = {}

    for s in (
        AquacultureBiomassSample.objects.filter(company_id=CID)
        .select_related("pond", "production_cycle")
        .order_by("pond_id", "sample_date", "id")
    ):
        pond = ponds.get(s.pond_id)
        cy = cycles.get(s.production_cycle_id) if s.production_cycle_id else None
        flags = []
        if s.production_cycle_id is None:
            flags.append("missing_cycle")
        elif cy is None:
            flags.append("cycle_not_found")
        else:
            if cy.pond_id != s.pond_id:
                flags.append(
                    f"cycle_pond_mismatch:sample_pond={s.pond_id} cycle_pond={cy.pond_id}"
                )
            # batch/species on cycle if set
            cy_sp = (getattr(cy, "fish_species", None) or "").strip()
            if cy_sp and cy_sp not in ("", "mixed", "polyculture", "other"):
                if (s.fish_species or "") != cy_sp and s.fish_species != "other":
                    # soft: polyculture ponds often sample other species on same cycle
                    flags.append(f"species_vs_cycle_primary:{s.fish_species}!={cy_sp}")

        # Suspicious: 1-fish sample used as size for large stock
        extrap = s.extrapolated_biomass_kg
        if (s.estimated_fish_count or 0) == 1 and extrap is not None and float(extrap) > 5000:
            flags.append("single_fish_huge_extrapolation")

        cy_start = getattr(cy, "start_date", None) if cy else None
        row = {
            "sample_id": s.id,
            "date": s.sample_date.isoformat(),
            "pond_id": s.pond_id,
            "pond_name": pond.name if pond else "?",
            "cycle_id": s.production_cycle_id,
            "cycle_code": cy.code if cy else None,
            "cycle_name": cy.name if cy else None,
            "cycle_start": cy_start.isoformat() if cy_start else None,
            "cycle_pond_id": cy.pond_id if cy else None,
            "species": s.fish_species,
            "kind": _kind(s),
            "seine_n": s.estimated_fish_count,
            "seine_kg": str(s.estimated_total_weight_kg) if s.estimated_total_weight_kg is not None else None,
            "avg_kg": str(s.avg_weight_kg) if s.avg_weight_kg is not None else None,
            "extrap_kg": str(extrap) if extrap is not None else None,
            "flags": flags,
        }
        key = pond.name if pond else f"pond#{s.pond_id}"
        by_pond.setdefault(key, []).append(row)
        if flags:
            mismatches.append(row)

    # Focus print: Ashari-2 + mismatch summary
    print("=== SAMPLE <-> POND / CYCLE / BATCH MATCH ===\n")
    for pname in sorted(by_pond.keys()):
        rows = by_pond[pname]
        flagged = [r for r in rows if r["flags"]]
        print(f"{pname}: {len(rows)} samples, {len(flagged)} flagged")

    print("\n=== ASHARI-2 detail (tilapia + recent) ===")
    ashari_key = next((k for k in by_pond if "Ashari" in k and "2" in k), None)
    if not ashari_key:
        ashari_key = next((k for k in by_pond if "Ashari" in k), None)
    if ashari_key:
        print(f"Pond key: {ashari_key}")
        for r in by_pond[ashari_key]:
            if r["species"] != "tilapia" and r["date"] < "2026-09-01":
                continue
            flag_s = f" !! {', '.join(r['flags'])}" if r["flags"] else ""
            print(
                f"  #{r['sample_id']} {r['date']} cy={r['cycle_id']}/{r['cycle_code']} "
                f"sp={r['species']} kind={r['kind']} "
                f"seine={r['seine_n']}/{r['seine_kg']} avg={r['avg_kg']}{flag_s}"
            )

    print(f"\n=== ALL FLAGGED ({len(mismatches)}) ===")
    for r in mismatches:
        print(
            f"  #{r['sample_id']} {r['pond_name']} {r['date']} "
            f"cy={r['cycle_id']}/{r['cycle_code']} sp={r['species']} "
            f"| {', '.join(r['flags'])}"
        )

    payload = {
        "pond_counts": {k: len(v) for k, v in by_pond.items()},
        "flagged_count": len(mismatches),
        "flagged": mismatches,
        "ashari2": by_pond.get(ashari_key, []) if ashari_key else [],
    }
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {OUT}")


if __name__ == "__main__":
    main()
