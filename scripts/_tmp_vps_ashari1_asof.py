"""Ashari-1 standing biomass as-of dates vs sample-row first/last."""
from __future__ import annotations

import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
import django

django.setup()

from datetime import date
from decimal import Decimal

from api.models import AquacultureBiomassSample, AquaculturePond, AquacultureProductionCycle
from api.services.aquaculture_partial_harvest import effective_biomass_kg_from_position_row
from api.services.aquaculture_stock_service import (
    compute_fish_stock_position_breakdown_rows,
    compute_fish_stock_position_rows,
)


def _d(v):
    if v is None or v == "":
        return Decimal("0")
    return Decimal(str(v))


def standing(cid, pid, as_of, cycle=None):
    rows = compute_fish_stock_position_breakdown_rows(
        cid, pond_id=pid, production_cycle_id=cycle, as_of_date=as_of
    )
    total = Decimal("0")
    heads = 0
    parts = []
    for r in rows:
        bio = effective_biomass_kg_from_position_row(r)
        n = int(r.get("implied_net_fish_count") or 0)
        book = _d(r.get("implied_net_weight_kg"))
        if bio == 0 and n == 0 and book == 0:
            continue
        total += bio
        heads += max(n, 0)
        parts.append(
            f"{r.get('production_cycle_name')}/{r.get('fish_species')} "
            f"n={n} book={book} eff={bio} avg={r.get('latest_sample_avg_weight_kg')} "
            f"smp={r.get('latest_sample_date')}"
        )
    return total, heads, parts


def main():
    pond = AquaculturePond.objects.get(pk=13)
    cid = 2
    print(f"{pond.name} id={pond.id}")
    print("\nCYCLES:")
    for cy in AquacultureProductionCycle.objects.filter(company_id=cid, pond_id=pond.id).order_by("id"):
        print(f"  id={cy.id} code={cy.code!r} name={cy.name!r} start={cy.start_date} active={cy.is_active}")

    print("\nAUG+SEP SAMPLES:")
    for s in AquacultureBiomassSample.objects.filter(
        company_id=cid, pond_id=pond.id, sample_date__gte=date(2026, 8, 1)
    ).order_by("sample_date", "id"):
        print(
            f"  id={s.id} {s.sample_date} cy={s.production_cycle_id} sp={s.fish_species} "
            f"seine={s.estimated_fish_count}/{s.estimated_total_weight_kg} "
            f"ref_n={s.stock_reference_fish_count} extrap={s.extrapolated_biomass_kg}"
        )

    dates = [
        date(2026, 7, 31),
        date(2026, 8, 1),
        date(2026, 8, 11),
        date(2026, 8, 15),
        date(2026, 8, 16),
        date(2026, 8, 21),
        date(2026, 8, 31),
        date(2026, 9, 1),
        date(2026, 9, 12),
        date(2026, 9, 16),
        date.today(),
    ]
    print("\nAS-OF STANDING (all cycles/species):")
    for d in dates:
        tot, heads, parts = standing(cid, pond.id, d)
        print(f"\n  {d} total_eff={tot} heads={heads}")
        for p in parts:
            if "eff=0" in p and "n=0" in p:
                continue
            print(f"    {p}")

    now = compute_fish_stock_position_rows(cid, pond_id=pond.id)
    print("\nCURRENT POND ROW:")
    for r in now:
        print(
            f"  heads={r.get('implied_net_fish_count')} book={r.get('implied_net_weight_kg')} "
            f"eff={effective_biomass_kg_from_position_row(r)} combined={r.get('species_combined_biomass_kg')}"
        )

    target = Decimal("13738")
    print("\nSEARCH near 13738:")
    for s in AquacultureBiomassSample.objects.filter(company_id=cid, pond_id=pond.id):
        for val, label in (
            (s.extrapolated_biomass_kg, "extrap"),
            (s.estimated_total_weight_kg, "seine_kg"),
            (s.stock_reference_net_weight_kg, "ref_kg"),
            (s.biomass_gain_kg, "stored_gain"),
        ):
            if val is None:
                continue
            if abs(_d(val) - target) < Decimal("50"):
                print(f"  sample {s.id} {s.sample_date} {label}={val}")


if __name__ == "__main__":
    main()
