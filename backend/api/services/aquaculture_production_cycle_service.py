"""
Production cycles for aquaculture: automatic C-codes and bill-line cycle assignment.
"""
from __future__ import annotations

import re
from typing import TYPE_CHECKING

from api.models import AquaculturePond, AquacultureProductionCycle, Company

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
        code = next_automatic_cycle_code(company_id, pid)
        pname = (pond.name or "").strip() or f"Pond {pid}"
        name = f"{pname} — {bill_ref}"[:200]
        c = AquacultureProductionCycle(
            company_id=company_id,
            pond_id=pid,
            name=name,
            code=code[:64],
            start_date=bill_date,
            end_date=None,
            sort_order=0,
            is_active=True,
            notes="",
        )
        c.save()
        new_cycle_id_by_pond[pid] = c.id

    for pl in parsed_lines:
        pid = pl.get("aquaculture_pond_id")
        if not pid or pl.get("aquaculture_production_cycle_id"):
            continue
        pid_i = int(pid)
        nid = new_cycle_id_by_pond.get(pid_i)
        if nid:
            pl["aquaculture_production_cycle_id"] = nid
