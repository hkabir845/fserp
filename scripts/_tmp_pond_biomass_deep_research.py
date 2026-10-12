"""Deep research: all ponds biomass — stocking, transfers, harvest, sampling, present stock."""
from __future__ import annotations

import json
import os
import sys
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

# Prefer: python manage.py shell -c "import runpy; runpy.run_path(r'scripts/_tmp_pond_biomass_deep_research.py')"
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
os.environ.setdefault("FSERP_USE_SQLITE", "0")

import django
from django.apps import apps

if not apps.ready:
    django.setup()

from api.models import (  # noqa: E402
    AquacultureBiomassSample,
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquacultureFishSale,
    AquacultureFishStockLedger,
    AquaculturePond,
    AquacultureProductionCycle,
    BillLine,
)
from api.services.aquaculture_partial_harvest import (  # noqa: E402
    effective_biomass_kg_from_position_row,
    sample_mean_weight_kg_from_fields,
)
from api.services.aquaculture_stock_service import (  # noqa: E402
    compute_fish_stock_position_breakdown_rows,
    compute_fish_stock_position_rows,
)
from api.services.tenant_reporting_categories import (  # noqa: E402
    income_type_is_non_biological_for_company,
)

CID = 2
AS_OF = date.today()
OUT = ROOT / "scripts" / "_tmp_pond_biomass_deep_research.json"


def D(v) -> Decimal:
    if v is None or v == "":
        return Decimal("0")
    return Decimal(str(v))


def q4(v: Decimal) -> str:
    return str(v.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP))


