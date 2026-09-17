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


def _stock_pond(company_id: int, name: str, lots: list[tuple[str, int, str, str, int]]):
    """lots: (species, heads, sample_kg, sample_date, seine_n)."""
    pond = AquaculturePond.objects.create(
        company_id=company_id,
        name=name,
        pond_role="grow_out",
        water_area_decimal=Decimal("200"),
        is_active=True,
    )
    cycle = AquacultureProductionCycle.objects.create(
        company_id=company_id,
        pond=pond,
        name=f"{name} cycle",
        code=name[:8],
        start_date=date(2026, 1, 1),
    )
    expected = Decimal("0")
    for species, heads, samp_kg, samp_day, seine_n in lots:
        AquacultureFishStockLedger.objects.create(
            company_id=company_id,
            pond=pond,
            production_cycle=cycle,
            entry_date=date(2026, 3, 1),
            entry_kind="adjustment",
            fish_species=species,
            fish_count_delta=heads,
            weight_kg_delta=Decimal(heads),
            memo=species,
        )
        AquacultureBiomassSample.objects.create(
            company_id=company_id,
            pond=pond,
            production_cycle=cycle,
            sample_date=date.fromisoformat(samp_day),
            fish_species=species,
            estimated_fish_count=seine_n,
            estimated_total_weight_kg=Decimal(samp_kg),
            avg_weight_kg=(Decimal(samp_kg) / Decimal(seine_n)).quantize(Decimal("0.000001")),
        )
        avg = (Decimal(samp_kg) / Decimal(seine_n)).quantize(Decimal("0.000001"))
        expected += (avg * Decimal(heads)).quantize(Decimal("0.0001"))
    return pond, expected.quantize(Decimal("0.0001"))


@pytest.mark.django_db
def test_all_four_growout_ponds_use_species_sum_not_latest_sample(company_tenant):
    """Mynuddin-style understatement, Ashari-2 overstatement, tilapia-only, and a small mix."""
    cid = company_tenant.id
    specs = [
        (
            "Mynuddin-like",
            [
                ("tilapia", 30000, "6.5", "2026-09-12", 34),
                ("bighead_carp", 2000, "82", "2026-08-01", 27),
                ("rui", 4000, "42.5", "2026-08-10", 46),
            ],
        ),
        (
            "Ashari-1-like",
            [("tilapia", 118464, "6.5", "2026-09-12", 38)],
        ),
        (
            "Ashari-2-like",
            [
                ("tilapia", 194888, "9", "2026-09-10", 70),
                ("silver_carp", 1904, "2.2", "2026-09-15", 1),
                ("rui", 10868, "1.2", "2026-08-20", 1),
            ],
        ),
        (
            "Digonto-like",
            [
                ("tilapia", 58622, "2.95", "2026-09-12", 22),
                ("other", 2884, "10", "2026-08-01", 13),
            ],
        ),
    ]
    expected_by_name: dict[str, Decimal] = {}
    for name, lots in specs:
        _pond, expected = _stock_pond(cid, name, lots)
        expected_by_name[name] = expected

    rows = compute_fish_stock_position_rows(cid, include_inactive_ponds=False)
    by_name = {r["pond_name"]: r for r in rows}
    farm = Decimal("0")
    for name, expected in expected_by_name.items():
        row = by_name[name]
        got = Decimal(str(row["effective_net_weight_kg"]))
        assert got == expected, f"{name}: got {got} expected {expected}"
        farm += got
        latest_avg = Decimal(str(row["latest_sample_avg_weight_kg"]))
        exploded = (latest_avg * Decimal(int(row["implied_net_fish_count"]))).quantize(Decimal("0.0001"))
        if name != "Ashari-1-like":
            assert got != exploded, f"{name} must not use one sample for every fish"

    from api.services.aquaculture_pond_economics_service import compute_pond_economics_portfolio
    from api.services.aquaculture_pond_performance_service import build_pond_performance_report

    econ = compute_pond_economics_portfolio(cid)
    assert Decimal(str(econ["total_biomass_kg"])) == farm.quantize(Decimal("0.0001"))
    perf = build_pond_performance_report(cid, date(2026, 1, 1), date(2026, 9, 15))
    assert Decimal(str(perf["summary"]["total_biomass_kg"])) == farm.quantize(Decimal("0.01"))


