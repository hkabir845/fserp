"""
Production cycles (stocking batches) for aquaculture: C-codes, bill-line assignment,
and nursing → grow-out batch lineage.
"""
from __future__ import annotations

import re
from datetime import date
from typing import TYPE_CHECKING

from decimal import Decimal

from django.db.models import Q

from api.models import AquaculturePond, AquacultureProductionCycle, Bill, BillLine, Company, Item
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


def _line_opens_new_stocking_batch(company_id: int, pl: dict) -> bool:
    """
    Fry / fingerling purchase lines start a new tilapia nursing batch (C01, C02, …).
    Feed, medicine, and other pond costs reuse the pond's open batch when left blank.
    """
    bucket = (pl.get("aquaculture_cost_bucket") or "").strip()
    if bucket == "fry_stocking":
        return True
    try:
        fish_count = int(pl.get("aquaculture_fish_count") or 0)
    except (TypeError, ValueError):
        fish_count = 0
    if fish_count <= 0:
        return False
    item_id = pl.get("item_id")
    if not item_id:
        return False
    cat = (
        Item.objects.filter(pk=item_id, company_id=company_id)
        .values_list("pos_category", flat=True)
        .first()
    )
    return (cat or "").strip().lower() == "fish"


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

    _clear_stale_cycle_refs_in_parsed_lines(company_id, parsed_lines)

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

    # Tilapia (seasonal batches): feed/medicine reuse the pond's open batch; only fry lines open C01/C02/C03.
    reused_open_batch_by_pond: dict[int, int] = {}
    for pl in parsed_lines:
        pid = pl.get("aquaculture_pond_id")
        if not pid or pl.get("aquaculture_production_cycle_id"):
            continue
        pid_i = int(pid)
        sp, _ = _species_for_pond_line(pl, pid_i)
        if not species_uses_seasonal_stocking_batches(sp):
            continue
        if _line_opens_new_stocking_batch(company_id, pl):
            continue
        if pid_i in reused_open_batch_by_pond:
            pl["aquaculture_production_cycle_id"] = reused_open_batch_by_pond[pid_i]
            continue
        sp_code, _ = normalize_fish_species(sp)
        existing = open_stocking_batch_for_pond_species(company_id, pid_i, sp_code)
        if existing:
            reused_open_batch_by_pond[pid_i] = existing.id
            pl["aquaculture_production_cycle_id"] = existing.id

    pond_ids_needing_new: set[int] = set()
    for pl in parsed_lines:
        pid = pl.get("aquaculture_pond_id")
        if not pid or pl.get("aquaculture_production_cycle_id"):
            continue
        pid_i = int(pid)
        sp, _ = _species_for_pond_line(pl, pid_i)
        if _line_opens_new_stocking_batch(company_id, pl):
            pond_ids_needing_new.add(pid_i)
        elif not species_uses_seasonal_stocking_batches(sp):
            # Pangasius / carp: first pond-tagged bill opens the long-running batch.
            pond_ids_needing_new.add(pid_i)

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


_BILL_REF_IN_NOTES = re.compile(r"Auto-created from vendor bill\s+(\S+)", re.I)
_BILL_REF_TOKEN = re.compile(r"BILL-\d+", re.I)


def _normalize_bill_ref_token(raw: str) -> str:
    s = (raw or "").strip().rstrip(".,;:")
    m = _BILL_REF_TOKEN.search(s)
    return m.group(0).upper() if m else s


def extract_vendor_bill_ref_from_cycle(cycle: AquacultureProductionCycle) -> str | None:
    """Parse bill number from auto-batch notes or legacy name patterns (e.g. '— BILL-304')."""
    notes = (cycle.notes or "").strip()
    m = _BILL_REF_IN_NOTES.search(notes)
    if m:
        ref = _normalize_bill_ref_token(m.group(1))
        return ref or None
    name = (cycle.name or "").strip()
    if not name:
        return None
    for seg in reversed(re.split(r"\s*—\s*", name)):
        seg = seg.strip()
        bare = seg.strip("()")
        if _BILL_REF_TOKEN.fullmatch(bare):
            return bare.upper()
        m2 = _BILL_REF_TOKEN.search(seg)
        if m2:
            return m2.group(0).upper()
    return None


