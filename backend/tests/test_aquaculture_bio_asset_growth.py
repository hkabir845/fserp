"""Bio-asset cost/kg relief and fish growth report."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureBiomassSample,
    AquacultureExpense,
    AquaculturePond,
    Company,
)
from api.services.aquaculture_bio_asset_cost_service import (
    lookup_bio_cost_per_kg,
    suggest_bio_asset_relief_amount,
)
from api.services.aquaculture_growth_service import build_fish_growth_report


@pytest.mark.django_db
def test_suggest_bio_asset_relief_caps_at_balance():
    relief, note = suggest_bio_asset_relief_amount(
        cost_per_kg="100",
        weight_kg="50",
        bio_asset_balance="3000",
    )
    assert relief == Decimal("3000.00")
    assert "Capped" in note


@pytest.mark.django_db
def test_lookup_bio_cost_no_costs_returns_not_found(company_tenant):
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)
    ref = lookup_bio_cost_per_kg(
        company_tenant.id,
        pond_id=pond.id,
        as_of_date=date(2026, 6, 1),
    )
    assert ref.get("found") is False


@pytest.mark.django_db
def test_growth_report_intervals(company_tenant):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True)
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Grow",
        is_active=True,
        water_area_decimal=Decimal("2.0"),
    )
    AquacultureBiomassSample.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        sample_date=date(2026, 4, 1),
        estimated_fish_count=100_000,
        estimated_total_weight_kg=Decimal("2000"),
        avg_weight_kg=Decimal("0.02"),
        extrapolated_biomass_kg=Decimal("2000"),
        fish_species="tilapia",
    )
    AquacultureBiomassSample.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        sample_date=date(2026, 5, 1),
        estimated_fish_count=100_000,
        estimated_total_weight_kg=Decimal("3000"),
        avg_weight_kg=Decimal("0.03"),
        extrapolated_biomass_kg=Decimal("3000"),
        fish_species="tilapia",
    )
    AquacultureExpense.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        expense_date=date(2026, 4, 15),
        expense_category="feed_consumed",
        amount=Decimal("500"),
        feed_weight_kg=Decimal("400"),
    )
    # Purchasing warehouse stock must not inflate feed actually issued to fish.
    AquacultureExpense.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        expense_date=date(2026, 4, 15),
        expense_category="feed_purchase",
        amount=Decimal("1000"),
        feed_weight_kg=Decimal("800"),
    )

    report = build_fish_growth_report(
        company_tenant.id,
        date(2026, 4, 1),
        date(2026, 5, 31),
        pond_id=pond.id,
    )
    assert report["summary"]["sample_count"] == 2
    assert report["summary"]["interval_count"] == 1
    interval = report["intervals"][0]
    assert interval["biomass_gain_kg"] == "1000.00"
    assert interval["adg_g_per_fish_per_day"] is not None
    assert Decimal(interval["feed_kg"]) == Decimal("400")
    assert Decimal(interval["interval_fcr"]) == Decimal("0.40")


def test_growth_intervals_use_latest_sample_per_day(monkeypatch):
    from types import SimpleNamespace
    from api.services import aquaculture_growth_service as growth

    monkeypatch.setattr(growth, "sum_feed_kg_for_period", lambda *a, **kw: Decimal("100"))

    def sample(pk, day, mean):
        return SimpleNamespace(
            id=pk, sample_date=day, pond_id=1, production_cycle_id=None,
            fish_species="tilapia", fish_species_other="",
            estimated_fish_count=100, estimated_total_weight_kg=Decimal(mean) * 100,
            avg_weight_kg=Decimal(mean), extrapolated_biomass_kg=Decimal(mean) * 100,
        )

    opening = sample(1, date(2026, 4, 1), "1")
    correction = sample(2, date(2026, 4, 1), "2")
    closing = sample(3, date(2026, 4, 11), "3")
    assert growth._interval_rows_for_samples([opening, correction], 1) == []
    rows = growth._interval_rows_for_samples([closing, correction, opening], 1)
    assert len(rows) == 1
    assert rows[0]["from_sample_id"] == correction.id
    assert rows[0]["days"] == 10
    assert rows[0]["biomass_gain_kg"] == "100.00"
    assert rows[0]["adg_g_per_fish_per_day"] == "100.00"
    assert rows[0]["interval_fcr"] == "1.00"
