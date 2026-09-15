"""All-species pond biomass must not apply one sample mean to every fish.

Live VPS (Ashari-2, 2026-09-15): latest sample was 1 silver carp at 2.2 kg. Pond-level
"all species" then did 245,672 heads × 2.2 kg = 540,478 kg. Per-species sample × heads
is ~131,349 kg.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureBiomassSample,
    AquacultureFishStockLedger,
    AquaculturePond,
    AquacultureProductionCycle,
)
from api.services.aquaculture_partial_harvest import effective_biomass_kg_from_position_row
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows


@pytest.mark.django_db
def test_all_species_biomass_does_not_apply_one_carp_sample_to_every_fish(company_tenant):
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Ashari-2 mix",
        pond_role="grow_out",
        water_area_decimal=Decimal("400"),
        is_active=True,
    )
    cycle = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        name="C22",
        code="C22",
        start_date=date(2026, 1, 1),
    )
    AquacultureFishStockLedger.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=cycle,
        entry_date=date(2026, 3, 1),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=200000,
        weight_kg_delta=Decimal("25000"),
        memo="tilapia standing",
    )
    AquacultureFishStockLedger.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=cycle,
        entry_date=date(2026, 3, 1),
        entry_kind="adjustment",
        fish_species="silver_carp",
        fish_count_delta=1904,
        weight_kg_delta=Decimal("4000"),
        memo="silver carp standing",
    )
    AquacultureBiomassSample.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=cycle,
        sample_date=date(2026, 9, 12),
        fish_species="tilapia",
        estimated_fish_count=70,
        estimated_total_weight_kg=Decimal("9.0000"),
        avg_weight_kg=Decimal("0.128571"),
    )
    AquacultureBiomassSample.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=cycle,
        sample_date=date(2026, 9, 15),
        fish_species="silver_carp",
        estimated_fish_count=1,
        estimated_total_weight_kg=Decimal("2.2000"),
        avg_weight_kg=Decimal("2.200000"),
    )

    all_species = compute_fish_stock_position_rows(company_tenant.id, pond_id=pond.id)[0]
    tilapia = compute_fish_stock_position_rows(
        company_tenant.id, pond_id=pond.id, fish_species_filter="tilapia"
    )[0]
    silver = compute_fish_stock_position_rows(
        company_tenant.id, pond_id=pond.id, fish_species_filter="silver_carp"
    )[0]

    assert int(all_species["implied_net_fish_count"]) == 201904
    tilapia_kg = effective_biomass_kg_from_position_row(tilapia)
    silver_kg = effective_biomass_kg_from_position_row(silver)
    combined = effective_biomass_kg_from_position_row(all_species)

    assert tilapia_kg == Decimal("25714.2000")  # 200000 × (9/70)
    assert silver_kg == Decimal("4188.8000")  # 1904 × 2.2
    assert combined == (tilapia_kg + silver_kg).quantize(Decimal("0.0001"))
    # The bug: latest silver-carp sample applied to every head.
    exploded = (Decimal("2.2") * Decimal("201904")).quantize(Decimal("0.0001"))
    assert combined != exploded
    assert combined < Decimal("40000")
    assert Decimal(str(all_species["effective_net_weight_kg"])) == combined
