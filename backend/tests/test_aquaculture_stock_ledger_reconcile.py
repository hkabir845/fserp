"""Reconcile untagged fish stock ledger rows to production cycles."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureBiomassSample,
    AquacultureFishStockLedger,
    AquaculturePond,
    AquacultureProductionCycle,
    Company,
)
from api.services.aquaculture_stock_ledger_reconcile_service import reconcile_aquaculture_demo_stock


@pytest.mark.django_db
def test_reconcile_tags_ledger_and_backfills_sample(company_tenant):
    Company.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True,
        aquaculture_licensed=True,
    )
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Digonta",
        is_active=True,
    )
    cycle = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        name="Digonta Mid Cycle",
        code="0",
        start_date=date(2026, 5, 1),
    )
    dash_cycle = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        name="Demo crop (Digonta)",
        code="DASH-DEMO-CY-99",
        start_date=date(2026, 4, 1),
    )
    AquacultureFishStockLedger.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=None,
        entry_date=date(2026, 5, 7),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=52000,
        weight_kg_delta=Decimal("1040"),
        memo="[POND-DEMO-STOCK] Opening reconcile",
    )
    sample = AquacultureBiomassSample.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=dash_cycle,
        sample_date=date(2026, 5, 10),
        fish_species="tilapia",
        estimated_fish_count=45,
        estimated_total_weight_kg=Decimal("1"),
        avg_weight_kg=Decimal("0.022222"),
    )
    assert sample.stock_reference_fish_count is None

    stats = reconcile_aquaculture_demo_stock(company_tenant.id)
    assert stats["ledger_tagged"] == 1
    assert stats["demo_cycle_openings"] >= 1
    assert stats["samples_backfilled"] >= 1

    led = AquacultureFishStockLedger.objects.get(memo__contains="[POND-DEMO-STOCK]")
    assert led.production_cycle_id == cycle.id

    sample.refresh_from_db()
    assert sample.stock_reference_fish_count == 52000
    assert float(sample.extrapolated_biomass_kg) == pytest.approx(52000 / 45, rel=0.001)
