"""
Retag biological aquaculture sales (and optional samples) missing production_cycle.

Safe defaults:
  - single-cycle ponds → that cycle
  - multi-cycle: unique date-window + species match only
  - otherwise leave for review (dry-run lists them)

Does not invent cycles; does not guess across ambiguous multi-cycle ponds.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from django.db import transaction

from api.models import (
    AquacultureBiomassSample,
    AquacultureFishSale,
    AquacultureProductionCycle,
)
from api.services.tenant_reporting_categories import income_type_is_non_biological_for_company

MEMO_NOTE = "CORRECTED: assigned production_cycle (null-cycle retag)."


@dataclass(frozen=True)
class _CycleWindow:
    id: int
    pond_id: int
    species: str
    start: date | None
    end: date | None  # inclusive; None = open


def _append_note(obj: Any, note: str, field: str = "memo") -> None:
    cur = (getattr(obj, field, None) or "").strip()
    if note in cur:
        return
    setattr(obj, field, (cur + (" | " if cur else "") + note)[:5000])


def _species_key(raw: str | None) -> str:
    return (raw or "tilapia").strip().lower() or "tilapia"


def _cycle_species_open(sp: str) -> bool:
    return sp in ("", "mixed", "polyculture", "other", "multi")


def _build_cycle_windows(company_id: int, pond_id: int | None) -> dict[int, list[_CycleWindow]]:
    qs = AquacultureProductionCycle.objects.filter(company_id=company_id).order_by(
        "pond_id", "start_date", "id"
    )
    if pond_id is not None:
        qs = qs.filter(pond_id=pond_id)
    by_pond: dict[int, list[AquacultureProductionCycle]] = {}
    for cy in qs:
        by_pond.setdefault(cy.pond_id, []).append(cy)

    out: dict[int, list[_CycleWindow]] = {}
    for pid, cycles in by_pond.items():
        windows: list[_CycleWindow] = []
        for i, cy in enumerate(cycles):
            start = cy.start_date
            end: date | None = None
            if cy.end_date:
                end = cy.end_date
            else:
                # Open cycle ends the day before the next cycle on the same pond starts.
                for nxt in cycles[i + 1 :]:
                    if nxt.start_date:
                        end = nxt.start_date - timedelta(days=1)
                        break
            windows.append(
                _CycleWindow(
                    id=cy.id,
                    pond_id=pid,
                    species=_species_key(getattr(cy, "fish_species", None)),
                    start=start,
                    end=end,
                )
            )
        out[pid] = windows
    return out


def _date_in_window(d: date, w: _CycleWindow) -> bool:
    if w.start and d < w.start:
        return False
    if w.end and d > w.end:
        return False
    return True


def _resolve_cycle_for_sale(
    sale: AquacultureFishSale,
    windows: list[_CycleWindow],
) -> tuple[int | None, str]:
    if not windows:
        return None, "no_cycles_on_pond"
    if len(windows) == 1:
        return windows[0].id, "sole_cycle"

    sp = _species_key(sale.fish_species)
    dated = [w for w in windows if _date_in_window(sale.sale_date, w)]
    if not dated:
        return None, "no_date_window_match"

    species_hit = [
        w
        for w in dated
        if _cycle_species_open(w.species) or w.species == sp
    ]
    # Prefer exact species over open/polyculture when both match.
    exact = [w for w in species_hit if w.species == sp]
    candidates = exact or species_hit
    if len(candidates) == 1:
        reason = "date_species_match" if exact else "date_open_cycle_match"
        return candidates[0].id, reason
    if len(candidates) > 1:
        return None, "ambiguous_multi_cycle"
    return None, "species_mismatch_in_window"


def preview_null_cycle_sales(
    company_id: int,
    *,
    pond_id: int | None = None,
) -> dict:
    """Return proposed retags without writing."""
    windows_by_pond = _build_cycle_windows(company_id, pond_id)
    qs = AquacultureFishSale.objects.filter(
        company_id=company_id,
        production_cycle_id__isnull=True,
    ).order_by("pond_id", "sale_date", "id")
    if pond_id is not None:
        qs = qs.filter(pond_id=pond_id)

    would_tag: list[dict] = []
    skip: list[dict] = []
    heads_would = 0
    heads_skip = 0

    for sale in qs.only(
        "id",
        "pond_id",
        "sale_date",
        "fish_species",
        "fish_count",
        "weight_kg",
        "income_type",
        "memo",
    ):
        if income_type_is_non_biological_for_company(company_id, sale.income_type or ""):
            continue
        n = int(sale.fish_count or 0)
        cy_id, reason = _resolve_cycle_for_sale(
            sale, windows_by_pond.get(sale.pond_id) or []
        )
        row = {
            "sale_id": sale.id,
            "pond_id": sale.pond_id,
            "sale_date": sale.sale_date.isoformat(),
            "fish_species": sale.fish_species,
            "fish_count": n,
            "weight_kg": str(sale.weight_kg or Decimal("0")),
            "proposed_cycle_id": cy_id,
            "reason": reason,
        }
        if cy_id is not None:
            would_tag.append(row)
            heads_would += n
        else:
            skip.append(row)
            heads_skip += n

    return {
        "company_id": company_id,
        "pond_id": pond_id,
        "would_tag_count": len(would_tag),
        "would_tag_heads": heads_would,
        "skip_count": len(skip),
        "skip_heads": heads_skip,
        "would_tag": would_tag,
        "skip": skip,
    }


@transaction.atomic
def apply_null_cycle_sales(
    company_id: int,
    *,
    pond_id: int | None = None,
    also_samples: bool = True,
) -> dict:
    """Apply safe retags. Returns summary + remaining null counts."""
    preview = preview_null_cycle_sales(company_id, pond_id=pond_id)
    tagged = 0
    for row in preview["would_tag"]:
        sale = AquacultureFishSale.objects.filter(
            pk=row["sale_id"], company_id=company_id, production_cycle_id__isnull=True
        ).first()
        if not sale:
            continue
        sale.production_cycle_id = row["proposed_cycle_id"]
        _append_note(sale, MEMO_NOTE, "memo")
        sale.save(update_fields=["production_cycle", "memo", "updated_at"])
        tagged += 1

    samples_tagged = 0
    if also_samples:
        # Samples linked to a now-tagged sale inherit the sale cycle.
        qs = AquacultureBiomassSample.objects.filter(
            company_id=company_id,
            production_cycle_id__isnull=True,
            source_fish_sale_id__isnull=False,
        ).select_related("source_fish_sale")
        if pond_id is not None:
            qs = qs.filter(pond_id=pond_id)
        for sample in qs:
            sale = sample.source_fish_sale
            if sale and sale.production_cycle_id:
                sample.production_cycle_id = sale.production_cycle_id
                _append_note(sample, MEMO_NOTE, "notes")
                sample.save(update_fields=["production_cycle", "notes", "updated_at"])
                samples_tagged += 1

        # Sole-cycle ponds: any remaining null samples.
        windows_by_pond = _build_cycle_windows(company_id, pond_id)
        for pid, windows in windows_by_pond.items():
            if len(windows) != 1:
                continue
            cy_id = windows[0].id
            for sample in AquacultureBiomassSample.objects.filter(
                company_id=company_id,
                pond_id=pid,
                production_cycle_id__isnull=True,
            ):
                sample.production_cycle_id = cy_id
                _append_note(sample, MEMO_NOTE, "notes")
                sample.save(update_fields=["production_cycle", "notes", "updated_at"])
                samples_tagged += 1

    remaining_sales = AquacultureFishSale.objects.filter(
        company_id=company_id, production_cycle_id__isnull=True
    )
    if pond_id is not None:
        remaining_sales = remaining_sales.filter(pond_id=pond_id)
    remaining_bio = 0
    for s in remaining_sales.only("id", "income_type"):
        if not income_type_is_non_biological_for_company(company_id, s.income_type or ""):
            remaining_bio += 1

    return {
        "company_id": company_id,
        "pond_id": pond_id,
        "sales_tagged": tagged,
        "samples_tagged": samples_tagged,
        "skipped": preview["skip"],
        "skip_count": preview["skip_count"],
        "remaining_null_biological_sales": remaining_bio,
    }


def preview_species_mistags(company_id: int, *, pond_id: int | None = None) -> dict:
    """
    Flag biological sales whose fish_species disagrees with the cycle primary species.

    Auto-fix only when memo/buyer clearly names another known species code.
    """
    from api.models import AquacultureProductionCycle

    KNOWN = {
        "tilapia",
        "silver_carp",
        "common_carp",
        "grass_carp",
        "bighead_carp",
        "rui",
        "katla",
        "mrigal",
        "kalibaush",
        "pangas",
        "other",
    }
    ALIASES = {
        "silver carp": "silver_carp",
        "silvercarp": "silver_carp",
        "common carp": "common_carp",
        "grass carp": "grass_carp",
        "bighead carp": "bighead_carp",
        "big head carp": "bighead_carp",
    }

    cycles = {
        c.id: c
        for c in AquacultureProductionCycle.objects.filter(company_id=company_id)
    }
    qs = AquacultureFishSale.objects.filter(company_id=company_id).exclude(
        production_cycle_id__isnull=True
    )
    if pond_id is not None:
        qs = qs.filter(pond_id=pond_id)

    mistags: list[dict] = []
    for sale in qs.select_related("production_cycle").order_by("sale_date", "id"):
        if income_type_is_non_biological_for_company(company_id, sale.income_type or ""):
            continue
        cy = cycles.get(sale.production_cycle_id)
        if not cy:
            continue
        cy_sp = _species_key(getattr(cy, "fish_species", None))
        if _cycle_species_open(cy_sp):
            continue
        sale_sp = _species_key(sale.fish_species)
        if sale_sp == cy_sp:
            continue

        text = f"{sale.memo or ''} {sale.buyer_name or ''}".lower()
        inferred = None
        for alias, code in ALIASES.items():
            if alias in text:
                inferred = code
                break
        if inferred is None:
            for code in KNOWN:
                if code.replace("_", " ") in text or code in text.replace(" ", "_"):
                    if code != sale_sp:
                        inferred = code
                        break

        mistags.append(
            {
                "sale_id": sale.id,
                "pond_id": sale.pond_id,
                "sale_date": sale.sale_date.isoformat(),
                "current_species": sale_sp,
                "cycle_id": cy.id,
                "cycle_species": cy_sp,
                "inferred_from_memo": inferred,
                "auto_fixable": inferred is not None and inferred == cy_sp,
                "fish_count": int(sale.fish_count or 0),
            }
        )

    auto = [m for m in mistags if m["auto_fixable"]]
    return {
        "company_id": company_id,
        "pond_id": pond_id,
        "mistag_count": len(mistags),
        "auto_fixable_count": len(auto),
        "mistags": mistags,
    }


@transaction.atomic
def apply_species_mistags(
    company_id: int,
    *,
    pond_id: int | None = None,
    only_auto: bool = True,
) -> dict:
    preview = preview_species_mistags(company_id, pond_id=pond_id)
    fixed = 0
    for row in preview["mistags"]:
        if only_auto and not row["auto_fixable"]:
            continue
        target = row["inferred_from_memo"] or row["cycle_species"]
        if only_auto:
            target = row["cycle_species"]
        sale = AquacultureFishSale.objects.filter(
            pk=row["sale_id"], company_id=company_id
        ).first()
        if not sale:
            continue
        if _species_key(sale.fish_species) == target:
            continue
        sale.fish_species = target
        _append_note(
            sale,
            f"CORRECTED: fish_species {row['current_species']} → {target} (species mistag).",
            "memo",
        )
        sale.save(update_fields=["fish_species", "memo", "updated_at"])
        fixed += 1
    return {
        "company_id": company_id,
        "fixed": fixed,
        "reviewed_mistags": preview["mistag_count"],
        "left_for_manual": preview["mistag_count"] - fixed,
    }