def link_production_cycles_to_vendor_bills(
    company_id: int,
    *,
    bill_ids: list[int] | None = None,
    dry_run: bool = False,
) -> dict[str, int]:
    """
    Attach existing auto-created stocking batches to bill lines on the vendor bill they
    came from (notes/name reference). Does not create new cycles.
    """
    stats = {
        "cycles_scanned": 0,
        "cycles_matched": 0,
        "cycles_unmatched": 0,
        "bills_touched": 0,
        "lines_linked": 0,
        "lines_already_linked": 0,
        "conflicts_skipped": 0,
    }
    bills_by_number: dict[str, Bill] = {}
    for b in Bill.objects.filter(company_id=company_id).only("id", "bill_number"):
        key = (b.bill_number or "").strip()
        if key:
            bills_by_number[key.casefold()] = b

    cycle_by_bill_pond: dict[tuple[int, int], int] = {}
    for cycle in AquacultureProductionCycle.objects.filter(company_id=company_id).order_by("id"):
        stats["cycles_scanned"] += 1
        ref = extract_vendor_bill_ref_from_cycle(cycle)
        if not ref:
            stats["cycles_unmatched"] += 1
            continue
        bill = bills_by_number.get(ref.casefold())
        if not bill:
            stats["cycles_unmatched"] += 1
            continue
        if bill_ids and bill.id not in bill_ids:
            continue
        stats["cycles_matched"] += 1
        key = (bill.id, cycle.pond_id)
        if key in cycle_by_bill_pond and cycle_by_bill_pond[key] != cycle.id:
            stats["conflicts_skipped"] += 1
            continue
        cycle_by_bill_pond[key] = cycle.id

    touched_bills: set[int] = set()
    for (bill_id, pond_id), cycle_id in cycle_by_bill_pond.items():
        lines = BillLine.objects.filter(
            bill_id=bill_id,
            aquaculture_pond_id=pond_id,
        )
        for line in lines:
            if line.aquaculture_production_cycle_id == cycle_id:
                stats["lines_already_linked"] += 1
                continue
            if (
                line.aquaculture_production_cycle_id
                and line.aquaculture_production_cycle_id != cycle_id
            ):
                stats["conflicts_skipped"] += 1
                continue
            if not dry_run:
                line.aquaculture_production_cycle_id = cycle_id
                line.save(update_fields=["aquaculture_production_cycle_id"])
            stats["lines_linked"] += 1
            touched_bills.add(bill_id)

    stats["bills_touched"] = len(touched_bills)
    return stats


def _clear_stale_cycle_refs_in_parsed_lines(company_id: int, parsed_lines: list[dict]) -> None:
    """Drop production_cycle_id when the batch was deleted or belongs to another pond."""
    ids: set[int] = set()
    for pl in parsed_lines:
        raw = pl.get("aquaculture_production_cycle_id")
        if raw not in (None, ""):
            try:
                ids.add(int(raw))
            except (TypeError, ValueError):
                pl["aquaculture_production_cycle_id"] = None
    if not ids:
        return
    valid = {
        row["id"]: row["pond_id"]
        for row in AquacultureProductionCycle.objects.filter(
            company_id=company_id, pk__in=ids
        ).values("id", "pond_id")
    }
    for pl in parsed_lines:
        raw = pl.get("aquaculture_production_cycle_id")
        if raw in (None, ""):
            continue
        try:
            cyc_id = int(raw)
        except (TypeError, ValueError):
            pl["aquaculture_production_cycle_id"] = None
            continue
        pid = pl.get("aquaculture_pond_id")
        if cyc_id not in valid or (pid and int(pid) != valid[cyc_id]):
            pl["aquaculture_production_cycle_id"] = None


def _bill_line_to_assignment_dict(line: BillLine) -> dict:
    return {
        "item_id": line.item_id,
        "aquaculture_pond_id": line.aquaculture_pond_id,
        "aquaculture_production_cycle_id": line.aquaculture_production_cycle_id,
        "aquaculture_cost_bucket": (line.aquaculture_cost_bucket or "").strip(),
        "aquaculture_fish_count": line.aquaculture_fish_count,
        "aquaculture_fish_species": (line.aquaculture_fish_species or "").strip(),
        "aquaculture_fish_species_other": (line.aquaculture_fish_species_other or "").strip(),
    }


