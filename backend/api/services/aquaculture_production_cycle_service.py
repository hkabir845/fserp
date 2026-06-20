"""
Production cycles (stocking batches) for aquaculture: C-codes, bill-line assignment,
and nursing → grow-out batch lineage.
"""
from __future__ import annotations

import re
from datetime import date
from typing import TYPE_CHECKING

from api.models import AquaculturePond, AquacultureProductionCycle, Company
from api.services.aquaculture_constants import fish_species_display_label, normalize_fish_species

if TYPE_CHECKING:
    from api.models import Bill

_CYCLE_AUTO_CODE = re.compile(r"^[cC](\d+)$")


def _cycle_code_serial(code: str) -> int | None:
    m = _CYCLE_AUTO_CODE.match((code or "").strip())
    return int(m.group(1)) if m else None


def _occupied_cycle_code_serials(
    company_id: int, pond_id: int, exclude_cycle_id: int | None = None
) -> set[int]:
    qs = AquacultureProductionCycle.objects.filter(company_id=company_id, pond_id=pond_id)
    if exclude_cycle_id is not None:
        qs = qs.exclude(pk=exclude_cycle_id)
    out: set[int] = set()
    for row in qs.values_list("code", flat=True):
        n = _cycle_code_serial(row or "")
        if n is not None:
            out.add(n)
    return out


def _format_auto_cycle_code(n: int, occupied: set[int]) -> str:
    width = max(2, len(str(n)))
    if occupied:
        width = max(width, max((len(str(x)) for x in occupied), default=0))
    return "C" + str(n).zfill(width)


def next_automatic_cycle_code(company_id: int, pond_id: int) -> str:
    """Per-pond: smallest unused C + serial (C01, C02, …), same gap-fill rules as pond P-codes."""
    occupied = _occupied_cycle_code_serials(company_id, pond_id)
    m = 1
    while m in occupied:
        m += 1
    return _format_auto_cycle_code(m, occupied)


def cycle_code_conflict(
    company_id: int, pond_id: int, code: str, exclude_cycle_id: int | None
) -> bool:
    c = (code or "").strip()
    if not c:
        return False
    qs = AquacultureProductionCycle.objects.filter(
        company_id=company_id, pond_id=pond_id, code__iexact=c
    )
    if exclude_cycle_id is not None:
        qs = qs.exclude(pk=exclude_cycle_id)
    return qs.exists()


def _pond_role(pond: AquaculturePond) -> str:
    return (getattr(pond, "pond_role", None) or "grow_out").strip().lower()


def species_uses_seasonal_stocking_batches(fish_species: str | None) -> bool:
    """
    Tilapia: multiple fry batches per season (C01, C02, C03 on nursing, then grow-out).
    Other species: one open batch per pond that keeps growing; a 2nd batch is rare.
    """
    sp_code, _ = normalize_fish_species(fish_species or "tilapia")
    return sp_code == "tilapia"


def open_stocking_batch_for_pond_species(
    company_id: int,
    pond_id: int,
    fish_species: str | None,
) -> AquacultureProductionCycle | None:
    """Latest open active batch for this pond and species (continuous-culture species)."""
    sp_code, _ = normalize_fish_species(fish_species or "tilapia")
    return (
        AquacultureProductionCycle.objects.filter(
            company_id=company_id,
            pond_id=pond_id,
            fish_species=sp_code,
            end_date__isnull=True,
            is_active=True,
        )
        .order_by("-start_date", "-id")
        .first()
    )


def suggest_continuous_batch_name(
    *,
    species_label: str,
    pond_name: str,
) -> str:
    """Single long-running batch name for non-tilapia species on a pond."""
    sp = (species_label or "Fish").strip() or "Fish"
    pond = (pond_name or "Pond").strip()
    return f"{sp} — {pond}"[:200]


def suggest_nursing_batch_name(
    *,
    species_label: str,
    pond_name: str,
    code: str,
    start_date: date,
) -> str:
    """Human-readable name for a fry stocking batch on a nursing pond."""
    sp = (species_label or "Tilapia").strip() or "Tilapia"
    pond = (pond_name or "Nursing pond").strip()
    c = (code or "").strip()
    month = start_date.strftime("%b %Y")
    bits = [sp, "fry batch"]
    if c:
        bits.append(c)
    return f"{' '.join(bits)} — {pond} — {month}"[:200]


def suggest_grow_out_batch_name(
    *,
    species_label: str,
    source_code: str,
    source_name: str,
    pond_name: str,
) -> str:
    """Name for a grow-out batch stocked from a nursing cohort."""
    sp = (species_label or "Tilapia").strip() or "Tilapia"
    pond = (pond_name or "Grow-out pond").strip()
    ref = (source_code or "").strip() or (source_name or "").strip()[:40]
    if ref:
        return f"{sp} fingerlings ({ref}) — {pond}"[:200]
    return f"{sp} fingerlings — {pond}"[:200]


