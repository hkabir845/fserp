"""
Fish count / weight position from transfers, sales, stock ledger, and latest sample (management).
"""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from api.models import (
    AquacultureBiomassSample,
    AquacultureFishPondTransferLine,
    AquacultureFishSale,
    AquacultureFishStockLedger,
    AquaculturePond,
)
from api.services.aquaculture_constants import (
    NON_BIOLOGICAL_POND_SALE_INCOME_TYPES,
    fish_species_display_label,
)


def _d(v) -> Decimal:
    if v is None:
        return Decimal("0")
    return Decimal(str(v))


def compute_fish_stock_position_rows(
    company_id: int,
    *,
    pond_id: int | None = None,
    production_cycle_id: int | None = None,
) -> list[dict]:
    """
    Per-pond running totals: transfers in/out, sales, ledger deltas, implied net count & kg.
    When production_cycle_id is set, movements are restricted to that cycle (including transfer lines
    and sales tagged with that production_cycle_id).
    """
    cid = company_id
    ponds = AquaculturePond.objects.filter(company_id=cid, is_active=True).order_by("sort_order", "id")
    if pond_id is not None:
        ponds = ponds.filter(pk=pond_id)

    cy_id = production_cycle_id

    in_map_w: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    in_map_c: dict[int, int] = defaultdict(int)
    out_map_w: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    out_map_c: dict[int, int] = defaultdict(int)

    lines_in = AquacultureFishPondTransferLine.objects.filter(transfer__company_id=cid).select_related(
        "transfer", "to_pond"
    )
    for ln in lines_in:
        tp = ln.to_pond_id
        if pond_id is not None and tp != pond_id:
            continue
        if cy_id is not None and ln.to_production_cycle_id != cy_id:
            continue
        in_map_w[tp] += _d(ln.weight_kg)
        if ln.fish_count is not None:
            in_map_c[tp] += int(ln.fish_count)

    lines_out = AquacultureFishPondTransferLine.objects.filter(transfer__company_id=cid).select_related("transfer")
    for ln in lines_out:
        fp = ln.transfer.from_pond_id
        if pond_id is not None and fp != pond_id:
            continue
        if cy_id is not None and ln.transfer.from_production_cycle_id != cy_id:
            continue
        out_map_w[fp] += _d(ln.weight_kg)
        if ln.fish_count is not None:
            out_map_c[fp] += int(ln.fish_count)

    sale_q = AquacultureFishSale.objects.filter(company_id=cid)
    if pond_id is not None:
        sale_q = sale_q.filter(pond_id=pond_id)
    if cy_id is not None:
        sale_q = sale_q.filter(production_cycle_id=cy_id)

    sale_by_pond: dict[int, tuple[Decimal, int]] = defaultdict(lambda: (Decimal("0"), 0))
    for s in sale_q.only("pond_id", "weight_kg", "fish_count", "income_type"):
        if getattr(s, "income_type", None) in NON_BIOLOGICAL_POND_SALE_INCOME_TYPES:
            continue
        pid = s.pond_id
        w, c = sale_by_pond[pid]
        fc = int(s.fish_count) if s.fish_count is not None else 0
        sale_by_pond[pid] = (w + _d(s.weight_kg), c + fc)

    ledger_q = AquacultureFishStockLedger.objects.filter(company_id=cid)
    if pond_id is not None:
        ledger_q = ledger_q.filter(pond_id=pond_id)
    if cy_id is not None:
        ledger_q = ledger_q.filter(production_cycle_id=cy_id)

    ledger_by_pond: dict[int, tuple[Decimal, int]] = defaultdict(lambda: (Decimal("0"), 0))
    for row in ledger_q.only("pond_id", "weight_kg_delta", "fish_count_delta"):
        pid = row.pond_id
        w, c = ledger_by_pond[pid]
        ledger_by_pond[pid] = (w + _d(row.weight_kg_delta), c + int(row.fish_count_delta or 0))

    latest_sample: dict[int, AquacultureBiomassSample] = {}
    for p in ponds:
        qs = AquacultureBiomassSample.objects.filter(company_id=cid, pond_id=p.id)
        if cy_id is not None:
            qs = qs.filter(production_cycle_id=cy_id)
        s = qs.order_by("-sample_date", "-id").first()
        if s:
            latest_sample[p.id] = s

    out_rows: list[dict] = []
    for p in ponds:
        pid = p.id
        tw = in_map_w[pid] - out_map_w[pid]
        tc = in_map_c[pid] - out_map_c[pid]
        sw, sc = sale_by_pond[pid]
        tw -= sw
        tc -= sc
        lw, lc = ledger_by_pond[pid]
        tw += lw
        tc += lc
        smp = latest_sample.get(pid)
        out_rows.append(
            {
                "pond_id": pid,
                "pond_name": (p.name or "").strip(),
                "transfer_in_weight_kg": str(_d(in_map_w[pid])),
                "transfer_out_weight_kg": str(_d(out_map_w[pid])),
                "sale_weight_kg": str(sw),
                "sale_fish_count": sc,
                "ledger_weight_kg_delta": str(lw),
                "ledger_fish_count_delta": lc,
                "implied_net_weight_kg": str(tw),
                "implied_net_fish_count": tc,
                "latest_sample_date": smp.sample_date.isoformat() if smp else None,
                "latest_sample_estimated_fish_count": smp.estimated_fish_count if smp else None,
                "latest_sample_estimated_total_weight_kg": (
                    str(smp.estimated_total_weight_kg) if smp and smp.estimated_total_weight_kg is not None else None
                ),
                "latest_sample_avg_weight_kg": (
                    str(smp.avg_weight_kg) if smp and smp.avg_weight_kg is not None else None
                ),
                "latest_sample_fish_species": (getattr(smp, "fish_species", None) or "tilapia") if smp else None,
                "latest_sample_fish_species_label": (
                    fish_species_display_label(smp.fish_species, smp.fish_species_other) if smp else None
                ),
                "production_cycle_id": cy_id,
            }
        )
    return out_rows
