"""Investigate Mynuddin null-cycle sales/samples + Ashari-2 year-lock readiness."""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from api.models import (
    AquacultureBiomassSample,
    AquacultureDataBankPondClose,
    AquacultureFishSale,
    AquacultureProductionCycle,
)
from api.services.aquaculture_data_bank_service import pond_year_close_readiness
from api.services.tenant_reporting_categories import income_type_is_non_biological_for_company

CID = 2


def main() -> None:
    print("=== ASHARI-2 year-close readiness (as of today-ish period end) ===")
    from datetime import date

    for end in (date(2026, 2, 20), date(2026, 6, 5), date.today()):
        r = pond_year_close_readiness(CID, 14, end)
        print(
            f"  period_end={end}: ready={r['is_ready']} fish={r['settlement_fish_count']} "
            f"blockers={r['blockers'][:2]}"
        )

    print("\n=== MYNUDDIN cycles ===")
    for cy in AquacultureProductionCycle.objects.filter(company_id=CID, pond_id=2).order_by("id"):
        print(
            f"  {cy.id} {cy.code} active={cy.is_active} start={cy.start_date} end={cy.end_date} "
            f"sp={cy.fish_species!r} name={cy.name!r}"
        )

    print("\n=== MYNUDDIN null-cycle SALES ===")
    for s in AquacultureFishSale.objects.filter(
        company_id=CID, pond_id=2, production_cycle_id__isnull=True
    ).order_by("sale_date", "id"):
        if income_type_is_non_biological_for_company(CID, s.income_type or ""):
            continue
        print(
            f"  sale#{s.id} {s.sale_date} sp={s.fish_species} n={s.fish_count} "
            f"kg={s.weight_kg} type={s.income_type}"
        )

    print("\n=== All company null-cycle SALES (non-bio skipped) ===")
    by_pond: dict[int, list] = defaultdict(list)
    for s in AquacultureFishSale.objects.filter(
        company_id=CID, production_cycle_id__isnull=True
    ).order_by("pond_id", "sale_date"):
        if income_type_is_non_biological_for_company(CID, s.income_type or ""):
            continue
        by_pond[s.pond_id].append(s)
    for pid, rows in by_pond.items():
        print(f"  pond {pid}: {len(rows)} sales")
        for s in rows[:8]:
            print(f"    #{s.id} {s.sale_date} sp={s.fish_species} n={s.fish_count}")
        if len(rows) > 8:
            print(f"    ... +{len(rows)-8} more")

    print("\n=== Ashari-2 sample 394 and nearby ===")
    for s in AquacultureBiomassSample.objects.filter(pk__in=[394, 391, 183, 68, 69]).order_by("id"):
        print(
            f"  #{s.id} {s.sample_date} pond={s.pond_id} cy={s.production_cycle_id} "
            f"sp={s.fish_species} n={s.estimated_fish_count} kg={s.estimated_total_weight_kg} "
            f"sale={s.source_fish_sale_id}"
        )


if __name__ == "__main__":
    main()