def suggest_auto_batch_name_for_bill_line(
    *,
    pond: AquaculturePond,
    code: str,
    bill_date: date,
    bill_ref: str,
    fish_species: str | None = None,
    fish_species_other: str | None = None,
) -> str:
    sp_code, _ = normalize_fish_species(fish_species or "tilapia")
    sp_label = fish_species_display_label(sp_code, fish_species_other)
    pname = (pond.name or "").strip() or f"Pond {pond.id}"
    role = _pond_role(pond)
    if role == "nursing":
        return suggest_nursing_batch_name(
            species_label=sp_label,
            pond_name=pname,
            code=code,
            start_date=bill_date,
        )
    if not species_uses_seasonal_stocking_batches(sp_code):
        return suggest_continuous_batch_name(species_label=sp_label, pond_name=pname)
    month = bill_date.strftime("%b %Y")
    c = (code or "").strip()
    ref = (bill_ref or "").strip()
    bits = [sp_label, "batch"]
    if c:
        bits.append(c)
    name = f"{' '.join(bits)} — {pname}"
    if ref:
        name = f"{name} ({ref})"
    return f"{name} — {month}"[:200]


def create_production_cycle(
    *,
    company_id: int,
    pond: AquaculturePond,
    name: str,
    start_date: date,
    fish_species: str = "tilapia",
    fish_species_other: str = "",
    source_production_cycle: AquacultureProductionCycle | None = None,
    notes: str = "",
) -> AquacultureProductionCycle:
    sp_code, _ = normalize_fish_species(fish_species or "tilapia")
    sp_other = (fish_species_other or "").strip() if sp_code == "other" else ""
    code = next_automatic_cycle_code(company_id, pond.id)
    c = AquacultureProductionCycle(
        company_id=company_id,
        pond=pond,
        name=(name or "").strip()[:200] or f"Batch {code}",
        code=code[:64],
        fish_species=sp_code,
        fish_species_other=sp_other[:120],
        source_production_cycle=source_production_cycle,
        start_date=start_date,
        end_date=None,
        sort_order=0,
        is_active=True,
        notes=(notes or "")[:5000],
    )
    c.save()
    return c


def ensure_destination_cycle_for_transfer(
    *,
    company_id: int,
    from_cycle: AquacultureProductionCycle,
    to_pond: AquaculturePond,
    transfer_date: date,
    fish_species: str,
    fish_species_other: str = "",
) -> AquacultureProductionCycle:
    """
    When fingerlings move nursing → grow-out, ensure each destination pond has an open
    batch linked to the source nursing batch (reuse if already created).
    """
    sp_code = (from_cycle.fish_species or fish_species or "tilapia").strip() or "tilapia"
    sp_other = from_cycle.fish_species_other or fish_species_other or ""

    if not species_uses_seasonal_stocking_batches(sp_code):
        continuous = open_stocking_batch_for_pond_species(company_id, to_pond.id, sp_code)
        if continuous:
            return continuous

    existing = (
        AquacultureProductionCycle.objects.filter(
            company_id=company_id,
            pond_id=to_pond.id,
            source_production_cycle_id=from_cycle.id,
            end_date__isnull=True,
            is_active=True,
        )
        .order_by("-start_date", "-id")
        .first()
    )
    if existing:
        return existing

    sp_code = (from_cycle.fish_species or fish_species or "tilapia").strip() or "tilapia"
    sp_other = from_cycle.fish_species_other or fish_species_other or ""
    sp_label = fish_species_display_label(sp_code, sp_other)
    pname = (to_pond.name or "").strip() or f"Pond {to_pond.id}"
    name = suggest_grow_out_batch_name(
        species_label=sp_label,
        source_code=from_cycle.code or "",
        source_name=from_cycle.name or "",
        pond_name=pname,
    )
    return create_production_cycle(
        company_id=company_id,
        pond=to_pond,
        name=name,
        start_date=transfer_date,
        fish_species=sp_code,
        fish_species_other=sp_other,
        source_production_cycle=from_cycle,
        notes=f"Auto-created from nursing batch {from_cycle.code or from_cycle.id} on transfer.",
    )


