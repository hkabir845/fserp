"""
Fish count / weight position from transfers, sales, stock ledger, and latest sample (management).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal

from api.models import (
    AquacultureBiomassSample,
    AquacultureFishPondTransferLine,
    AquacultureFishSale,
    AquacultureFishStockLedger,
    AquaculturePond,
    AquacultureProductionCycle,
    BillLine,
    Item,
)
from api.services.aquaculture_constants import fish_species_display_label, normalize_fish_species
from api.services.tenant_reporting_categories import income_type_is_non_biological_for_company
from api.services.aquaculture_biomass_sample_reference_service import last_biomass_sample_reference_for_ledger
from api.services.aquaculture_partial_harvest import (
    effective_biomass_kg_from_position_row,
    enrich_position_row_with_fish_metrics,
)
from api.services.aquaculture_units import (
    compute_stocking_load_advice,
    compute_water_volume_cu_ft,
    format_pond_area_decimal_for_api,
    format_two_decimal_places_for_api,
)


def _d(v) -> Decimal:
    if v is None:
        return Decimal("0")
    return Decimal(str(v))


StockBucketKey = tuple[int, int | None, str]


def _infer_fish_species_code_from_fish_item(item: Item) -> str:
    """Vendor bill fish lines have no fish_species; infer from item name for breakdown buckets."""
    name = (item.name or "").lower()
    if "pangas" in name or "basa" in name:
        return "pangas"
    return "tilapia"


def _stock_bucket_key(pond_id: int, cycle_id: int | None, species_raw) -> StockBucketKey:
    code, _ = normalize_fish_species(species_raw)
    return (pond_id, cycle_id, code or "tilapia")


def _vendor_bill_fish_matches_species_filter(item: Item, species_filter_code: str | None) -> bool:
    """Vendor bill lines have no fish_species; use item name heuristics when a species filter is set."""
    if species_filter_code is None:
        return True
    name = (item.name or "").lower()
    code = species_filter_code.strip().lower()
    if code and code in name:
        return True
    if code == "tilapia":
        if "pangasius" in name or "basa" in name:
            return False
        return True
    return False


def _bill_line_species_code(line, item: Item) -> str:
    """Prefer the species stored on the bill line; fall back to item-name inference (legacy lines)."""
    stored = (getattr(line, "aquaculture_fish_species", "") or "").strip()
    if stored:
        code, _ = normalize_fish_species(stored)
        return code or "tilapia"
    return _infer_fish_species_code_from_fish_item(item)


def _bill_line_matches_species_filter(line, item: Item, species_filter_code: str | None) -> bool:
    """Match against the stored line species when present, else item-name heuristics (legacy lines)."""
    if species_filter_code is None:
        return True
    stored = (getattr(line, "aquaculture_fish_species", "") or "").strip()
    if stored:
        code, _ = normalize_fish_species(stored)
        return (code or "tilapia") == species_filter_code.strip().lower()
    return _vendor_bill_fish_matches_species_filter(item, species_filter_code)


def compute_fish_stock_position_rows(
    company_id: int,
    *,
    pond_id: int | None = None,
    production_cycle_id: int | None = None,
    fish_species_filter: str | None = None,
    include_inactive_ponds: bool = False,
    entries_after_date: date | None = None,
) -> list[dict]:
    """
    Per-pond running totals: transfers in/out, posted vendor fry (pond-tagged fish lines),
    sales, ledger deltas, implied net count & kg.
    When production_cycle_id is set, movements are restricted to that cycle (including transfer lines
    and sales tagged with that production_cycle_id).
    """
    cid = company_id
    species_filter_code: str | None = None
    if fish_species_filter is not None and str(fish_species_filter).strip() != "":
        species_filter_code, _ = normalize_fish_species(fish_species_filter)

    ponds = AquaculturePond.objects.filter(company_id=cid).order_by("sort_order", "id")
    if not include_inactive_ponds:
        ponds = ponds.filter(is_active=True)
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
    if entries_after_date is not None:
        lines_in = lines_in.filter(transfer__transfer_date__gt=entries_after_date)
    for ln in lines_in:
        tp = ln.to_pond_id
        if pond_id is not None and tp != pond_id:
            continue
        if cy_id is not None and ln.to_production_cycle_id != cy_id:
            continue
        if species_filter_code is not None:
            sp, _ = normalize_fish_species(getattr(ln.transfer, "fish_species", None))
            if sp != species_filter_code:
                continue
        in_map_w[tp] += _d(ln.weight_kg)
        if ln.fish_count is not None:
            in_map_c[tp] += int(ln.fish_count)

    lines_out = AquacultureFishPondTransferLine.objects.filter(transfer__company_id=cid).select_related("transfer")
    if entries_after_date is not None:
        lines_out = lines_out.filter(transfer__transfer_date__gt=entries_after_date)
    for ln in lines_out:
        fp = ln.transfer.from_pond_id
        if pond_id is not None and fp != pond_id:
            continue
        if cy_id is not None and ln.transfer.from_production_cycle_id != cy_id:
            continue
        if species_filter_code is not None:
            sp, _ = normalize_fish_species(getattr(ln.transfer, "fish_species", None))
            if sp != species_filter_code:
                continue
        out_map_w[fp] += _d(ln.weight_kg)
        if ln.fish_count is not None:
            out_map_c[fp] += int(ln.fish_count)

    sale_q = AquacultureFishSale.objects.filter(company_id=cid)
    if pond_id is not None:
        sale_q = sale_q.filter(pond_id=pond_id)
    if cy_id is not None:
        sale_q = sale_q.filter(production_cycle_id=cy_id)
    if entries_after_date is not None:
        sale_q = sale_q.filter(sale_date__gt=entries_after_date)

    sale_by_pond: dict[int, tuple[Decimal, int]] = defaultdict(lambda: (Decimal("0"), 0))
    for s in sale_q.only("pond_id", "weight_kg", "fish_count", "income_type", "fish_species", "sale_date"):
        if income_type_is_non_biological_for_company(cid, getattr(s, "income_type", None) or ""):
            continue
        if species_filter_code is not None:
            sp, _ = normalize_fish_species(getattr(s, "fish_species", None))
            if sp != species_filter_code:
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
    if entries_after_date is not None:
        ledger_q = ledger_q.filter(entry_date__gt=entries_after_date)

    ledger_by_pond: dict[int, tuple[Decimal, int]] = defaultdict(lambda: (Decimal("0"), 0))
    mortality_by_pond: dict[int, tuple[Decimal, int]] = defaultdict(lambda: (Decimal("0"), 0))
    adj_in_by_pond: dict[int, tuple[Decimal, int]] = defaultdict(lambda: (Decimal("0"), 0))
    adj_out_by_pond: dict[int, tuple[Decimal, int]] = defaultdict(lambda: (Decimal("0"), 0))
    for row in ledger_q.only("pond_id", "weight_kg_delta", "fish_count_delta", "fish_species", "entry_kind"):
        if species_filter_code is not None:
            sp, _ = normalize_fish_species(getattr(row, "fish_species", None))
            if sp != species_filter_code:
                continue
        pid = row.pond_id
        dw = _d(row.weight_kg_delta)
        dc = int(row.fish_count_delta or 0)
        w, c = ledger_by_pond[pid]
        ledger_by_pond[pid] = (w + dw, c + dc)
        if (row.entry_kind or "").strip() == "loss":
            mw, mc = mortality_by_pond[pid]
            mortality_by_pond[pid] = (mw + dw, mc + dc)
        else:
            is_increase = dc > 0 or (dc == 0 and dw > 0)
            target = adj_in_by_pond if is_increase else adj_out_by_pond
            aw, ac = target[pid]
            target[pid] = (aw + dw, ac + dc)

    bill_in_w: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    bill_in_c: dict[int, int] = defaultdict(int)
    bl_q = (
        BillLine.objects.filter(
            bill__company_id=cid,
            bill__stock_receipt_applied=True,
            aquaculture_pond_id__isnull=False,
            item__isnull=False,
            aquaculture_fish_count__gt=0,
        )
        .filter(item__pos_category__iexact="fish")
        .select_related("item")
    )
    if pond_id is not None:
        bl_q = bl_q.filter(aquaculture_pond_id=pond_id)
    if cy_id is not None:
        bl_q = bl_q.filter(aquaculture_production_cycle_id=cy_id)
    if entries_after_date is not None:
        bl_q = bl_q.filter(bill__bill_date__gt=entries_after_date)
    for ln in bl_q:
        it = ln.item
        if not it or not _bill_line_matches_species_filter(ln, it, species_filter_code):
            continue
        pid = ln.aquaculture_pond_id
        if pid is None:
            continue
        fc = int(ln.aquaculture_fish_count or 0)
        if fc <= 0:
            continue
        wadd = _d(ln.aquaculture_fish_weight_kg) if ln.aquaculture_fish_weight_kg is not None else Decimal("0")
        bill_in_w[pid] += wadd
        bill_in_c[pid] += fc

    latest_sample: dict[int, AquacultureBiomassSample] = {}
    for p in ponds:
        qs = AquacultureBiomassSample.objects.filter(company_id=cid, pond_id=p.id)
        if cy_id is not None:
            qs = qs.filter(production_cycle_id=cy_id)
        if species_filter_code is not None:
            qs = qs.filter(fish_species=species_filter_code)
        if entries_after_date is not None:
            qs = qs.filter(sample_date__gt=entries_after_date)
        s = qs.order_by("-sample_date", "-id").first()
        if s:
            latest_sample[p.id] = s

    out_rows: list[dict] = []
    for p in ponds:
        pid = p.id
        tw = in_map_w[pid] - out_map_w[pid] + bill_in_w[pid]
        tc = in_map_c[pid] - out_map_c[pid] + bill_in_c[pid]
        sw, sc = sale_by_pond[pid]
        tw -= sw
        tc -= sc
        lw, lc = ledger_by_pond[pid]
        tw += lw
        tc += lc
        mort_w, mort_c = mortality_by_pond[pid]
        adj_in_w, adj_in_c = adj_in_by_pond[pid]
        adj_out_w, adj_out_c = adj_out_by_pond[pid]
        # Mirror the breakdown view: "Stocked" is the gross opening inflow (vendor bills +
        # transfer-ins + positive/opening ledger adjustments); "Other adj." is the remaining
        # reductions (transfer-outs + negative adjustments).
        stocked_w = bill_in_w[pid] + in_map_w[pid] + adj_in_w
        stocked_c = bill_in_c[pid] + in_map_c[pid] + adj_in_c
        other_adj_w = adj_out_w - out_map_w[pid]
        other_adj_c = adj_out_c - out_map_c[pid]
        smp = latest_sample.get(pid)
        wa_dec = getattr(p, "water_area_decimal", None)
        depth_ft = getattr(p, "pond_depth_ft", None)
        vol_cu = compute_water_volume_cu_ft(wa_dec, depth_ft)
        role = getattr(p, "pond_role", None) or "grow_out"
        advice = compute_stocking_load_advice(
            tw,
            water_area_decimal=wa_dec,
            water_volume_cu_ft=vol_cu,
            pond_role=role,
        )
        row = {
            "pond_id": pid,
            "pond_name": (p.name or "").strip(),
            "pond_role": role,
            "water_area_decimal": format_pond_area_decimal_for_api(wa_dec),
            "pond_depth_ft": format_two_decimal_places_for_api(depth_ft),
            "water_volume_cu_ft": str(vol_cu) if vol_cu is not None else None,
            "transfer_in_weight_kg": str(_d(in_map_w[pid])),
            "transfer_out_weight_kg": str(_d(out_map_w[pid])),
            "vendor_bill_in_weight_kg": str(_d(bill_in_w[pid])),
            "vendor_bill_in_fish_count": bill_in_c[pid],
            "sale_weight_kg": str(sw),
            "sale_fish_count": sc,
            "ledger_weight_kg_delta": str(lw),
            "ledger_fish_count_delta": lc,
            "stocked_weight_kg": str(stocked_w),
            "stocked_fish_count": stocked_c,
            "mortality_weight_kg": str(mort_w),
            "mortality_fish_count": mort_c,
            "adjustment_weight_kg": str(adj_in_w + adj_out_w),
            "adjustment_fish_count": adj_in_c + adj_out_c,
            "other_adjustment_weight_kg": str(other_adj_w),
            "other_adjustment_fish_count": other_adj_c,
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
            **advice,
        }
        out_rows.append(enrich_position_row_with_fish_metrics(row, water_area_decimal=wa_dec))
    return out_rows


def _position_row_from_bucket(
    p: AquaculturePond,
    *,
    cycle_id: int | None,
    cycle_name: str | None,
    species_code: str,
    species_label: str,
    in_w: Decimal,
    in_c: int,
    out_w: Decimal,
    out_c: int,
    bill_w: Decimal,
    bill_c: int,
    sale_w: Decimal,
    sale_c: int,
    ledger_w: Decimal,
    ledger_c: int,
    smp: AquacultureBiomassSample | None,
    mortality_w: Decimal = Decimal("0"),
    mortality_c: int = 0,
    adjustment_in_w: Decimal = Decimal("0"),
    adjustment_in_c: int = 0,
    adjustment_out_w: Decimal = Decimal("0"),
    adjustment_out_c: int = 0,
) -> dict:
    tw = in_w - out_w + bill_w - sale_w + ledger_w
    tc = in_c - out_c + bill_c - sale_c + ledger_c
    # "Stocked" is the gross opening inflow that established the position before sale/mortality/
    # adjustment events: vendor purchase bills + transfer-ins + positive (opening/stock-in) ledger
    # adjustments. "Other adjustment" then carries the remaining reductions: transfer-outs plus
    # negative manual adjustments. Together: stocked - sold - mortality + other_adjustment = present.
    stocked_w = bill_w + in_w + adjustment_in_w
    stocked_c = bill_c + in_c + adjustment_in_c
    other_adj_w = adjustment_out_w - out_w
    other_adj_c = adjustment_out_c - out_c
    wa_dec = getattr(p, "water_area_decimal", None)
    depth_ft = getattr(p, "pond_depth_ft", None)
    vol_cu = compute_water_volume_cu_ft(wa_dec, depth_ft)
    role = getattr(p, "pond_role", None) or "grow_out"
    advice = compute_stocking_load_advice(
        tw,
        water_area_decimal=wa_dec,
        water_volume_cu_ft=vol_cu,
        pond_role=role,
    )
    base_row = {
        "pond_id": p.id,
        "pond_name": (p.name or "").strip(),
        "pond_role": role,
        "production_cycle_id": cycle_id,
        "production_cycle_name": cycle_name,
        "fish_species": species_code,
        "fish_species_label": species_label,
        "water_area_decimal": format_pond_area_decimal_for_api(wa_dec),
        "pond_depth_ft": format_two_decimal_places_for_api(depth_ft),
        "water_volume_cu_ft": str(vol_cu) if vol_cu is not None else None,
        "transfer_in_weight_kg": str(_d(in_w)),
        "transfer_out_weight_kg": str(_d(out_w)),
        "vendor_bill_in_weight_kg": str(_d(bill_w)),
        "vendor_bill_in_fish_count": bill_c,
        "sale_weight_kg": str(sale_w),
        "sale_fish_count": sale_c,
        "ledger_weight_kg_delta": str(ledger_w),
        "ledger_fish_count_delta": ledger_c,
        "stocked_weight_kg": str(stocked_w),
        "stocked_fish_count": stocked_c,
        "mortality_weight_kg": str(mortality_w),
        "mortality_fish_count": mortality_c,
        "adjustment_weight_kg": str(adjustment_in_w + adjustment_out_w),
        "adjustment_fish_count": adjustment_in_c + adjustment_out_c,
        "other_adjustment_weight_kg": str(other_adj_w),
        "other_adjustment_fish_count": other_adj_c,
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
        **advice,
    }
    return enrich_position_row_with_fish_metrics(base_row, water_area_decimal=wa_dec)


def compute_fish_stock_position_breakdown_rows(
    company_id: int,
    *,
    pond_id: int | None = None,
    production_cycle_id: int | None = None,
    fish_species_filter: str | None = None,
    include_inactive_ponds: bool = False,
    entries_after_date: date | None = None,
) -> list[dict]:
    """
    Per (pond, production cycle, fish species) implied net and components.
    Respects the same pond / cycle / species filters as compute_fish_stock_position_rows.
    """
    cid = company_id
    species_filter_code: str | None = None
    if fish_species_filter is not None and str(fish_species_filter).strip() != "":
        species_filter_code, _ = normalize_fish_species(fish_species_filter)

    cy_id = production_cycle_id

    ponds = list(
        AquaculturePond.objects.filter(company_id=cid).order_by("sort_order", "id")
        if include_inactive_ponds
        else AquaculturePond.objects.filter(company_id=cid, is_active=True).order_by("sort_order", "id")
    )
    if pond_id is not None:
        ponds = [p for p in ponds if p.id == pond_id]
    pond_by_id = {p.id: p for p in ponds}
    if not pond_by_id:
        return []

    in_map_w: dict[StockBucketKey, Decimal] = defaultdict(lambda: Decimal("0"))
    in_map_c: dict[StockBucketKey, int] = defaultdict(int)
    out_map_w: dict[StockBucketKey, Decimal] = defaultdict(lambda: Decimal("0"))
    out_map_c: dict[StockBucketKey, int] = defaultdict(int)
    sale_map: dict[StockBucketKey, tuple[Decimal, int]] = defaultdict(lambda: (Decimal("0"), 0))
    ledger_map: dict[StockBucketKey, tuple[Decimal, int]] = defaultdict(lambda: (Decimal("0"), 0))
    mortality_map: dict[StockBucketKey, tuple[Decimal, int]] = defaultdict(lambda: (Decimal("0"), 0))
    adjustment_in_map: dict[StockBucketKey, tuple[Decimal, int]] = defaultdict(lambda: (Decimal("0"), 0))
    adjustment_out_map: dict[StockBucketKey, tuple[Decimal, int]] = defaultdict(lambda: (Decimal("0"), 0))
    bill_in_w: dict[StockBucketKey, Decimal] = defaultdict(lambda: Decimal("0"))
    bill_in_c: dict[StockBucketKey, int] = defaultdict(int)
    seen: set[StockBucketKey] = set()

    def _track(key: StockBucketKey) -> None:
        seen.add(key)

    def _species_ok(code: str) -> bool:
        return species_filter_code is None or code == species_filter_code

    def _cycle_ok(cycle: int | None) -> bool:
        return cy_id is None or cycle == cy_id

    lines_in = AquacultureFishPondTransferLine.objects.filter(transfer__company_id=cid).select_related("transfer")
    if entries_after_date is not None:
        lines_in = lines_in.filter(transfer__transfer_date__gt=entries_after_date)
    for ln in lines_in:
        tp = ln.to_pond_id
        if tp not in pond_by_id:
            continue
        cyc = ln.to_production_cycle_id
        if not _cycle_ok(cyc):
            continue
        sp, _ = normalize_fish_species(getattr(ln.transfer, "fish_species", None))
        if not _species_ok(sp):
            continue
        key = _stock_bucket_key(tp, cyc, sp)
        _track(key)
        in_map_w[key] += _d(ln.weight_kg)
        if ln.fish_count is not None:
            in_map_c[key] += int(ln.fish_count)

    lines_out = AquacultureFishPondTransferLine.objects.filter(transfer__company_id=cid).select_related("transfer")
    if entries_after_date is not None:
        lines_out = lines_out.filter(transfer__transfer_date__gt=entries_after_date)
    for ln in lines_out:
        fp = ln.transfer.from_pond_id
        if fp not in pond_by_id:
            continue
        cyc = ln.transfer.from_production_cycle_id
        if not _cycle_ok(cyc):
            continue
        sp, _ = normalize_fish_species(getattr(ln.transfer, "fish_species", None))
        if not _species_ok(sp):
            continue
        key = _stock_bucket_key(fp, cyc, sp)
        _track(key)
        out_map_w[key] += _d(ln.weight_kg)
        if ln.fish_count is not None:
            out_map_c[key] += int(ln.fish_count)

    sale_q = AquacultureFishSale.objects.filter(company_id=cid)
    if pond_id is not None:
        sale_q = sale_q.filter(pond_id=pond_id)
    if cy_id is not None:
        sale_q = sale_q.filter(production_cycle_id=cy_id)
    if entries_after_date is not None:
        sale_q = sale_q.filter(sale_date__gt=entries_after_date)
    for s in sale_q.only(
        "pond_id", "production_cycle_id", "weight_kg", "fish_count", "income_type", "fish_species"
    ):
        if s.pond_id not in pond_by_id:
            continue
        if income_type_is_non_biological_for_company(cid, getattr(s, "income_type", None) or ""):
            continue
        sp, _ = normalize_fish_species(getattr(s, "fish_species", None))
        if not _species_ok(sp):
            continue
        cyc = s.production_cycle_id
        if not _cycle_ok(cyc):
            continue
        key = _stock_bucket_key(s.pond_id, cyc, sp)
        _track(key)
        w, c = sale_map[key]
        fc = int(s.fish_count) if s.fish_count is not None else 0
        sale_map[key] = (w + _d(s.weight_kg), c + fc)

    ledger_q = AquacultureFishStockLedger.objects.filter(company_id=cid)
    if pond_id is not None:
        ledger_q = ledger_q.filter(pond_id=pond_id)
    if cy_id is not None:
        ledger_q = ledger_q.filter(production_cycle_id=cy_id)
    if entries_after_date is not None:
        ledger_q = ledger_q.filter(entry_date__gt=entries_after_date)
    for row in ledger_q.only(
        "pond_id", "production_cycle_id", "weight_kg_delta", "fish_count_delta", "fish_species", "entry_kind"
    ):
        if row.pond_id not in pond_by_id:
            continue
        sp, _ = normalize_fish_species(getattr(row, "fish_species", None))
        if not _species_ok(sp):
            continue
        cyc = row.production_cycle_id
        if not _cycle_ok(cyc):
            continue
        key = _stock_bucket_key(row.pond_id, cyc, sp)
        _track(key)
        dw = _d(row.weight_kg_delta)
        dc = int(row.fish_count_delta or 0)
        w, c = ledger_map[key]
        ledger_map[key] = (w + dw, c + dc)
        is_loss = (row.entry_kind or "").strip() == "loss"
        if is_loss:
            mw, mc = mortality_map[key]
            mortality_map[key] = (mw + dw, mc + dc)
        else:
            # Positive manual adjustments are opening/stock-in (count STOCKED); negatives are
            # reductions (count Other adj.). Classify by count, falling back to weight when count is 0.
            is_increase = dc > 0 or (dc == 0 and dw > 0)
            target = adjustment_in_map if is_increase else adjustment_out_map
            aw, ac = target[key]
            target[key] = (aw + dw, ac + dc)

    bl_q = (
        BillLine.objects.filter(
            bill__company_id=cid,
            bill__stock_receipt_applied=True,
            aquaculture_pond_id__isnull=False,
            item__isnull=False,
            aquaculture_fish_count__gt=0,
        )
        .filter(item__pos_category__iexact="fish")
        .select_related("item")
    )
    if pond_id is not None:
        bl_q = bl_q.filter(aquaculture_pond_id=pond_id)
    if cy_id is not None:
        bl_q = bl_q.filter(aquaculture_production_cycle_id=cy_id)
    if entries_after_date is not None:
        bl_q = bl_q.filter(bill__bill_date__gt=entries_after_date)
    for ln in bl_q:
        pid = ln.aquaculture_pond_id
        if pid is None or pid not in pond_by_id:
            continue
        it = ln.item
        if not it:
            continue
        sp = _bill_line_species_code(ln, it)
        if not _bill_line_matches_species_filter(ln, it, species_filter_code):
            continue
        if not _species_ok(sp):
            continue
        cyc = ln.aquaculture_production_cycle_id
        if not _cycle_ok(cyc):
            continue
        key = _stock_bucket_key(pid, cyc, sp)
        _track(key)
        fc = int(ln.aquaculture_fish_count or 0)
        wadd = _d(ln.aquaculture_fish_weight_kg) if ln.aquaculture_fish_weight_kg is not None else Decimal("0")
        bill_in_w[key] += wadd
        bill_in_c[key] += fc

    latest_sample: dict[StockBucketKey, AquacultureBiomassSample] = {}
    pond_species_sample: dict[tuple[int, str], AquacultureBiomassSample] = {}
    smp_q = AquacultureBiomassSample.objects.filter(company_id=cid, pond_id__in=pond_by_id.keys())
    if species_filter_code is not None:
        smp_q = smp_q.filter(fish_species=species_filter_code)
    if entries_after_date is not None:
        smp_q = smp_q.filter(sample_date__gt=entries_after_date)
    for s in smp_q.order_by("pond_id", "production_cycle_id", "fish_species", "-sample_date", "-id"):
        sp, _ = normalize_fish_species(getattr(s, "fish_species", None))
        if not _species_ok(sp):
            continue
        ps_key = (s.pond_id, sp)
        if ps_key not in pond_species_sample:
            pond_species_sample[ps_key] = s
        cyc = s.production_cycle_id
        if not _cycle_ok(cyc):
            continue
        key = _stock_bucket_key(s.pond_id, cyc, sp)
        if key not in latest_sample:
            latest_sample[key] = s
            _track(key)

    cycle_ids = {k[1] for k in seen if k[1] is not None}
    cycle_names: dict[int, str] = {}
    if cycle_ids:
        for cy in AquacultureProductionCycle.objects.filter(company_id=cid, pk__in=cycle_ids).only("id", "name"):
            cycle_names[cy.id] = (cy.name or "").strip() or f"Cycle #{cy.id}"

    def _row_sort_key(key: StockBucketKey) -> tuple:
        pid, cyc, sp = key
        p = pond_by_id[pid]
        sort_p = (getattr(p, "sort_order", 0) or 0, pid)
        cname = cycle_names.get(cyc, "") if cyc is not None else "\uffff"
        return (sort_p, cname, sp)

    out_rows: list[dict] = []
    for key in sorted(seen, key=_row_sort_key):
        pid, cyc, sp = key
        p = pond_by_id[pid]
        sw, sc = sale_map[key]
        lw, lc = ledger_map[key]
        mort_w, mort_c = mortality_map[key]
        adj_in_w, adj_in_c = adjustment_in_map[key]
        adj_out_w, adj_out_c = adjustment_out_map[key]
        smp = latest_sample.get(key) or pond_species_sample.get((pid, sp))
        cname = cycle_names.get(cyc) if cyc is not None else None
        out_rows.append(
            _position_row_from_bucket(
                p,
                cycle_id=cyc,
                cycle_name=cname,
                species_code=sp,
                species_label=fish_species_display_label(sp, None),
                in_w=in_map_w[key],
                in_c=in_map_c[key],
                out_w=out_map_w[key],
                out_c=out_map_c[key],
                bill_w=bill_in_w[key],
                bill_c=bill_in_c[key],
                sale_w=sw,
                sale_c=sc,
                ledger_w=lw,
                ledger_c=lc,
                mortality_w=mort_w,
                mortality_c=mort_c,
                adjustment_in_w=adj_in_w,
                adjustment_in_c=adj_in_c,
                adjustment_out_w=adj_out_w,
                adjustment_out_c=adj_out_c,
                smp=smp,
            )
        )
    return out_rows


def _enrich_stock_row_with_sample_reference(
    company_id: int,
    pond_id: int,
    *,
    production_cycle_id: int | None,
    fish_species: str,
    row: dict,
) -> dict:
    """Attach latest same-site biomass sample when the cycle bucket has no seine data."""
    has_sample = bool(
        row.get("latest_sample_avg_weight_kg")
        or (
            row.get("latest_sample_estimated_fish_count") is not None
            and row.get("latest_sample_estimated_total_weight_kg")
        )
        or row.get("current_fish_per_kg")
    )
    if has_sample:
        return row
    ref = last_biomass_sample_reference_for_ledger(
        company_id,
        pond_id=pond_id,
        production_cycle_id=production_cycle_id,
        fish_species=fish_species,
    )
    if not ref:
        return row
    out = dict(row)
    out["latest_sample_date"] = ref.get("sample_date")
    out["latest_sample_estimated_fish_count"] = ref.get("estimated_fish_count")
    out["latest_sample_estimated_total_weight_kg"] = ref.get("estimated_total_weight_kg")
    if ref.get("avg_weight_kg"):
        out["latest_sample_avg_weight_kg"] = ref["avg_weight_kg"]
    if ref.get("fish_per_kg"):
        out["current_fish_per_kg"] = ref["fish_per_kg"]
    return out


def implied_fish_stock_for_outbound_scope(
    company_id: int,
    pond_id: int,
    *,
    production_cycle_id: int | None,
    fish_species: str,
) -> tuple[int, Decimal]:
    """Implied net fish count and kg for outbound validation (pond / cycle / species scope)."""
    sp_code, _ = normalize_fish_species(fish_species)
    rows = compute_fish_stock_position_breakdown_rows(
        company_id,
        pond_id=pond_id,
        production_cycle_id=production_cycle_id,
        fish_species_filter=sp_code,
    )
    if rows:
        r = _enrich_stock_row_with_sample_reference(
            company_id,
            pond_id,
            production_cycle_id=production_cycle_id,
            fish_species=fish_species,
            row=rows[0],
        )
        return (
            int(r.get("implied_net_fish_count") or 0),
            effective_biomass_kg_from_position_row(r),
        )
    rows_pond = compute_fish_stock_position_rows(
        company_id,
        pond_id=pond_id,
        production_cycle_id=production_cycle_id,
        fish_species_filter=sp_code,
    )
    if rows_pond:
        r = _enrich_stock_row_with_sample_reference(
            company_id,
            pond_id,
            production_cycle_id=production_cycle_id,
            fish_species=fish_species,
            row=rows_pond[0],
        )
        return (
            int(r.get("implied_net_fish_count") or 0),
            effective_biomass_kg_from_position_row(r),
        )
    return 0, Decimal("0")


def _outbound_totals_from_transfer(
    company_id: int,
    transfer_id: int,
    from_pond_id: int,
) -> tuple[int, Decimal]:
    lines = AquacultureFishPondTransferLine.objects.filter(
        transfer_id=transfer_id,
        transfer__company_id=company_id,
        transfer__from_pond_id=from_pond_id,
    )
    fish = sum(int(ln.fish_count or 0) for ln in lines)
    kg = sum((_d(ln.weight_kg) for ln in lines), Decimal("0"))
    return fish, kg


def _outbound_totals_from_sale(
    company_id: int,
    sale_id: int,
) -> tuple[int, Decimal] | None:
    s = AquacultureFishSale.objects.filter(pk=sale_id, company_id=company_id).only(
        "fish_count", "weight_kg", "income_type"
    ).first()
    if not s:
        return None
    if income_type_is_non_biological_for_company(company_id, getattr(s, "income_type", None) or ""):
        return None
    if s.fish_count is None or s.fish_count <= 0:
        return None
    return int(s.fish_count), _d(s.weight_kg)


def assert_outbound_fish_within_implied_stock(
    company_id: int,
    pond_id: int,
    *,
    production_cycle_id: int | None,
    fish_species: str,
    fish_count: int,
    weight_kg: Decimal,
    exclude_transfer_id: int | None = None,
    exclude_sale_id: int | None = None,
) -> str | None:
    """
    Return a user-facing error when an outbound movement exceeds implied stock; None if OK.
    Used for inter-pond transfers and biological harvest sales (dual-unit check).
    """
    if fish_count <= 0 or weight_kg <= 0:
        return None
    avail_c, avail_w = implied_fish_stock_for_outbound_scope(
        company_id,
        pond_id,
        production_cycle_id=production_cycle_id,
        fish_species=fish_species,
    )
    if exclude_transfer_id is not None:
        exc_c, exc_w = _outbound_totals_from_transfer(company_id, exclude_transfer_id, pond_id)
        avail_c += exc_c
        avail_w += exc_w
    if exclude_sale_id is not None:
        exc = _outbound_totals_from_sale(company_id, exclude_sale_id)
        if exc is not None:
            avail_c += exc[0]
            avail_w += exc[1]
    if fish_count <= avail_c and weight_kg <= avail_w:
        return None
    scope = "this production cycle" if production_cycle_id else "this pond"
    if fish_count <= avail_c and weight_kg > avail_w:
        return (
            f"Insufficient biomass on source {scope} for this transfer weight: "
            f"{avail_w} kg estimated from book stock and latest sampling ({avail_c:,} fish); "
            f"this transaction requires {weight_kg} kg ({fish_count:,} fish). "
            "Reduce head count or weight, record a biomass sample, or verify fry stocking."
        )
    return (
        f"Insufficient fish stock on source {scope}: "
        f"{avail_w} kg ({avail_c:,} fish) available after prior movements; "
        f"this transaction requires {weight_kg} kg ({fish_count:,} fish). "
        "Reduce quantities, record a stock adjustment, or verify fry stocking and transfers."
    )
