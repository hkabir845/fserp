"""FCR, partial harvest suggestion, and load-per-decimal enrichment."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import AquacultureBiomassSample, AquacultureExpense, AquacultureFishSale, AquaculturePond
from api.services.aquaculture_fcr_service import (
    biomass_gain_from_samples_for_pond,
    compute_fcr_for_scope,
    sum_feed_kg_for_period,
)
from api.services.aquaculture_partial_harvest import (
    compute_partial_harvest_suggestion,
    current_fish_per_kg_from_position_row,
    enrich_position_row_with_fish_metrics,
)
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows


@pytest.mark.django_db
def test_partial_harvest_suggestion_when_high_load():
    sug = compute_partial_harvest_suggestion(
        Decimal("300"),
        120_000,
        water_area_decimal=Decimal("2.0"),
        pond_role="grow_out",
        current_fish_per_kg=Decimal("400"),
        load_level="high_risk",
    )
    assert sug["partial_harvest_applicable"] is True
    assert Decimal(sug["partial_harvest_suggested_kg"]) > 0
    assert sug["partial_harvest_suggested_fish_count"] is not None
    assert "comfort" in (sug["partial_harvest_rationale"] or "").lower() or "kg/decimal" in (
        sug["partial_harvest_rationale"] or ""
    )


@pytest.mark.django_db
def test_partial_harvest_not_applicable_when_moderate_load():
    sug = compute_partial_harvest_suggestion(
        Decimal("20"),
        50_000,
        water_area_decimal=Decimal("2.0"),
        pond_role="grow_out",
        load_level="moderate",
    )
    assert sug["partial_harvest_applicable"] is False


@pytest.mark.django_db
def test_enrich_position_row_adds_pcs_per_kg(company_tenant):
    row = {
        "implied_net_fish_count": 500_000,
        "implied_net_weight_kg": "166.6667",
        "pond_role": "nursing",
        "load_level": "moderate",
        "latest_sample_estimated_fish_count": None,
        "latest_sample_estimated_total_weight_kg": None,
        "latest_sample_avg_weight_kg": None,
    }
    out = enrich_position_row_with_fish_metrics(row, water_area_decimal=Decimal("1.5"))
    assert out["current_fish_per_kg"] is not None
    pcs = Decimal(out["current_fish_per_kg"])
    assert pcs > Decimal("2000")


def test_current_fish_per_kg_prefers_sample():
    row = {
        "latest_sample_estimated_fish_count": 400,
        "latest_sample_estimated_total_weight_kg": "10",
        "implied_net_fish_count": 500_000,
        "implied_net_weight_kg": "166.6667",
    }
    pcs, src = current_fish_per_kg_from_position_row(row)
    assert pcs == Decimal("40.0000")
    assert "sample" in src


@pytest.mark.django_db
def test_fcr_from_feed_and_sampling(company_tenant):
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(
        company_id=cid,
        name="FCR Pond",
        water_area_decimal=Decimal("2.5"),
        is_active=True,
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_category="feed_consumed",
        expense_date=date(2026, 3, 1),
        amount=Decimal("5000"),
        feed_weight_kg=Decimal("100"),
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_category="feed_consumed",
        expense_date=date(2026, 3, 15),
        amount=Decimal("5000"),
        feed_weight_kg=Decimal("150"),
    )
    AquacultureBiomassSample.objects.create(
        company_id=cid,
        pond=pond,
        sample_date=date(2026, 3, 1),
        estimated_fish_count=100_000,
        estimated_total_weight_kg=Decimal("200"),
        avg_weight_kg=Decimal("0.002"),
        fish_species="tilapia",
    )
    AquacultureBiomassSample.objects.create(
        company_id=cid,
        pond=pond,
        sample_date=date(2026, 3, 20),
        estimated_fish_count=95_000,
        estimated_total_weight_kg=Decimal("400"),
        avg_weight_kg=Decimal("0.0042"),
        fish_species="tilapia",
        extrapolated_biomass_kg=Decimal("400"),
    )
    feed = sum_feed_kg_for_period(cid, date(2026, 3, 1), date(2026, 3, 31), pond_id=pond.id)
    assert feed == Decimal("250.0000")
    _, _, gain, _ = biomass_gain_from_samples_for_pond(
        cid, pond.id, date(2026, 3, 1), date(2026, 3, 31)
    )
    assert gain == Decimal("200.0000")
    fcr = compute_fcr_for_scope(cid, date(2026, 3, 1), date(2026, 3, 31), pond_id=pond.id)
    assert fcr["fcr_biomass"] == "1.25"


@pytest.mark.django_db
def test_stock_position_includes_load_and_harvest_fields(company_tenant):
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(
        company_id=cid,
        name="Load Pond",
        water_area_decimal=Decimal("1.0"),
        pond_role="grow_out",
        is_active=True,
    )
    rows = compute_fish_stock_position_rows(cid, pond_id=pond.id)
    assert len(rows) == 1
    r = rows[0]
    assert "stock_density_kg_per_decimal" in r
    assert "current_fish_per_kg" in r
    assert "partial_harvest_applicable" in r


@pytest.mark.django_db
def test_fcr_biomass_report(api_client, company_tenant, auth_admin_headers):
    import json

    from api.models import Company

    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True)
    h = auth_admin_headers
    r = api_client.get(
        "/api/reports/aquaculture-fcr-biomass/",
        {"start_date": "2026-01-01", "end_date": "2026-05-22"},
        **h,
    )
    assert r.status_code == 200, r.content[:500]
    data = json.loads(r.content)
    assert data.get("report_id") == "aquaculture-fcr-biomass"
    assert "fcr" in data
    assert "load_by_pond" in data
