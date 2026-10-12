"""One-shot company-2 gap/bug scan (local = live)."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from pathlib import Path

from django.db.models import Q

from api.models import (
    AquacultureBiomassSample,
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquacultureFishSale,
    AquaculturePond,
    JournalEntry,
)
from api.services.aquaculture_fish_transfer_gl_service import transfer_gl_status
from api.services.aquaculture_partial_harvest import effective_biomass_kg_from_position_row
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows
from api.services.tenant_reporting_categories import income_type_is_non_biological_for_company

CID = 2
M = lambda x: Decimal(str(x or 0)).quantize(Decimal("0.01"))
OUT = Path(__file__).resolve().parent / "_audit_extract" / "_gap_scan_now.json"


def main() -> None:
    out: dict = {"company_id": CID}

    # --- Audit JSON already written ---
    audit_path = Path(__file__).resolve().parent / "_audit_extract" / "_live_aqua_audit_now.json"
    raw = audit_path.read_text(encoding="utf-8-sig")
    i = raw.find("{")
    audit = json.loads(raw[i:]) if i >= 0 else {}
    out["audit"] = {
        "issue_count": audit.get("issue_count"),
        "warning_count": audit.get("warning_count"),
        "accepted_count": audit.get("accepted_count"),
        "gl_gap_total": audit.get("gl_gap_total"),
        "issues": audit.get("issues") or [],
        "warnings": audit.get("warnings") or [],
        "accepted": [
            {
                "type": a.get("type"),
                "pond_code": a.get("pond_code"),
                "transfer_id": a.get("transfer_id"),
                "note": (a.get("note") or "")[:120],
            }
            for a in (audit.get("accepted") or [])
        ],
    }

    # --- Entity P&L ---
    for label, end in (("fy", date(2026, 6, 30)), ("ytd", date(2026, 9, 24))):
        pl = compute_aquaculture_pl_summary_dict(
            CID, date(2025, 7, 1), end, None, None, None, False
        )
        rows = []
        for r in pl["ponds"]:
            pond = AquaculturePond.objects.get(pk=r["pond_id"])
            rows.append(
                {
                    "code": pond.code,
                    "name": pond.name,
                    "role": r.get("role") or pond.pond_role,
                    "net": str(M(r["net_profit"])),
                    "income": str(M(r["income_total"])),
                    "expense": str(M(r["expense_total"])),
                }
            )
        out[f"entity_pl_{label}"] = rows

    # --- Transfer GL ---
    xfer_flags = []
    for tr in AquacultureFishPondTransfer.objects.filter(company_id=CID).order_by("id"):
        lines = list(tr.lines.select_related("to_pond").all())
        if not lines:
            continue
        cost = sum((M(l.cost_amount) for l in lines), Decimal("0"))
        sale = sum((M(l.sale_amount) for l in lines), Decimal("0"))
        st = transfer_gl_status(CID, tr.id)
        gl = M(st.get("gl_total_amount") or 0)
        flags = []
        if st.get("gl_posted") and gl > cost + Decimal("1"):
            flags.append("stale_gl_gt_cost")
        elif st.get("gl_posted") and gl + Decimal("1") < cost:
            flags.append("bio_cap_or_under")
        if not st.get("gl_posted") and (cost > 0 or sale > 0):
            flags.append("unposted")
        if sale == 0 and cost > 0:
            flags.append("cost_only_no_sale")
        elif abs(sale - cost) <= Decimal("0.01") and cost > 0:
            flags.append("sale_eq_cost")
        if flags:
            xfer_flags.append(
                {
                    "id": tr.id,
                    "date": str(tr.transfer_date),
                    "from": tr.from_pond.code if tr.from_pond_id else None,
                    "cost": str(cost),
                    "sale": str(sale),
                    "gl": str(gl),
                    "posted": st.get("gl_posted"),
                    "capped": st.get("gl_capped"),
                    "reason": st.get("reason"),
                    "flags": flags,
                }
            )
    out["transfer_flags"] = xfer_flags

    # --- Missing IPT journals for sale>0 ---
    missing_ipt = []
    for tr in AquacultureFishPondTransfer.objects.filter(company_id=CID).order_by("id"):
        sale = sum(
            (M(l.sale_amount) for l in tr.lines.all()),
            Decimal("0"),
        )
        if sale <= 0:
            continue
        has_inv = JournalEntry.objects.filter(
            company_id=CID, entry_number__startswith=f"AUTO-IPT-INV-{tr.id}-"
        ).exists()
        has_legacy = JournalEntry.objects.filter(
            company_id=CID, entry_number=f"AUTO-AQ-FISH-XFER-{tr.id}"
        ).exists()
        if not has_inv and not has_legacy:
            missing_ipt.append({"transfer_id": tr.id, "sale": str(sale)})
    out["missing_ipt_je"] = missing_ipt

    # --- Null cycle ---
    null_sales = []
    for s in AquacultureFishSale.objects.filter(
        company_id=CID, production_cycle_id__isnull=True
    ).order_by("pond_id", "sale_date"):
        if income_type_is_non_biological_for_company(CID, s.income_type or ""):
            continue
        null_sales.append(
            {
                "id": s.id,
                "pond_id": s.pond_id,
                "date": str(s.sale_date),
                "species": s.fish_species,
                "count": s.fish_count,
            }
        )
    out["null_cycle_bio_sales"] = null_sales
    out["null_cycle_samples"] = AquacultureBiomassSample.objects.filter(
        company_id=CID, production_cycle_id__isnull=True
    ).count()

    # --- Stock anomalies ---
    stock_odd = []
    for r in compute_fish_stock_position_rows(CID):
        n = int(r["implied_net_fish_count"] or 0)
        w = Decimal(str(r["implied_net_weight_kg"] or 0))
        e = effective_biomass_kg_from_position_row(r)
        if n < 0 or w < 0 or e < 0:
            stock_odd.append(
                {
                    "pond": r["pond_name"],
                    "heads": n,
                    "book_kg": str(w),
                    "eff_kg": str(e),
                }
            )
    out["negative_stock"] = stock_odd

    # --- IPT double bio / null cycle repair summaries if present ---
    for name, key in (
        ("_live_ipt_bio_now.json", "ipt_double_bio"),
        ("_live_null_cycle_now.json", "null_cycle_repair"),
    ):
        p = Path(__file__).resolve().parent / "_audit_extract" / name
        if not p.exists():
            continue
        raw2 = p.read_text(encoding="utf-8-sig")
        j = raw2.find("{")
        if j < 0:
            out[key] = {"raw_head": raw2[:200]}
            continue
        d = json.loads(raw2[j:])
        # keep compact
        slim = {}
        for k, v in d.items():
            if isinstance(v, list):
                slim[k] = {"count": len(v), "preview": v[:5]}
            elif isinstance(v, dict) and len(str(v)) > 400:
                slim[k] = {kk: vv for kk, vv in list(v.items())[:12]}
            else:
                slim[k] = v
        out[key] = slim

    OUT.write_text(json.dumps(out, indent=2, default=str), encoding="utf-8")
    print(json.dumps(out, indent=2, default=str))


if __name__ == "__main__":
    main()