def assign_auto_production_cycles_for_parsed_bill_lines(
    company_id: int,
    bill: Bill,
    parsed_lines: list[dict],
) -> None:
    """
    When aquaculture is enabled: any bill line with aquaculture_pond_id and no
    aquaculture_production_cycle_id gets a cycle. Lines on the same bill and pond
    share one new cycle unless another line on that bill already specifies a cycle
    for that pond (then missing lines inherit it).

    Fry bills: tilapia opens a new batch each time (C01, C02, C03…). Other species reuse
    the pond's single open batch when one exists.
    """
    if not parsed_lines:
        return
    if not Company.objects.filter(pk=company_id, aquaculture_enabled=True).exists():
        return

    bill_date = bill.bill_date
    bill_ref = ((bill.bill_number or "").strip() or f"#{bill.pk}")[:80]

    explicit_cycle_by_pond: dict[int, int] = {}
    for pl in parsed_lines:
        pid = pl.get("aquaculture_pond_id")
        cyc = pl.get("aquaculture_production_cycle_id")
        if pid and cyc and pid not in explicit_cycle_by_pond:
            explicit_cycle_by_pond[int(pid)] = int(cyc)

    for pl in parsed_lines:
        pid = pl.get("aquaculture_pond_id")
        if not pid:
            continue
        pid_i = int(pid)
        if pl.get("aquaculture_production_cycle_id"):
            continue
        if pid_i in explicit_cycle_by_pond:
            pl["aquaculture_production_cycle_id"] = explicit_cycle_by_pond[pid_i]

    # One species hint per pond from lines on this bill (tilapia default).
    species_by_pond: dict[int, tuple[str, str]] = {}
    for pl in parsed_lines:
        pid = pl.get("aquaculture_pond_id")
        if not pid:
            continue
        sp = (pl.get("aquaculture_fish_species") or "").strip()
        if sp:
            species_by_pond[int(pid)] = (
                sp,
                (pl.get("aquaculture_fish_species_other") or "").strip(),
            )

    def _species_for_pond_line(pl: dict, pid: int) -> tuple[str, str]:
        sp = (pl.get("aquaculture_fish_species") or "").strip()
        if sp:
            return sp, (pl.get("aquaculture_fish_species_other") or "").strip()
        return species_by_pond.get(pid, ("tilapia", ""))

    # Non-tilapia: attach to the pond's existing open batch for that species.
    reused_cycle_by_pond_species: dict[tuple[int, str], int] = {}
    for pl in parsed_lines:
        pid = pl.get("aquaculture_pond_id")
        if not pid or pl.get("aquaculture_production_cycle_id"):
            continue
        pid_i = int(pid)
        sp, _ = _species_for_pond_line(pl, pid_i)
        if species_uses_seasonal_stocking_batches(sp):
            continue
        sp_code, _ = normalize_fish_species(sp)
        key = (pid_i, sp_code)
        if key in reused_cycle_by_pond_species:
            pl["aquaculture_production_cycle_id"] = reused_cycle_by_pond_species[key]
            continue
        existing = open_stocking_batch_for_pond_species(company_id, pid_i, sp_code)
        if existing:
            reused_cycle_by_pond_species[key] = existing.id
            pl["aquaculture_production_cycle_id"] = existing.id

    pond_ids_needing_new: set[int] = set()
    for pl in parsed_lines:
        pid = pl.get("aquaculture_pond_id")
        if not pid or pl.get("aquaculture_production_cycle_id"):
            continue
        pond_ids_needing_new.add(int(pid))

    if not pond_ids_needing_new:
        return

    ponds = {
        p.id: p
        for p in AquaculturePond.objects.filter(company_id=company_id, pk__in=pond_ids_needing_new)
    }

    new_cycle_id_by_pond: dict[int, int] = {}
    for pid in sorted(pond_ids_needing_new):
        pond = ponds.get(pid)
        if not pond:
            continue
        sp, sp_other = species_by_pond.get(pid, ("tilapia", ""))
        code = next_automatic_cycle_code(company_id, pid)
        name = suggest_auto_batch_name_for_bill_line(
            pond=pond,
            code=code,
            bill_date=bill_date,
            bill_ref=bill_ref,
            fish_species=sp,
            fish_species_other=sp_other,
        )
        c = create_production_cycle(
            company_id=company_id,
            pond=pond,
            name=name,
            start_date=bill_date,
            fish_species=sp,
            fish_species_other=sp_other,
            notes=f"Auto-created from vendor bill {bill_ref}.",
        )
        new_cycle_id_by_pond[pid] = c.id

    for pl in parsed_lines:
        pid = pl.get("aquaculture_pond_id")
        if not pid or pl.get("aquaculture_production_cycle_id"):
            continue
        pid_i = int(pid)
        nid = new_cycle_id_by_pond.get(pid_i)
        if nid:
            pl["aquaculture_production_cycle_id"] = nid
