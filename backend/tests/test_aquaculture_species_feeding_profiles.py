"""Species pack + species-aware WorldFish feeding bands."""
from __future__ import annotations

from decimal import Decimal

import pytest

from api.services.aquaculture_constants import (
    FISH_SPECIES_CODES,
    fish_species_feeding_profile,
    normalize_fish_species,
)
from api.services.aquaculture_feeding_advice_service import (
    _band_for_mean_weight_g,
    worldfish_daily_bw_percent,
)


def test_mrigal_and_deshi_aliases_normalize():
    assert "mrigal" in FISH_SPECIES_CODES
    assert "kalibaush" in FISH_SPECIES_CODES
    code, err = normalize_fish_species("mrigala")
    assert err is None and code == "mrigal"
    code, err = normalize_fish_species("kalboush")
    assert err is None and code == "kalibaush"
    code, err = normalize_fish_species("Cirrhinus_mrigala")
    assert err is None and code == "mrigal"


def test_feeding_profiles_by_species():
    assert fish_species_feeding_profile("tilapia") == "tilapia"
    assert fish_species_feeding_profile("rui") == "carp"
    assert fish_species_feeding_profile("mrigal") == "carp"
    assert fish_species_feeding_profile("kalboush") == "carp"
    assert fish_species_feeding_profile("pangas") == "pangas"
    assert fish_species_feeding_profile("mrigala") == "carp"


def test_carp_bands_lower_than_tilapia_at_same_size():
    tilapia = _band_for_mean_weight_g(Decimal("150"), profile="tilapia")
    carp = _band_for_mean_weight_g(Decimal("150"), profile="carp")
    assert carp.bw_high_pct < tilapia.bw_high_pct
    assert carp.label == "Grower"


def test_worldfish_uses_species_from_stock_row():
    row = {
        "fish_species": "mrigal",
        "implied_net_fish_count": 1000,
        "implied_net_weight_kg": "150",
        "latest_sample_avg_weight_kg": "0.150",
        "load_level": "moderate",
    }
    out = worldfish_daily_bw_percent(row, water_temp_c=Decimal("28"), lang="en")
    assert out["feeding_profile"] == "carp"
    assert out["fish_species"] == "mrigal"
    assert out["method"] == "worldfish_table_adjusted"
    # ~150 g grower carp mid ~2.0% (vs tilapia grower mid ~2.5%)
    pct = Decimal(out["chosen_bw_pct_per_day"])
    assert Decimal("1.4") <= pct <= Decimal("2.6")


def test_worldfish_tilapia_unchanged_order_of_magnitude():
    row = {
        "fish_species": "tilapia",
        "implied_net_fish_count": 1000,
        "implied_net_weight_kg": "150",
        "latest_sample_avg_weight_kg": "0.150",
        "load_level": "moderate",
    }
    out = worldfish_daily_bw_percent(row, water_temp_c=Decimal("28"), lang="en")
    assert out["feeding_profile"] == "tilapia"
    pct = Decimal(out["chosen_bw_pct_per_day"])
    assert Decimal("2.0") <= pct <= Decimal("3.0")


@pytest.mark.django_db
def test_batch_feed_demand_includes_carp_without_filter(company_tenant):
    """Default fish_species_filter is None so polyculture carp batches get demand shares."""
    from datetime import date

    from api.models import AquaculturePond, AquacultureProductionCycle
    from api.services.aquaculture_feeding_advice_service import compute_batch_feed_demand_shares
    from api.models import AquacultureBiomassSample

    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Poly test",
        water_area_decimal=Decimal("50"),
        is_active=True,
    )
    cy_t = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        name="Tilapia batch",
        start_date=date(2026, 1, 1),
        fish_species="tilapia",
        is_active=True,
    )
    cy_m = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        name="Mrigal batch",
        start_date=date(2026, 1, 1),
        fish_species="mrigal",
        is_active=True,
    )
    AquacultureBiomassSample.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=cy_t,
        sample_date=date(2026, 6, 1),
        fish_species="tilapia",
        estimated_fish_count=1000,
        estimated_total_weight_kg=Decimal("150"),
        avg_weight_kg=Decimal("0.150"),
    )
    AquacultureBiomassSample.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=cy_m,
        sample_date=date(2026, 6, 1),
        fish_species="mrigal",
        estimated_fish_count=400,
        estimated_total_weight_kg=Decimal("80"),
        avg_weight_kg=Decimal("0.200"),
    )
    # Seed implied stock via ledger so biomass > 0
    from api.models import AquacultureFishStockLedger

    AquacultureFishStockLedger.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=cy_t,
        entry_date=date(2026, 1, 2),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=1000,
        weight_kg_delta=Decimal("150"),
        memo="open tilapia",
    )
    AquacultureFishStockLedger.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=cy_m,
        entry_date=date(2026, 1, 2),
        entry_kind="adjustment",
        fish_species="mrigal",
        fish_count_delta=400,
        weight_kg_delta=Decimal("80"),
        memo="open mrigal",
    )

    shares = compute_batch_feed_demand_shares(company_tenant.id, pond.id, water_temp_c=Decimal("28"))
    species = {s["fish_species"] for s in shares}
    assert "tilapia" in species
    assert "mrigal" in species
