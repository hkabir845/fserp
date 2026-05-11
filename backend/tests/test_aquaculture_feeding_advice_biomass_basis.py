"""Feeding advice falls back to biomass samples when transactional implied biomass is non-positive.

Realistic case (Mynuddin pond, cycle id 25): transfers + sales tagged to a cycle but the +ve stock
ledger adjustment was logged before the cycle existed (production_cycle_id=NULL), so the
cycle-filtered implied biomass goes negative even though the pond clearly has tilapia. Without the
fallback the UI showed no kg suggestion. The fix prefers the manager-recorded biomass sample.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureBiomassSample,
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquacultureFishSale,
    AquacultureFishStockLedger,
    AquaculturePond,
    AquacultureProductionCycle,
    Company,
)
from api.services.aquaculture_feeding_advice_service import (
    _select_biomass_for_feeding_kg,
    build_feeding_advice_payload,
)


def test_select_biomass_prefers_sample_total_when_positive():
    row = {
        "latest_sample_estimated_total_weight_kg": "3060",
        "implied_net_weight_kg": "1500",
    }
    kg, src = _select_biomass_for_feeding_kg(row)
    assert kg == Decimal("3060.00")
    assert "biomass sample" in src


def test_select_biomass_falls_back_to_implied_when_no_sample_total():
    row = {
        "latest_sample_estimated_total_weight_kg": None,
        "implied_net_weight_kg": "1500",
    }
    kg, src = _select_biomass_for_feeding_kg(row)
    assert kg == Decimal("1500.00")
    assert "implied" in src


def test_select_biomass_recovers_with_avg_weight_x_count_when_implied_negative():
    row = {
        "latest_sample_estimated_total_weight_kg": None,
        "implied_net_weight_kg": "-692.857",
        "implied_net_fish_count": 75850,
        "latest_sample_avg_weight_kg": "0.250000",
        "latest_sample_estimated_fish_count": 57,
    }
    kg, src = _select_biomass_for_feeding_kg(row)
    assert kg == Decimal("18962.50")
    assert "sampled mean weight" in src


def test_select_biomass_zero_when_no_signal():
    kg, src = _select_biomass_for_feeding_kg(
        {
            "latest_sample_estimated_total_weight_kg": None,
            "implied_net_weight_kg": "0",
            "implied_net_fish_count": 0,
            "latest_sample_avg_weight_kg": None,
        }
    )
    assert kg == Decimal("0")
    assert src == ""


@pytest.mark.django_db
def test_build_feeding_advice_uses_sample_when_implied_biomass_negative(company_tenant):
    """Reproduces the Mynuddin/cycle 25 case: ledger adj without cycle id is filtered out."""
    Company.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    src_pond = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Source", is_active=True
    )
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Mynuddin",
        is_active=True,
        water_area_decimal=Decimal("800.0000"),
        pond_depth_ft=Decimal("8.000"),
    )
    cycle = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        name="Mynuddin Mid Cycle",
        code="0",
        start_date=date(2026, 5, 10),
    )

    transfer = AquacultureFishPondTransfer.objects.create(
        company_id=company_tenant.id,
        transfer_date=date(2026, 4, 2),
        from_pond=src_pond,
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=transfer,
        to_pond=pond,
        to_production_cycle=cycle,
        weight_kg=Decimal("420"),
        fish_count=28000,
    )

    AquacultureFishSale.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=cycle,
        sale_date=date(2026, 5, 5),
        fish_species="tilapia",
        income_type="fish_harvest_sale",
        weight_kg=Decimal("2070"),
        fish_count=6800,
        total_amount=Decimal("0"),
    )

    AquacultureFishStockLedger.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        entry_date=date(2026, 5, 7),
        entry_kind="adjustment",
        fish_species="tilapia",
        weight_kg_delta=Decimal("3540"),
        fish_count_delta=11800,
        memo="reconciliation pre-cycle",
    )

    AquacultureBiomassSample.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=cycle,
        sample_date=date(2026, 5, 6),
        fish_species="tilapia",
        estimated_fish_count=10050,
        estimated_total_weight_kg=Decimal("3060"),
        avg_weight_kg=Decimal("0.350000"),
    )

    payload, msg = build_feeding_advice_payload(
        company_tenant.id,
        pond.id,
        date(2026, 5, 9),
        cycle.id,
        water_temp_c=Decimal("28"),
    )
    assert msg is None
    assert payload is not None

    assert payload["suggested_feed_kg"] is not None
    assert payload["suggested_feed_kg"] > 0

    snap = payload["pond_status_snapshot"]
    fh = snap["feeding_heuristic"]
    assert fh["biomass_basis_kg"] is not None
    assert "biomass sample" in (fh["biomass_basis_source"] or "")

    stock_pos = snap["stock_position"]
    assert Decimal(stock_pos["implied_net_weight_kg"]) <= 0
