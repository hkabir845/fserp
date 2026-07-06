#!/usr/bin/env python3
"""Compare Aquaculture P&L management vs GL P&L for Digonta pond(s)."""
from __future__ import annotations

import os
import sys
from datetime import date
from decimal import Decimal

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

backend = os.path.join(os.path.dirname(__file__), "..", "backend")
sys.path.insert(0, backend)

import django  # noqa: E402

django.setup()

from api.models import AquaculturePond, Company  # noqa: E402
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict  # noqa: E402
from api.services.reporting import report_income_statement  # noqa: E402


def main() -> None:
    c = Company.objects.filter(domain="mahasoftcorporation.com").first() or Company.objects.first()
    if not c:
        print("No company")
        return
    print(f"company={c.id} {c.name!r} domain={c.domain!r}")

    ponds = list(
        AquaculturePond.objects.filter(company_id=c.id, name__icontains="Digont").order_by("id")
    )
    if not ponds:
        ponds = list(AquaculturePond.objects.filter(company_id=c.id).order_by("name")[:5])
        print("No Digont* pond — showing first ponds:", [(p.id, p.name) for p in ponds])
    else:
        print("Digont* ponds:", [(p.id, p.name) for p in ponds])

    start = date(2025, 7, 1)
    end = date(2026, 6, 30)
    print(f"period {start} .. {end}")

    for p in ponds:
        print("\n" + "=" * 60)
        print(f"Pond {p.id}: {p.name}")
        mgmt = compute_aquaculture_pl_summary_dict(c.id, start, end, p.id, None, None, False)
        t = mgmt.get("totals") or {}
        row = (mgmt.get("ponds") or [{}])[0]
        print("mgmt totals:", {k: t.get(k) for k in sorted(t.keys())})
        print(
            "mgmt row net:",
            row.get("net_profit"),
            "profit:",
            row.get("profit"),
            "expense_total:",
            row.get("expense_total"),
            "total_costs:",
            row.get("total_costs"),
        )
        is_ = report_income_statement(c.id, start, end, pond_id=p.id)
        snap = (is_.get("aquaculture_management") or {}).get("totals") or {}
        print(
            "GL: income",
            is_["income"]["total"],
            "cogs",
            is_["cost_of_goods_sold"]["total"],
            "exp",
            is_["expenses"]["total"],
            "net",
            is_["net_income"],
        )
        print("P&L aquaculture_management totals:", {k: snap.get(k) for k in sorted(snap.keys())})
        for key in (
            "revenue",
            "total_costs",
            "total_costs_and_expenses",
            "profit",
            "net_profit",
            "feed_consumption_cost",
            "medicine_consumption_cost",
        ):
            a = t.get(key)
            b = snap.get(key)
            if str(a) != str(b):
                print(f"  MISMATCH {key}: pl-summary={a!r} vs income-statement snap={b!r}")


if __name__ == "__main__":
    main()
