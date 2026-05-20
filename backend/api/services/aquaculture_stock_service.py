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
    AquacultureProductionCycle,
    BillLine,
    Item,
)
from api.services.aquaculture_constants import fish_species_display_label, normalize_fish_species
from api.services.tenant_reporting_categories import income_type_is_non_biological_for_company
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


def compute_fish_stock_position_rows(
    company_id: int,
    *,
    pond_id: int | None = None,
    production_cycle_id: int | None = None,
    fish_species_filter: str | None = None,
    include_inactive_ponds: bool = False,
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

    sale_by_pond: dict[int, tuple[Decimal, int]] = defaultdict(lambda: (Decimal("0"), 0))
    for s in sale_q.only("pond_id", "weight_kg", "fish_count", "income_type", "fish_species"):
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

    ledger_by_pond: dict[int, tuple[Decimal, int]] = defaultdict(lambda: (Decimal("0"), 0))
    for row in ledger_q.only("pond_id", "weight_kg_delta", "fish_count_delta", "fish_species"):
        if species_filter_code is not None:
            sp, _ = normalize_fish_species(getattr(row, "fish_species", None))
            if sp != species_filter_code:
                continue
        pid = row.pond_id
        w, c = ledger_by_pond[pid]
        ledger_by_pond[pid] = (w + _d(row.weight_kg_delta), c + int(row.fish_count_delta or 0))

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
    for ln in bl_q:
        it = ln.item
        if not it or not _vendor_bill_fish_matches_species_filter(it, species_filter_code):
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
        out_rows.append(row)
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
) -> dict:
    tw = in_w - out_w + bill_w - sale_w + ledger_w
    tc = in_c - out_c + bill_c - sale_c + ledger_c
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
    return {
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


def compute_fish_stock_position_breakdown_rows(
    company_id: int,
    *,
    pond_id: int | None = None,
    production_cycle_id: int | None = None,
    fish_species_filter: str | None = None,
    include_inactive_ponds: bool = False,
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
    for row in ledger_q.only(
        "pond_id", "production_cycle_id", "weight_kg_delta", "fish_count_delta", "fish_species"
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
        w, c = ledger_map[key]
        ledger_map[key] = (w + _d(row.weight_kg_delta), c + int(row.fish_count_delta or 0))

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
    for ln in bl_q:
        pid = ln.aquaculture_pond_id
        if pid is None or pid not in pond_by_id:
            continue
        it = ln.item
        if not it:
            continue
        sp = _infer_fish_species_code_from_fish_item(it)
        if not _vendor_bill_fish_matches_species_filter(it, species_filter_code):
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
    smp_q = AquacultureBiomassSample.objects.filter(company_id=cid, pond_id__in=pond_by_id.keys())
    if cy_id is not None:
        smp_q = smp_q.filter(production_cycle_id=cy_id)
    if species_filter_code is not None:
        smp_q = smp_q.filter(fish_species=species_filter_code)
    for s in smp_q.order_by("pond_id", "production_cycle_id", "fish_species", "-sample_date", "-id"):
        sp, _ = normalize_fish_species(getattr(s, "fish_species", None))
        if not _species_ok(sp):
            continue
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
        smp = latest_sample.get(key)
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
                smp=smp,
            )
        )
    return out_rows
