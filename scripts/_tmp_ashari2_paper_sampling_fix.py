"""Ashari-2: sync vertical biomass samples to paper (11 Aug / 17 Sep 2026).

Fixes:
- Delete duplicate standing sample #349 (keep #350)
- Add missing 11 Aug polyculture standing samples (heads × paper avg)
- C01 leftover tilapia: multi-fish standing samples (not 1-fish) @ 1.3 (Aug) / 1.6 (Sep)
- Move Sep samples to 2026-09-17; fix Rui 1.2 → 1.3
- Bridge C01 tilapia negative book kg → sample biomass

Idempotent. Does not restore the deleted 1-fish #394 row — recreates a valid ≥5-fish seine.
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
from api.services.aquaculture_partial_harvest import effective_biomass_kg_from_position_row
from api.services.aquaculture_stock_service import (
    compute_fish_stock_position_breakdown_rows,
    compute_fish_stock_position_rows,
)

CID = 2
POND = 14
D_AUG = date(2026, 8, 11)
D_SEP = date(2026, 9, 17)
NOTE = "CORRECTED 2026-09-17: Ashari-2 paper vertical sampling (11 Aug / 17 Sep)."
BOOK_MEMO = "CORRECTED 2026-09-17: Ashari-2 C01 tilapia book bridge to sample biomass"


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
    fish_species_other: str = "",
) -> tuple[AquacultureBiomassSample, str]:
    """Create or update a standing sample; re-run extrapolation."""
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
    )
    if fish_species_other:
        qs = qs.filter(fish_species_other=fish_species_other)
    else:
        qs = qs.filter(fish_species_other="")

    s = qs.order_by("id").first()
    created = False
    if s is None:
        s = AquacultureBiomassSample(
            company_id=CID,
            pond_id=POND,
            sample_date=sample_date,
            fish_species=species,
            fish_species_other=fish_species_other,
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

    # 1) Drop duplicate #349 (identical seine to #350)
    dup = AquacultureBiomassSample.objects.filter(pk=349, company_id=CID, pond_id=POND).first()
    if dup is not None:
        dup.delete()
        out["actions"].append({"delete_duplicate_349": "deleted"})
    else:
        out["actions"].append({"delete_duplicate_349": "already_gone"})

    # 2) Aug 11 paper standing samples (multi-fish; tilapia ≥5)
    #    Avgs from paper kg ÷ current heads (stable — no harvest of these buckets since).
    aug_specs = [
        # species, cycle, seine_n, seine_kg, other
        ("tilapia", 22, 10, Decimal("13.0000"), ""),  # 1.3 → ~27,860
        ("rui", 22, 10, Decimal("8.0000"), ""),  # 0.8 → ~8,694
        ("other", 114, 10, Decimal("7.0000"), ""),  # Mirka/other 0.7 → ~6,743
        ("other", 22, 10, Decimal("7.0000"), ""),  # 0.7 → ~946
        ("common_carp", 22, 10, Decimal("15.0000"), ""),  # 1.5 → 7,386
        ("silver_carp", 22, 10, Decimal("20.0000"), ""),  # 2.0 → 3,808
        ("grass_carp", 22, 10, Decimal("25.0000"), ""),  # 2.5 → 900
        ("kalibaush", 22, 10, Decimal("17.9808"), ""),  # ~1.798 → 561
    ]
    for sp, cy, n, kg, other in aug_specs:
        s, status = _save_standing(
            sample_date=D_AUG,
            species=sp,
            cycle_id=cy,
            seine_n=n,
            seine_kg=kg,
            fish_species_other=other,
        )
        out["actions"].append(
            {
                "aug_sample": status,
                "id": s.id,
                "species": sp,
                "cycle": cy,
                "extrap": str(s.extrapolated_biomass_kg),
                "avg": str(s.avg_weight_kg),
                "ref_n": s.stock_reference_fish_count,
            }
        )

    # Keep C03 Aug tilapia standing (#350) — already matches paper 41,500
    c03 = AquacultureBiomassSample.objects.filter(
        company_id=CID, pond_id=POND, pk=350
    ).first() or AquacultureBiomassSample.objects.filter(
        company_id=CID,
        pond_id=POND,
        sample_date=D_AUG,
        fish_species="tilapia",
        production_cycle_id=125,
        source_fish_sale__isnull=True,
    ).order_by("id").first()
    if c03:
        c03.notes = _append_note(c03.notes or "", NOTE)
        c03.save(update_fields=["notes", "updated_at"])
        out["actions"].append({"aug_c03_tilapia": "kept", "id": c03.id, "extrap": str(c03.extrapolated_biomass_kg)})

    # 3) Retarget existing Sep samples → 17 Sep; fix Rui 1.2 → 1.3
    sep_retarget_ids = [391, 395, 396, 397, 398, 399, 400, 401, 402]
    for sid in sep_retarget_ids:
        s = AquacultureBiomassSample.objects.filter(pk=sid, company_id=CID, pond_id=POND).first()
        if not s:
            out["actions"].append({"sep_retarget": "missing", "id": sid})
            continue
        s.sample_date = D_SEP
        if sid == 395 and s.fish_species == "rui":
            # paper 14,128 = heads × 1.3 (was 1.2)
            s.estimated_fish_count = 10
            s.estimated_total_weight_kg = Decimal("13.0000")
            s.avg_weight_kg = _q6(Decimal("1.3"))
        s.notes = _append_note(s.notes or "", NOTE)
        apply_aquaculture_biomass_sample_extrapolation(s)
        s.save()
        out["actions"].append(
            {
                "sep_retarget": "updated",
                "id": s.id,
                "species": s.fish_species,
                "extrap": str(s.extrapolated_biomass_kg),
                "avg": str(s.avg_weight_kg),
            }
        )

    # 4) Sep 17 C01 tilapia standing — paper 34,289 = 21,431 × 1.6, but ≥5-fish seine
    s, status = _save_standing(
        sample_date=D_SEP,
        species="tilapia",
        cycle_id=22,
        seine_n=10,
        seine_kg=Decimal("16.0000"),
    )
    out["actions"].append(
        {
            "sep_c01_tilapia": status,
            "id": s.id,
            "extrap": str(s.extrapolated_biomass_kg),
            "avg": str(s.avg_weight_kg),
            "ref_n": s.stock_reference_fish_count,
        }
    )

    # 5) Bridge C01 tilapia book kg → sample biomass (fixes −78 t book)
    brk = compute_fish_stock_position_breakdown_rows(CID, pond_id=POND)
    c01 = next(
        (
            b
            for b in brk
            if b.get("production_cycle_id") == 22 and b.get("fish_species") == "tilapia"
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
                    production_cycle_id=22,
                    entry_date=D_SEP,
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

    # 6) Verify
    pond = compute_fish_stock_position_rows(CID, pond_id=POND)[0]
    parts = []
    tot_eff = Decimal("0")
    for b in compute_fish_stock_position_breakdown_rows(CID, pond_id=POND):
        n = int(b.get("implied_net_fish_count") or 0)
        e = effective_biomass_kg_from_position_row(b)
        w = Decimal(str(b.get("implied_net_weight_kg") or 0))
        if not (n or w or e):
            continue
        tot_eff += Decimal(str(e or 0))
        parts.append(
            {
                "cy": b.get("production_cycle_id"),
                "species": b.get("fish_species"),
                "heads": n,
                "book": str(w),
                "eff": str(e),
                "sample": str(b.get("latest_sample_date") or ""),
                "avg": str(b.get("latest_sample_avg_weight_kg") or ""),
            }
        )
    out["verify"] = {
        "pond_book": str(pond.get("implied_net_weight_kg")),
        "pond_eff": str(effective_biomass_kg_from_position_row(pond)),
        "sum_species_eff": str(tot_eff),
        "paper_sep_total": "98062",
        "paper_aug_total": "98398",
        "breakdown": parts,
    }
    return out


def main() -> None:
    print(json.dumps(apply(), indent=2, default=str))


if __name__ == "__main__":
    main()