@pytest.mark.django_db
def test_one_fish_tilapia_sample_does_not_set_pond_mass(company_tenant):
    """Ashari-2 C22: 1 × 1.6 kg × 42,912 heads must not add 68 t on top of C02."""
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(
        company_id=cid, name="Ashari-2", pond_role="grow_out", is_active=True
    )
    c02 = AquacultureProductionCycle.objects.create(
        company_id=cid, pond=pond, name="C02", start_date=date(2026, 7, 1)
    )
    c22 = AquacultureProductionCycle.objects.create(
        company_id=cid, pond=pond, name="C22", start_date=date(2026, 1, 1)
    )
    AquacultureFishStockLedger.objects.create(
        company_id=cid, pond=pond, production_cycle=c02, entry_date=date(2026, 8, 1),
        entry_kind="adjustment", fish_species="tilapia",
        fish_count_delta=194888, weight_kg_delta=Decimal("25000"),
    )
    AquacultureFishStockLedger.objects.create(
        company_id=cid, pond=pond, production_cycle=c22, entry_date=date(2026, 8, 1),
        entry_kind="adjustment", fish_species="tilapia",
        fish_count_delta=42912, weight_kg_delta=Decimal("5000"),
    )
    AquacultureBiomassSample.objects.create(
        company_id=cid, pond=pond, production_cycle=c02, sample_date=date(2026, 9, 12),
        fish_species="tilapia", estimated_fish_count=70,
        estimated_total_weight_kg=Decimal("9.0000"), avg_weight_kg=Decimal("0.128571"),
    )
    AquacultureBiomassSample.objects.create(
        company_id=cid, pond=pond, production_cycle=c22, sample_date=date(2026, 9, 14),
        fish_species="tilapia", estimated_fish_count=1,
        estimated_total_weight_kg=Decimal("1.6000"), avg_weight_kg=Decimal("1.600000"),
    )
    row = compute_fish_stock_position_rows(cid, pond_id=pond.id)[0]
    present = effective_biomass_kg_from_position_row(row)
    assert present == Decimal("25056.9450")  # 194888 × (9/70)
    assert present < Decimal("30000")


@pytest.mark.django_db
def test_impossible_tilapia_mean_is_ignored(company_tenant):
    """Mynuddin 12 Aug: 20 fish / 165 kg (8.25 kg/fish) is a typo, not pond mass."""
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(
        company_id=cid, name="Mynuddin", pond_role="grow_out", is_active=True
    )
    cy = AquacultureProductionCycle.objects.create(
        company_id=cid, pond=pond, name="C03", start_date=date(2026, 7, 1)
    )
    AquacultureFishStockLedger.objects.create(
        company_id=cid, pond=pond, production_cycle=cy, entry_date=date(2026, 8, 1),
        entry_kind="adjustment", fish_species="tilapia",
        fish_count_delta=31644, weight_kg_delta=Decimal("4500"),
    )
    AquacultureBiomassSample.objects.create(
        company_id=cid, pond=pond, production_cycle=cy, sample_date=date(2026, 8, 12),
        fish_species="tilapia", estimated_fish_count=20,
        estimated_total_weight_kg=Decimal("165.0000"), avg_weight_kg=Decimal("8.250000"),
    )
    AquacultureBiomassSample.objects.create(
        company_id=cid, pond=pond, production_cycle=cy, sample_date=date(2026, 9, 12),
        fish_species="tilapia", estimated_fish_count=34,
        estimated_total_weight_kg=Decimal("6.5000"), avg_weight_kg=Decimal("0.191176"),
    )
    row = compute_fish_stock_position_rows(cid, pond_id=pond.id)[0]
    present = effective_biomass_kg_from_position_row(row)
    assert present == Decimal("6049.5733")  # 31644 × (6.5/34)
    assert present < Decimal("10000")