def q2(v: Decimal) -> str:
    return str(v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def main() -> None:
    ponds = list(
        AquaculturePond.objects.filter(company_id=CID, is_active=True).order_by("sort_order", "id")
    )
    pond_ids = [p.id for p in ponds]
    cycles = list(
        AquacultureProductionCycle.objects.filter(company_id=CID, pond_id__in=pond_ids).order_by(
            "pond_id", "id"
        )
    )
    cycle_by_id = {c.id: c for c in cycles}

    # --- Raw movements ---
    bill_lines = list(
        BillLine.objects.filter(
            bill__company_id=CID,
            bill__stock_receipt_applied=True,
            aquaculture_pond_id__in=pond_ids,
            item__isnull=False,
            aquaculture_fish_count__gt=0,
            item__pos_category__iexact="fish",
        )
        .select_related("bill", "item", "aquaculture_pond")
        .order_by("bill__bill_date", "id")
    )
    transfers = list(
        AquacultureFishPondTransfer.objects.filter(company_id=CID)
        .filter(from_pond_id__in=pond_ids)
        .select_related("from_pond")
        .prefetch_related("lines", "lines__to_pond")
        .order_by("transfer_date", "id")
    )
    # also transfers INTO our ponds from elsewhere
    transfer_lines_in = list(
        AquacultureFishPondTransferLine.objects.filter(
            transfer__company_id=CID, to_pond_id__in=pond_ids
        )
        .select_related("transfer", "transfer__from_pond", "to_pond")
        .order_by("transfer__transfer_date", "id")
    )
    sales = list(
        AquacultureFishSale.objects.filter(company_id=CID, pond_id__in=pond_ids)
        .select_related("pond")
        .order_by("sale_date", "id")
    )
    ledger = list(
        AquacultureFishStockLedger.objects.filter(company_id=CID, pond_id__in=pond_ids)
        .select_related("pond")
        .order_by("entry_date", "id")
    )
    samples = list(
        AquacultureBiomassSample.objects.filter(company_id=CID, pond_id__in=pond_ids)
        .select_related("pond", "production_cycle")
        .order_by("pond_id", "sample_date", "id")
    )

    # Position rows (system of record)
    pos_rows = compute_fish_stock_position_rows(CID, include_inactive_ponds=False)
    brk_rows = compute_fish_stock_position_breakdown_rows(
        CID, include_inactive_ponds=False, as_of_date=AS_OF
    )

    # Independent math check per pond (manual ledger identity)
    issues: list[dict] = []
    pond_reports: list[dict] = []

    for p in ponds:
        pid = p.id
        # bills
        p_bills = [b for b in bill_lines if b.aquaculture_pond_id == pid]
        bill_n = sum(int(b.aquaculture_fish_count or 0) for b in p_bills)
        bill_w = sum((D(b.aquaculture_fish_weight_kg) for b in p_bills), Decimal("0"))

        # transfer in
        p_tin = [ln for ln in transfer_lines_in if ln.to_pond_id == pid]
        tin_n = sum(int(ln.fish_count or 0) for ln in p_tin)
        tin_w = sum((D(ln.weight_kg) for ln in p_tin), Decimal("0"))

        # transfer out
        p_tout_lines = []
        for tr in transfers:
            if tr.from_pond_id != pid:
                continue
            for ln in tr.lines.all():
                p_tout_lines.append((tr, ln))
        tout_n = sum(int(ln.fish_count or 0) for _, ln in p_tout_lines)
        tout_w = sum((D(ln.weight_kg) for _, ln in p_tout_lines), Decimal("0"))

        # sales (bio only)
        p_sales = [
            s
            for s in sales
            if s.pond_id == pid
            and not income_type_is_non_biological_for_company(CID, getattr(s, "income_type", "") or "")
        ]
        sale_n = sum(int(s.fish_count or 0) for s in p_sales)
        sale_w = sum((D(s.weight_kg) for s in p_sales), Decimal("0"))

        # ledger
        p_led = [r for r in ledger if r.pond_id == pid]
        led_n = sum(int(r.fish_count_delta or 0) for r in p_led)
        led_w = sum((D(r.weight_kg_delta) for r in p_led), Decimal("0"))
        mort = [r for r in p_led if (r.entry_kind or "").strip() == "loss"]
        mort_n = sum(int(r.fish_count_delta or 0) for r in mort)
        mort_w = sum((D(r.weight_kg_delta) for r in mort), Decimal("0"))

        # identity: net = bill + tin - tout - sale + ledger
        calc_n = bill_n + tin_n - tout_n - sale_n + led_n
        calc_w = bill_w + tin_w - tout_w - sale_w + led_w

        pos = next((r for r in pos_rows if r["pond_id"] == pid), None)
        sys_n = int(pos["implied_net_fish_count"]) if pos else None
        sys_w = D(pos["implied_net_weight_kg"]) if pos else None
        eff = effective_biomass_kg_from_position_row(pos) if pos else Decimal("0")

        if pos and (sys_n != calc_n or abs(sys_w - calc_w) > Decimal("0.0001")):
            issues.append(
                {
                    "severity": "error",
                    "pond_id": pid,
                    "pond_name": p.name,
                    "code": "position_identity_mismatch",
                    "detail": (
                        f"Manual calc n={calc_n} w={q4(calc_w)} vs system n={sys_n} w={q4(sys_w)}"
                    ),
                }
            )

        # breakdown sum should match pond position (heads); biomass uses per-species samples
        p_brk = [r for r in brk_rows if r["pond_id"] == pid]
        brk_n = sum(int(r.get("implied_net_fish_count") or 0) for r in p_brk)
        brk_book_w = sum((D(r.get("implied_net_weight_kg")) for r in p_brk), Decimal("0"))
        brk_eff = sum((effective_biomass_kg_from_position_row(r) for r in p_brk), Decimal("0"))

        if pos and brk_n != sys_n:
            issues.append(
                {
                    "severity": "error",
                    "pond_id": pid,
                    "pond_name": p.name,
                    "code": "breakdown_vs_pond_heads",
                    "detail": f"breakdown heads {brk_n} != pond heads {sys_n}",
                }
            )

        # samples analysis
        p_samp = [s for s in samples if s.pond_id == pid]
        standing = [
            s
            for s in p_samp
            if s.source_fish_pond_transfer_id is None
            and s.source_bill_line_id is None
            and s.source_fish_pond_transfer_line_id is None
        ]
        lot = [s for s in p_samp if s not in standing]

        sample_flags: list[dict] = []
        for s in p_samp:
            mean = sample_mean_weight_kg_from_fields(
                fish_count=s.estimated_fish_count,
                total_weight_kg=s.estimated_total_weight_kg,
                avg_weight_kg=s.avg_weight_kg,
            )
            stored_avg = D(s.avg_weight_kg) if s.avg_weight_kg is not None else None
            if mean is not None and stored_avg is not None and stored_avg > 0:
                # flag if stored avg diverges > 5% from seine mean
                if abs(mean - stored_avg) / mean > Decimal("0.05"):
                    sample_flags.append(
                        {
                            "sample_id": s.id,
                            "date": s.sample_date.isoformat(),
                            "issue": "avg_vs_seine_mean",
                            "seine_mean_kg": q4(mean),
                            "stored_avg_kg": q4(stored_avg),
                            "species": s.fish_species,
                        }
                    )
            # extrapolation check
            if (
                s.stock_reference_fish_count
                and s.stock_reference_fish_count > 0
                and mean is not None
                and s.extrapolated_biomass_kg is not None
            ):
                expect = (mean * Decimal(int(s.stock_reference_fish_count))).quantize(
                    Decimal("0.0001"), rounding=ROUND_HALF_UP
                )
                if abs(expect - D(s.extrapolated_biomass_kg)) > Decimal("0.01"):
                    sample_flags.append(
                        {
                            "sample_id": s.id,
                            "date": s.sample_date.isoformat(),
                            "issue": "extrapolation_mismatch",
                            "expected_kg": q4(expect),
                            "stored_kg": q4(D(s.extrapolated_biomass_kg)),
                            "species": s.fish_species,
                        }
                    )
            # suspicious avg: > 5 kg/fish for tilapia grow-out is unusual; > 0.5 for fingerling nursing
            if mean is not None:
                if (s.fish_species or "tilapia") == "tilapia" and mean > Decimal("3"):
                    sample_flags.append(
                        {
                            "sample_id": s.id,
                            "date": s.sample_date.isoformat(),
                            "issue": "suspicious_large_avg_weight",
                            "mean_kg": q4(mean),
                            "species": s.fish_species,
                            "seine_n": s.estimated_fish_count,
                            "seine_kg": str(s.estimated_total_weight_kg),
                        }
                    )
                if mean > 0 and (1 / mean) > Decimal("5000"):
                    sample_flags.append(
                        {
                            "sample_id": s.id,
                            "date": s.sample_date.isoformat(),
                            "issue": "suspicious_tiny_avg_weight",
                            "mean_kg": q4(mean),
                            "pcs_per_kg": q2(Decimal("1") / mean),
                            "species": s.fish_species,
                        }
                    )

        for f in sample_flags:
            issues.append(
                {
                    "severity": "warn",
                    "pond_id": pid,
                    "pond_name": p.name,
                    "code": f["issue"],
                    "detail": json.dumps(f, ensure_ascii=False),
                }
            )

        # book vs effective gap
        book_w = sys_w or Decimal("0")
        if abs(eff - book_w) > Decimal("1") and (sys_n or 0) > 0:
            ratio = (eff / book_w) if book_w > 0 else None
            issues.append(
                {
                    "severity": "info",
                    "pond_id": pid,
                    "pond_name": p.name,
                    "code": "book_vs_effective_biomass",
                    "detail": (
                        f"book={q2(book_w)} kg vs effective(sample×heads)={q2(eff)} kg "
                        f"(ratio={q2(ratio) if ratio is not None else 'n/a'}); "
                        f"heads={sys_n}; latest_sample={pos.get('latest_sample_date') if pos else None}"
                    ),
                }
            )

        # negative stock
        if (sys_n or 0) < 0 or (sys_w or Decimal("0")) < 0:
            issues.append(
                {
                    "severity": "error",
                    "pond_id": pid,
                    "pond_name": p.name,
                    "code": "negative_stock",
                    "detail": f"n={sys_n} book_w={q4(sys_w or Decimal(0))}",
                }
            )

        latest_standing = standing[-1] if standing else None
        latest_any = p_samp[-1] if p_samp else None

        pond_reports.append(
            {
                "pond_id": pid,
                "pond_name": p.name,
                "pond_role": p.pond_role,
                "water_area_decimal": str(p.water_area_decimal) if p.water_area_decimal is not None else None,
                "physical_site_name": getattr(p, "physical_site_name", None) or "",
                "cycles": [
                    {
                        "id": c.id,
                        "code": c.code,
                        "name": c.name,
                        "start": c.start_date.isoformat() if c.start_date else None,
                        "active": c.is_active,
                    }
                    for c in cycles
                    if c.pond_id == pid
                ],
                "fingerling_purchase": {
                    "lines": len(p_bills),
                    "fish_count": bill_n,
                    "weight_kg": q4(bill_w),
                    "events": [
                        {
                            "date": b.bill.bill_date.isoformat(),
                            "bill_id": b.bill_id,
                            "item": (b.item.name if b.item else ""),
                            "species": getattr(b, "aquaculture_fish_species", "") or "",
                            "count": int(b.aquaculture_fish_count or 0),
                            "weight_kg": q4(D(b.aquaculture_fish_weight_kg)),
                            "cycle_id": b.aquaculture_production_cycle_id,
                        }
                        for b in p_bills
                    ],
                },
                "transfer_in": {
                    "lines": len(p_tin),
                    "fish_count": tin_n,
                    "weight_kg": q4(tin_w),
                    "events": [
                        {
                            "date": ln.transfer.transfer_date.isoformat(),
                            "transfer_id": ln.transfer_id,
                            "from_pond": ln.transfer.from_pond.name if ln.transfer.from_pond else "",
                            "from_pond_id": ln.transfer.from_pond_id,
                            "species": ln.transfer.fish_species,
                            "count": int(ln.fish_count or 0),
                            "weight_kg": q4(D(ln.weight_kg)),
                            "to_cycle_id": ln.to_production_cycle_id,
                        }
                        for ln in p_tin
                    ],
                },
                "transfer_out": {
                    "lines": len(p_tout_lines),
                    "fish_count": tout_n,
                    "weight_kg": q4(tout_w),
                    "events": [
                        {
                            "date": tr.transfer_date.isoformat(),
                            "transfer_id": tr.id,
                            "to_pond": ln.to_pond.name if ln.to_pond else "",
                            "to_pond_id": ln.to_pond_id,
                            "species": tr.fish_species,
                            "count": int(ln.fish_count or 0),
                            "weight_kg": q4(D(ln.weight_kg)),
                            "from_cycle_id": tr.from_production_cycle_id,
                        }
                        for tr, ln in p_tout_lines
                    ],
                },
                "harvest_sales": {
                    "rows": len(p_sales),
                    "fish_count": sale_n,
                    "weight_kg": q4(sale_w),
                    "events": [
                        {
                            "date": s.sale_date.isoformat(),
                            "id": s.id,
                            "income_type": s.income_type,
                            "species": s.fish_species,
                            "count": int(s.fish_count or 0),
                            "weight_kg": q4(D(s.weight_kg)),
                            "amount": str(s.amount) if getattr(s, "amount", None) is not None else "",
                            "cycle_id": s.production_cycle_id,
                        }
                        for s in p_sales
                    ],
                },
                "ledger": {
                    "rows": len(p_led),
                    "fish_count_delta": led_n,
                    "weight_kg_delta": q4(led_w),
                    "mortality_fish_count_delta": mort_n,
                    "mortality_weight_kg_delta": q4(mort_w),
                    "events": [
                        {
                            "date": r.entry_date.isoformat(),
                            "id": r.id,
                            "kind": r.entry_kind,
                            "loss_reason": getattr(r, "loss_reason", "") or "",
                            "species": r.fish_species,
                            "count_delta": int(r.fish_count_delta or 0),
                            "weight_kg_delta": q4(D(r.weight_kg_delta)),
                            "memo": (r.memo or "")[:120],
                            "cycle_id": r.production_cycle_id,
                        }
                        for r in p_led
                    ],
                },
                "sampling": {
                    "total_rows": len(p_samp),
                    "standing_rows": len(standing),
                    "lot_rows": len(lot),
                    "latest_standing": (
                        {
                            "id": latest_standing.id,
                            "date": latest_standing.sample_date.isoformat(),
                            "species": latest_standing.fish_species,
                            "seine_n": latest_standing.estimated_fish_count,
                            "seine_kg": str(latest_standing.estimated_total_weight_kg)
                            if latest_standing.estimated_total_weight_kg is not None
                            else None,
                            "avg_kg": str(latest_standing.avg_weight_kg)
                            if latest_standing.avg_weight_kg is not None
                            else None,
                            "ref_n": latest_standing.stock_reference_fish_count,
                            "extrap_kg": str(latest_standing.extrapolated_biomass_kg)
                            if latest_standing.extrapolated_biomass_kg is not None
                            else None,
                            "cycle_id": latest_standing.production_cycle_id,
                        }
                        if latest_standing
                        else None
                    ),
                    "flags": sample_flags,
                    "timeline": [
                        {
                            "id": s.id,
                            "date": s.sample_date.isoformat(),
                            "species": s.fish_species,
                            "kind": (
                                "lot_bill"
                                if s.source_bill_line_id
                                else (
                                    "lot_xfer"
                                    if (
                                        s.source_fish_pond_transfer_line_id
                                        or s.source_fish_pond_transfer_id
                                    )
                                    else "standing"
                                )
                            ),
                            "seine_n": s.estimated_fish_count,
                            "seine_kg": str(s.estimated_total_weight_kg)
                            if s.estimated_total_weight_kg is not None
                            else None,
                            "mean_kg": (
                                q4(
                                    sample_mean_weight_kg_from_fields(
                                        fish_count=s.estimated_fish_count,
                                        total_weight_kg=s.estimated_total_weight_kg,
                                        avg_weight_kg=s.avg_weight_kg,
                                    )
                                    or Decimal("0")
                                )
                                if sample_mean_weight_kg_from_fields(
                                    fish_count=s.estimated_fish_count,
                                    total_weight_kg=s.estimated_total_weight_kg,
                                    avg_weight_kg=s.avg_weight_kg,
                                )
                                else None
                            ),
                            "ref_n": s.stock_reference_fish_count,
                            "extrap_kg": str(s.extrapolated_biomass_kg)
                            if s.extrapolated_biomass_kg is not None
                            else None,
                            "cycle_id": s.production_cycle_id,
                        }
                        for s in p_samp
                    ],
                },
                "present_stock": {
                    "as_of": AS_OF.isoformat(),
                    "book_fish_count": sys_n,
                    "book_weight_kg": q4(sys_w) if sys_w is not None else None,
                    "effective_biomass_kg": q4(eff),
                    "manual_identity_fish_count": calc_n,
                    "manual_identity_weight_kg": q4(calc_w),
                    "identity_ok": pos is not None and sys_n == calc_n and abs((sys_w or 0) - calc_w) <= Decimal(
                        "0.0001"
                    ),
                    "breakdown_heads": brk_n,
                    "breakdown_book_kg": q4(brk_book_w),
                    "breakdown_effective_kg": q4(brk_eff),
                    "latest_sample_date": pos.get("latest_sample_date") if pos else None,
                    "latest_sample_avg_kg": pos.get("latest_sample_avg_weight_kg") if pos else None,
                    "stock_density_kg_per_decimal": pos.get("stock_density_kg_per_decimal") if pos else None,
                    "load_level": pos.get("load_level") if pos else None,
                },
                "breakdown": [
                    {
                        "cycle_id": r.get("production_cycle_id"),
                        "cycle_name": r.get("production_cycle_name"),
                        "species": r.get("fish_species"),
                        "heads": int(r.get("implied_net_fish_count") or 0),
                        "book_kg": q4(D(r.get("implied_net_weight_kg"))),
                        "eff_kg": q4(effective_biomass_kg_from_position_row(r)),
                        "sample_date": r.get("latest_sample_date"),
                        "sample_avg_kg": r.get("latest_sample_avg_weight_kg"),
                        "vendor_n": int(r.get("vendor_bill_in_fish_count") or 0),
                        "tin_n": int(r.get("transfer_in_fish_count") or 0)
                        if "transfer_in_fish_count" in r
                        else None,
                        "tout_n": int(r.get("transfer_out_fish_count") or 0)
                        if "transfer_out_fish_count" in r
                        else None,
                        "sale_n": int(r.get("sale_fish_count") or 0),
                        "sale_kg": q4(D(r.get("sale_weight_kg"))),
                    }
                    for r in p_brk
                    if int(r.get("implied_net_fish_count") or 0) != 0
                    or D(r.get("implied_net_weight_kg")) != 0
                    or int(r.get("sale_fish_count") or 0) != 0
                    or int(r.get("vendor_bill_in_fish_count") or 0) != 0
                ],
            }
        )

    # Company-wide totals & transfer conservation
    total_bill_n = sum(int(b.aquaculture_fish_count or 0) for b in bill_lines)
    total_sale_n = sum(
        int(s.fish_count or 0)
        for s in sales
        if not income_type_is_non_biological_for_company(CID, getattr(s, "income_type", "") or "")
    )
    total_sale_w = sum(
        (
            D(s.weight_kg)
            for s in sales
            if not income_type_is_non_biological_for_company(CID, getattr(s, "income_type", "") or "")
        ),
        Decimal("0"),
    )
    total_pos_n = sum(int(r["implied_net_fish_count"] or 0) for r in pos_rows)
    total_pos_book = sum((D(r["implied_net_weight_kg"]) for r in pos_rows), Decimal("0"))
    total_pos_eff = sum((effective_biomass_kg_from_position_row(r) for r in pos_rows), Decimal("0"))

    # Transfer conservation: every line out weight/count should equal line in
    xfer_issues = []
    for tr in AquacultureFishPondTransfer.objects.filter(company_id=CID).prefetch_related("lines"):
        for ln in tr.lines.all():
            if ln.fish_count is None or ln.weight_kg is None:
                xfer_issues.append(
                    {
                        "severity": "warn",
                        "code": "transfer_null_qty",
                        "transfer_id": tr.id,
                        "line_id": ln.id,
                        "detail": f"count={ln.fish_count} weight={ln.weight_kg}",
                    }
                )

    # Inter-pond: sum of all transfer-outs from company ponds should equal sum of transfer-ins
    # (when both ends are in company) — already true by construction of lines.
    tin_all_n = sum(int(ln.fish_count or 0) for ln in transfer_lines_in)
    tout_all_n = sum(
        int(ln.fish_count or 0)
        for tr in transfers
        for ln in tr.lines.all()
    )

    payload = {
        "company_id": CID,
        "as_of": AS_OF.isoformat(),
        "pond_count": len(ponds),
        "formula": {
            "book_net_heads": "vendor_bill + transfer_in − transfer_out − harvest_sale + ledger_delta",
            "book_net_kg": "same components on weight_kg",
            "effective_biomass_kg": "latest standing sample mean kg/fish × book heads (per species when breakdown available)",
            "note": "Book kg often understates growth after fry stocking; effective uses sampling size.",
        },
        "company_totals": {
            "fingerling_purchase_heads": total_bill_n,
            "harvest_sale_heads": total_sale_n,
            "harvest_sale_kg": q4(total_sale_w),
            "transfer_in_heads_to_ponds": tin_all_n,
            "transfer_out_heads_from_ponds": tout_all_n,
            "present_book_heads": total_pos_n,
            "present_book_kg": q4(total_pos_book),
            "present_effective_biomass_kg": q4(total_pos_eff),
        },
        "issues": issues + xfer_issues,
        "ponds": pond_reports,
        "pos_rows_raw_keys_sample": list(pos_rows[0].keys()) if pos_rows else [],
        "brk_rows_raw_keys_sample": list(brk_rows[0].keys()) if brk_rows else [],
    }

    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {OUT}")
    print(f"Ponds={len(ponds)} issues={len(payload['issues'])}")
    print(
        f"Totals heads book={total_pos_n} eff_kg={q2(total_pos_eff)} "
        f"purchases={total_bill_n} harvest_n={total_sale_n} harvest_kg={q2(total_sale_w)}"
    )
    err = sum(1 for i in payload["issues"] if i["severity"] == "error")
    warn = sum(1 for i in payload["issues"] if i["severity"] == "warn")
    print(f"errors={err} warns={warn}")


if __name__ == "__main__":
    main()
