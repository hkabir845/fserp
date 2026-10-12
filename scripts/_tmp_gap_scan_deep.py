"""Deeper company-2 gaps beyond formal audit."""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import date
from decimal import Decimal
from pathlib import Path

from django.core.management import call_command
from io import StringIO

from api.models import (
    AquacultureFishPondTransferLine,
    AquacultureFishSale,
    AquaculturePond,
    AquacultureProductionCycle,
)
from api.services.aquaculture_data_bank_service import pond_year_close_readiness
from api.services.aquaculture_partial_harvest import effective_biomass_kg_from_position_row
from api.services.aquaculture_stock_service import (
    compute_fish_stock_position_breakdown_rows,
    compute_fish_stock_position_rows,
)
from api.services.tenant_reporting_categories import income_type_is_non_biological_for_company

CID = 2
M = lambda x: Decimal(str(x or 0)).quantize(Decimal("0.01"))


def main() -> None:
    out: dict = {}

    # P05 lines: sale vs cost
    p05 = AquaculturePond.objects.get(company_id=CID, code="P05")
    p05_lines = []
    for ln in AquacultureFishPondTransferLine.objects.filter(
        transfer__company_id=CID, transfer__from_pond=p05
    ).select_related("transfer", "to_pond"):
        c, s = M(ln.cost_amount), M(ln.sale_amount)
        p05_lines.append(
            {
                "line": ln.id,
                "xfer": ln.transfer_id,
                "date": str(ln.transfer.transfer_date),
                "to": ln.to_pond.code,
                "cost": str(c),
                "sale": str(s),
                "margin": str(s - c),
                "sale_eq_cost": abs(s - c) <= Decimal("0.01"),
            }
        )
    out["p05_lines"] = p05_lines

    # All sale_eq_cost or zero-sale priced lines company-wide
    eq = []
    for ln in AquacultureFishPondTransferLine.objects.filter(
        transfer__company_id=CID
    ).select_related("transfer", "to_pond", "transfer__from_pond"):
        c, s = M(ln.cost_amount), M(ln.sale_amount)
        if c <= 0 and s <= 0:
            continue
        if s <= 0 or abs(s - c) <= Decimal("0.01"):
            eq.append(
                {
                    "line": ln.id,
                    "xfer": ln.transfer_id,
                    "date": str(ln.transfer.transfer_date),
                    "from": ln.transfer.from_pond.code,
                    "to": ln.to_pond.code,
                    "cost": str(c),
                    "sale": str(s),
                }
            )
    out["sale_eq_or_zero"] = eq

    # Species mistag dry-run
    buf = StringIO()
    try:
        call_command(
            "repair_aquaculture_species_mistags",
            company_id=CID,
            dry_run=True,
            json=True,
            stdout=buf,
            stderr=buf,
        )
    except Exception as e:
        out["species_mistags_error"] = str(e)
        raw = buf.getvalue()
    else:
        raw = buf.getvalue()
    j = raw.find("{")
    if j >= 0:
        d = json.loads(raw[j:])
        out["species_mistags"] = {
            k: (len(v) if isinstance(v, list) else v)
            for k, v in d.items()
            if k
            in (
                "company_id",
                "mistag_count",
                "companion_count",
                "would_fix_count",
                "count",
                "fixed",
                "skipped",
                "polyculture_companions",
                "issues",
            )
            or not isinstance(v, (list, dict))
        }
        # keep issue types
        issues = d.get("issues") or d.get("mistags") or d.get("would_fix") or []
        if isinstance(issues, list):
            out["species_mistags"]["issue_preview"] = issues[:8]
            out["species_mistags"]["issue_count"] = len(issues)
    else:
        out["species_mistags_raw"] = raw[:500]

    # Year-close readiness grow-outs
    readiness = []
    for pond in AquaculturePond.objects.filter(company_id=CID, pond_role="grow_out"):
        r = pond_year_close_readiness(CID, pond.id, date(2026, 6, 30))
        readiness.append(
            {
                "code": pond.code,
                "ready": r.get("is_ready"),
                "fish": r.get("settlement_fish_count"),
                "blockers": (r.get("blockers") or [])[:3],
            }
        )
    out["year_close_fy"] = readiness

    # Book vs effective biomass gaps (large divergence)
    bio_gaps = []
    for r in compute_fish_stock_position_rows(CID):
        n = int(r["implied_net_fish_count"] or 0)
        w = Decimal(str(r["implied_net_weight_kg"] or 0))
        e = effective_biomass_kg_from_position_row(r)
        if n == 0 and abs(w) < 1 and abs(e) < 1:
            continue
        gap = abs(w - e)
        if gap > 50 or (w > 0 and e > 0 and gap / max(w, e) > Decimal("0.25")):
            bio_gaps.append(
                {
                    "pond": r["pond_name"],
                    "heads": n,
                    "book_kg": str(w),
                    "eff_kg": str(e),
                    "gap": str(gap),
                }
            )
    out["book_vs_eff_gaps"] = bio_gaps

    # Ashari-2 breakdown non-zero
    a2 = AquaculturePond.objects.get(company_id=CID, code="P03")
    a2_rows = []
    for r in compute_fish_stock_position_breakdown_rows(CID, pond_id=a2.id):
        n = int(r["implied_net_fish_count"] or 0)
        w = Decimal(str(r["implied_net_weight_kg"] or 0))
        if n or w:
            a2_rows.append(
                {
                    "cycle": r.get("production_cycle_id"),
                    "species": r.get("fish_species"),
                    "heads": n,
                    "book": str(w),
                    "eff": str(effective_biomass_kg_from_position_row(r)),
                }
            )
    out["ashari2_stock"] = a2_rows

    # Active cycles without end
    open_cycles = []
    for cy in AquacultureProductionCycle.objects.filter(
        company_id=CID, end_date__isnull=True
    ).select_related("pond"):
        open_cycles.append(
            {
                "id": cy.id,
                "code": cy.code,
                "pond": cy.pond.code,
                "active": cy.is_active,
                "start": str(cy.start_date),
                "species": cy.fish_species,
            }
        )
    out["open_cycles"] = open_cycles

    # External sales with pond counterparty? (should be IPT)
    # Skip heavy - check fish sales with customer that is a pond party
    print(json.dumps(out, indent=2, default=str))
    Path(__file__).resolve().parent.joinpath("_audit_extract/_gap_scan_deep.json").write_text(
        json.dumps(out, indent=2, default=str), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