def repair_stale_aquaculture_bill_line_cycles(
    company_id: int,
    *,
    pond_ids: list[int] | None = None,
    bill_ids: list[int] | None = None,
    resync_gl: bool = True,
) -> dict[str, int]:
    """
    Re-link vendor bill lines after batch delete/recreate/edit.

    1) Match cycles whose notes/name reference the bill number.
    2) Re-run auto-assignment for lines whose cycle is missing or on the wrong pond.
    3) Refresh posted AUTO-BILL journals so fry/feed costs stay on the correct batch.
    """
    stats = {
        "link_lines_linked": 0,
        "repair_bills_touched": 0,
        "repair_lines_updated": 0,
        "journals_resynced": 0,
    }
    if not Company.objects.filter(pk=company_id, aquaculture_enabled=True).exists():
        return stats

    link_stats = link_production_cycles_to_vendor_bills(
        company_id, bill_ids=bill_ids, dry_run=False
    )
    stats["link_lines_linked"] = int(link_stats.get("lines_linked") or 0)

    valid_cycle_pond = {
        row["id"]: row["pond_id"]
        for row in AquacultureProductionCycle.objects.filter(company_id=company_id).values(
            "id", "pond_id"
        )
    }

    line_qs = BillLine.objects.filter(
        bill__company_id=company_id,
        aquaculture_pond_id__isnull=False,
    )
    if pond_ids:
        line_qs = line_qs.filter(aquaculture_pond_id__in=pond_ids)
    if bill_ids:
        line_qs = line_qs.filter(bill_id__in=bill_ids)

    stale_bill_ids: set[int] = set()
    for ln in line_qs.only("bill_id", "aquaculture_pond_id", "aquaculture_production_cycle_id"):
        cyc = ln.aquaculture_production_cycle_id
        if cyc and valid_cycle_pond.get(cyc) == ln.aquaculture_pond_id:
            continue
        stale_bill_ids.add(ln.bill_id)

    if not stale_bill_ids:
        return stats

    from api.services.gl_posting import resync_posted_bill_journal_from_lines

    for bill in (
        Bill.objects.filter(pk__in=stale_bill_ids, company_id=company_id)
        .prefetch_related("lines__item")
        .order_by("id")
    ):
        lines_list = list(bill.lines.all())
        parsed = [_bill_line_to_assignment_dict(ln) for ln in lines_list]
        assign_auto_production_cycles_for_parsed_bill_lines(company_id, bill, parsed)
        bill_updated = False
        for ln, pl in zip(lines_list, parsed):
            new_cyc = pl.get("aquaculture_production_cycle_id")
            if new_cyc != ln.aquaculture_production_cycle_id:
                ln.aquaculture_production_cycle_id = new_cyc
                ln.save(update_fields=["aquaculture_production_cycle_id"])
                stats["repair_lines_updated"] += 1
                bill_updated = True
        if bill_updated:
            stats["repair_bills_touched"] += 1
            if resync_gl and resync_posted_bill_journal_from_lines(company_id, bill.id):
                stats["journals_resynced"] += 1

    return stats


def link_orphan_bill_lines_to_cycle_by_start_date(
    company_id: int,
    cycle: AquacultureProductionCycle,
) -> int:
    """
    After a batch is recreated on a pond, attach orphan vendor lines from the same bill date.
    Helps when the user deleted C01 and opened a new C01 with the fry bill's stocking date.
    """
    return BillLine.objects.filter(
        bill__company_id=company_id,
        aquaculture_pond_id=cycle.pond_id,
        aquaculture_production_cycle_id__isnull=True,
        bill__bill_date=cycle.start_date,
    ).update(aquaculture_production_cycle_id=cycle.id)


