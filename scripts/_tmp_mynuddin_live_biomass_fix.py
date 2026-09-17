"""Mynuddin: fix Ashari-2-like live biomass bugs (idempotent).

1) C01 tilapia (cy=2): add ≥5-fish standing sample from recent harvest mean (~1.96 kg)
   so the stale 1-fish standing rows no longer leave 16,596 heads out of combined biomass.
2) Bridge C01 tilapia book −38,654 kg → sample biomass.
3) cy=92 rui leftover fry: add standing size sample @ 0.9 kg (same pond Rui cycle #107 mean).
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction

from api.models import AquacultureBiomassSample, AquacultureFishStockLedger
from api.services.aquaculture_biomass_sample_service import (
    apply_aquaculture_biomass_sample_extrapolation,
)
from api.services.aquaculture_partial_harvest import (
    effective_biomass_kg_from_position_row,
    position_row_has_usable_standing_sample,
)
from api.services.aquaculture_stock_service import (
    compute_fish_stock_position_breakdown_rows,
    compute_fish_stock_position_rows,
)

CID = 2
POND = 2
D_SAMPLE = date(2026, 9, 9)  # latest C01 harvest day
D_RUI = date(2026, 8, 17)  # align with other polyculture samples that day
NOTE = "CORRECTED 2026-09-17: Mynuddin live biomass — multi-fish standing (not 1-fish)."
BOOK_MEMO = "CORRECTED 2026-09-17: Mynuddin C01 tilapia book bridge to sample biomass"
# Recent C01 harvest mean ≈ 1.96 kg (sales #274/#283/#285)
C01_SEINE_N = 10
C01_SEINE_KG = Decimal("19.6000")  # 1.96 kg/fish
# Sister Rui cycle (107) Aug sample avg 0.9 kg
RUI_SEINE_N = 10
RUI_SEINE_KG = Decimal("9.0000")


def _q4(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def _q6(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)


def _append_note(existing: str, note: str) -> str:
    if note in (existing or ""):
        return existing or ""
    return ((existing or "").strip() + (" | " if (existing or "").strip() else "") + note)[:5000]


def _save_standing(
    *,
    sample_date: date,
    species: str,
    cycle_id: int,
    seine_n: int,
    seine_kg: Decimal,
) -> tuple[AquacultureBiomassSample, str]:
    qs = AquacultureBiomassSample.objects.filter(
        company_id=CID,
        pond_id=POND,
        sample_date=sample_date,
        fish_species=species,
        production_cycle_id=cycle_id,
        source_fish_sale__isnull=True,
        source_bill_line__isnull=True,
        source_fish_pond_transfer__isnull=True,
        source_fish_pond_transfer_line__isnull=True,
        fish_species_other="",
    )
    s = qs.order_by("id").first()
    created = False
    if s is None:
        s = AquacultureBiomassSample(
            company_id=CID,
            pond_id=POND,
            sample_date=sample_date,
            fish_species=species,
            fish_species_other="",
            production_cycle_id=cycle_id,
        )
        created = True
    s.estimated_fish_count = seine_n
    s.estimated_total_weight_kg = seine_kg
    s.avg_weight_kg = _q6(seine_kg / Decimal(seine_n))
    s.notes = _append_note(s.notes or "", NOTE)
    apply_aquaculture_biomass_sample_extrapolation(s)
    s.save()
    return s, "created" if created else "updated"


@transaction.atomic
def apply() -> dict:
    out: dict = {"actions": []}

    # Annotate superseded 1-fish C01 standing rows (keep history; newer multi-fish wins)
    for sid in (223, 336):
        s = AquacultureBiomassSample.objects.filter(pk=sid, company_id=CID, pond_id=POND).first()
        if not s:
            out["actions"].append({"annotate_tiny": "missing", "id": sid})
            continue
        note = (
            "NOTE 2026-09-17: 1-fish seine — superseded by multi-fish standing for live biomass; "
            "ignored when a newer usable standing sample exists."
        )
        before = s.notes or ""
        s.notes = _append_note(before, note)
        if s.notes != before:
            s.save(update_fields=["notes", "updated_at"])
            out["actions"].append({"annotate_tiny": "noted", "id": sid})
        else:
            out["actions"].append({"annotate_tiny": "already_noted", "id": sid})

    # 1) C01 tilapia multi-fish standing
    s, status = _save_standing(
        sample_date=D_SAMPLE,
        species="tilapia",
        cycle_id=2,
        seine_n=C01_SEINE_N,
        seine_kg=C01_SEINE_KG,
    )
    out["actions"].append(
        {
            "c01_tilapia_sample": status,
            "id": s.id,
            "avg": str(s.avg_weight_kg),
            "extrap": str(s.extrapolated_biomass_kg),
            "ref_n": s.stock_reference_fish_count,
        }
    )

    # 2) cy=92 rui standing (leftover Rui fry bill on Kalibaush cycle)
    s2, status2 = _save_standing(
        sample_date=D_RUI,
        species="rui",
        cycle_id=92,
        seine_n=RUI_SEINE_N,
        seine_kg=RUI_SEINE_KG,
    )
    out["actions"].append(
        {
            "cy92_rui_sample": status2,
            "id": s2.id,
            "avg": str(s2.avg_weight_kg),
            "extrap": str(s2.extrapolated_biomass_kg),
            "ref_n": s2.stock_reference_fish_count,
        }
    )

    # 3) Bridge C01 book → sample biomass
    brk = compute_fish_stock_position_breakdown_rows(CID, pond_id=POND)
    c01 = next(
        (
            b
            for b in brk
            if b.get("production_cycle_id") == 2 and b.get("fish_species") == "tilapia"
        ),
        None,
    )
    if c01 is None:
        out["actions"].append({"c01_book_bridge": "bucket_missing"})
    else:
        book = Decimal(str(c01.get("implied_net_weight_kg") or 0))
        eff = effective_biomass_kg_from_position_row(c01)
        heads = int(c01.get("implied_net_fish_count") or 0)
        already = AquacultureFishStockLedger.objects.filter(
            company_id=CID, pond_id=POND, memo__startswith=BOOK_MEMO
        ).exists()
        if already:
            out["actions"].append(
                {"c01_book_bridge": "already_done", "book": str(book), "eff": str(eff), "heads": heads}
            )
        elif heads > 0 and eff > 0:
            delta = _q4(eff - book)
            if abs(delta) >= Decimal("0.01"):
                AquacultureFishStockLedger.objects.create(
                    company_id=CID,
                    pond_id=POND,
                    production_cycle_id=2,
                    entry_date=D_SAMPLE,
                    entry_kind="adjustment",
                    loss_reason="",
                    fish_species="tilapia",
                    fish_count_delta=0,
                    weight_kg_delta=delta,
                    book_value=Decimal("0"),
                    post_to_books=False,
                    memo=f"{BOOK_MEMO} ({book} → {eff}).",
                )
                out["actions"].append(
                    {
                        "c01_book_bridge": "created",
                        "delta_kg": str(delta),
                        "from_book": str(book),
                        "to_eff": str(eff),
                        "heads": heads,
                    }
                )
            else:
                out["actions"].append({"c01_book_bridge": "already_aligned", "book": str(book), "eff": str(eff)})
        else:
            out["actions"].append(
                {"c01_book_bridge": "skipped", "book": str(book), "eff": str(eff), "heads": heads}
            )

    # Verify
    as_of = date.today()
    pond = compute_fish_stock_position_rows(CID, pond_id=POND)[0]
    parts = []
    omitted = []
    tot = Decimal("0")
    for b in compute_fish_stock_position_breakdown_rows(CID, pond_id=POND):
        n = int(b.get("implied_net_fish_count") or 0)
        e = effective_biomass_kg_from_position_row(b)
        w = Decimal(str(b.get("implied_net_weight_kg") or 0))
        if not (n or w or e):
            continue
        usable = position_row_has_usable_standing_sample(b, as_of)
        tot += Decimal(str(e or 0))
        row = {
            "cy": b.get("production_cycle_id"),
            "species": b.get("fish_species"),
            "heads": n,
            "book": str(w),
            "eff": str(e),
            "usable": usable,
            "sample": str(b.get("latest_sample_date") or ""),
            "avg": str(b.get("latest_sample_avg_weight_kg") or ""),
        }
        parts.append(row)
        if n > 0 and not usable:
            omitted.append(row)

    out["verify"] = {
        "pond_book": str(pond.get("implied_net_weight_kg")),
        "pond_eff": str(effective_biomass_kg_from_position_row(pond)),
        "pond_combined": str(pond.get("species_combined_biomass_kg")),
        "sum_species_eff": str(tot),
        "omitted_live_buckets": omitted,
        "breakdown": parts,
    }
    return out


def main() -> None:
    print(json.dumps(apply(), indent=2, default=str))


if __name__ == "__main__":
    main()