def refresh_pond_batch_integrity(
    company_id: int,
    *,
    pond_id: int,
    production_cycle_id: int | None = None,
    resync_transfers: bool = True,
    resync_gl: bool = True,
) -> dict[str, int]:
    """Repair bill/journal batch tags and optionally reprice nursing transfers for one pond."""
    stats: dict[str, int] = {}
    if production_cycle_id is not None:
        cycle = AquacultureProductionCycle.objects.filter(
            pk=production_cycle_id, company_id=company_id, pond_id=pond_id
        ).first()
        if cycle:
            stats["start_date_lines_linked"] = link_orphan_bill_lines_to_cycle_by_start_date(
                company_id, cycle
            )
    repair_stats = repair_stale_aquaculture_bill_line_cycles(
        company_id,
        pond_ids=[pond_id],
        resync_gl=resync_gl,
    )
    stats.update(repair_stats)
    if resync_transfers:
        from api.services.aquaculture_transfer_cost import resync_nursing_pond_transfer_costs

        stats["transfers_resynced"] = resync_nursing_pond_transfer_costs(
            company_id=company_id,
            from_pond_id=pond_id,
            from_production_cycle_id=production_cycle_id,
            sync_gl=True,
        )
    return stats


def _is_fry_stocking_bill_line(line: BillLine) -> bool:
    bucket = (getattr(line, "aquaculture_cost_bucket", None) or "").strip()
    if bucket == "fry_stocking":
        return True
    fc = int(getattr(line, "aquaculture_fish_count", None) or 0)
    if fc <= 0:
        return False
    item = getattr(line, "item", None)
    return item is not None and (getattr(item, "pos_category", None) or "").strip().lower() == "fish"


def fry_stocking_summaries_for_cycles(
    company_id: int,
    cycle_ids: list[int],
) -> dict[int, dict[str, str | int | None]]:
    """
    Fry purchase totals per production cycle from posted vendor bill lines (fish / fry_stocking).
    """
    if not cycle_ids:
        return {}
    fry_line_q = Q(aquaculture_cost_bucket="fry_stocking") | Q(
        aquaculture_fish_count__gt=0,
        item__pos_category__iexact="fish",
    )
    lines = (
        BillLine.objects.filter(
            bill__company_id=company_id,
            aquaculture_production_cycle_id__in=cycle_ids,
            bill__stock_receipt_applied=True,
        )
        .filter(fry_line_q)
        .select_related("bill", "item")
        .order_by("aquaculture_production_cycle_id", "bill__bill_date", "id")
    )
    acc: dict[int, dict] = {}
    bill_nums: dict[int, set[str]] = {}
    for ln in lines:
        if not _is_fry_stocking_bill_line(ln):
            continue
        cy_id = ln.aquaculture_production_cycle_id
        if cy_id is None:
            continue
        if cy_id not in acc:
            acc[cy_id] = {
                "fry_stocking_date": None,
                "fry_stocking_fish_count": 0,
                "fry_stocking_weight_kg": Decimal("0"),
                "fry_stocking_cost_amount": Decimal("0"),
            }
            bill_nums[cy_id] = set()
        row = acc[cy_id]
        b = ln.bill
        bdate = b.bill_date.isoformat() if b and b.bill_date else None
        if bdate and (row["fry_stocking_date"] is None or bdate < row["fry_stocking_date"]):
            row["fry_stocking_date"] = bdate
        row["fry_stocking_fish_count"] += int(ln.aquaculture_fish_count or 0)
        if ln.aquaculture_fish_weight_kg is not None:
            row["fry_stocking_weight_kg"] += Decimal(str(ln.aquaculture_fish_weight_kg))
        row["fry_stocking_cost_amount"] += Decimal(str(ln.amount or 0))
        bnum = (b.bill_number or "").strip() if b else ""
        if bnum:
            bill_nums[cy_id].add(bnum)

    out: dict[int, dict[str, str | int | None]] = {}
    for cy_id, row in acc.items():
        w = row["fry_stocking_weight_kg"]
        cost = row["fry_stocking_cost_amount"]
        nums = sorted(bill_nums.get(cy_id) or [])
        out[cy_id] = {
            "fry_stocking_date": row["fry_stocking_date"],
            "fry_stocking_fish_count": row["fry_stocking_fish_count"] or None,
            "fry_stocking_weight_kg": str(w.quantize(Decimal("0.01"))) if w else None,
            "fry_stocking_cost_amount": str(cost.quantize(Decimal("0.01"))) if cost else None,
            "fry_vendor_bill_numbers": ", ".join(nums) if nums else "",
        }
    return out
