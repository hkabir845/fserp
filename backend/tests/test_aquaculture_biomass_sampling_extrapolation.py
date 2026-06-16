"""Biomass sampling extrapolates pond biomass from net-caught sample vs transactional fish stock."""
from __future__ import annotations

import json

from datetime import date
from decimal import Decimal

import pytest

from api.models import AquaculturePond, AquacultureProductionCycle, Company


@pytest.mark.django_db
def test_sample_saves_extrapolation_from_fish_stock_position(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="Grow1", is_active=True)
    h = auth_admin_headers

    led = api_client.post(
        "/api/aquaculture/fish-stock-ledger/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "entry_date": "2026-05-01",
                "entry_kind": "adjustment",
                "loss_reason": "",
                "fish_species": "tilapia",
                "fish_count_delta": 70000,
                "weight_kg_delta": "14000",
                "book_value": "0",
                "post_to_books": False,
                "memo": "Opening position for test",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert led.status_code == 201, led.content.decode()

    r = api_client.post(
        "/api/aquaculture/samples/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "sample_date": "2026-05-10",
                "fish_species": "tilapia",
                "estimated_fish_count": 20,
                "estimated_total_weight_kg": "5",
                "notes": "Net sample; fish returned",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    data = json.loads(r.content.decode())
    assert data["stock_reference_fish_count"] == 70000
    assert float(data["stock_reference_avg_weight_kg"]) == pytest.approx(0.2)
    assert float(data["extrapolated_biomass_kg"]) == pytest.approx(17500.0, rel=0.001)
    assert float(data["biomass_gain_kg"]) == pytest.approx(3500.0, rel=0.001)


@pytest.mark.django_db
def test_sample_extrapolation_includes_inactive_pond(api_client, company_tenant, auth_admin_headers):
    """Inactive ponds are excluded from the default stock list but samples must still snapshot book head."""
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Nursing Archive", is_active=False, pond_role="nursing"
    )
    cycle = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id, pond=pond, name="Mid Cycle", code="1", start_date=date(2026, 5, 1)
    )
    h = auth_admin_headers

    led = api_client.post(
        "/api/aquaculture/fish-stock-ledger/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "production_cycle_id": cycle.id,
                "entry_date": "2026-05-01",
                "entry_kind": "adjustment",
                "loss_reason": "",
                "fish_species": "tilapia",
                "fish_count_delta": 50000,
                "weight_kg_delta": "1000",
                "book_value": "0",
                "post_to_books": False,
                "memo": "Opening position",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert led.status_code == 201, led.content.decode()

    r = api_client.post(
        "/api/aquaculture/samples/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "production_cycle_id": cycle.id,
                "sample_date": "2026-05-10",
                "fish_species": "tilapia",
                "estimated_fish_count": 45,
                "estimated_total_weight_kg": "1",
                "notes": "",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    data = json.loads(r.content.decode())
    assert data["stock_reference_fish_count"] == 50000
    assert float(data["stock_reference_avg_weight_kg"]) == pytest.approx(0.02)
    assert float(data["extrapolated_biomass_kg"]) == pytest.approx(50000 / 45, rel=0.001)


@pytest.mark.django_db
def test_sample_extrapolation_when_implied_net_weight_non_positive(api_client, company_tenant, auth_admin_headers):
    """Head count can reconcile while net kg is negative (transfer weight >> stocking weight)."""
    from api.models import AquacultureBiomassSample, AquacultureFishStockLedger

    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Nursing Demo",
        is_active=False,
        pond_role="nursing",
    )
    cycle = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        name="Nursing Mid Cycle",
        code="C01",
        start_date=date(2026, 5, 1),
    )
    AquacultureFishStockLedger.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=cycle,
        entry_date=date(2026, 5, 1),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=500000,
        weight_kg_delta=Decimal("166.6667"),
        memo="Fry stocking",
    )
    AquacultureFishStockLedger.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=cycle,
        entry_date=date(2026, 5, 5),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=-370000,
        weight_kg_delta=Decimal("-5753.2490"),
        memo="Transfer out weight mismatch demo",
    )
    sample = AquacultureBiomassSample.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=cycle,
        sample_date=date(2026, 6, 16),
        fish_species="tilapia",
        estimated_fish_count=45,
        estimated_total_weight_kg=Decimal("1"),
        avg_weight_kg=Decimal("0.022222"),
    )
    from api.services.aquaculture_biomass_sample_service import apply_aquaculture_biomass_sample_extrapolation

    apply_aquaculture_biomass_sample_extrapolation(sample)
    sample.save()

    assert sample.stock_reference_fish_count == 130000
    assert sample.stock_reference_avg_weight_kg is not None
    assert float(sample.stock_reference_avg_weight_kg) == pytest.approx(0.000333, rel=0.01)
    assert float(sample.extrapolated_biomass_kg) == pytest.approx(130000 / 45, rel=0.001)
    assert sample.biomass_gain_kg is not None
    assert float(sample.biomass_gain_kg) > 0


@pytest.mark.django_db
def test_fish_stock_position_accepts_fish_species_filter(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P2", is_active=True)
    h = auth_admin_headers
    api_client.post(
        "/api/aquaculture/fish-stock-ledger/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "entry_date": "2026-05-02",
                "entry_kind": "adjustment",
                "loss_reason": "",
                "fish_species": "tilapia",
                "fish_count_delta": 100,
                "weight_kg_delta": "20",
                "book_value": "0",
                "post_to_books": False,
                "memo": "",
            }
        ),
        content_type="application/json",
        **h,
    )
    r_all = api_client.get(f"/api/aquaculture/fish-stock-position/?pond_id={pond.id}", **h)
    r_til = api_client.get(f"/api/aquaculture/fish-stock-position/?pond_id={pond.id}&fish_species=tilapia", **h)
    assert r_all.status_code == 200
    assert r_til.status_code == 200
    body_all = json.loads(r_all.content.decode())
    body_til = json.loads(r_til.content.decode())
    assert body_all["rows"][0]["implied_net_fish_count"] == 100
    assert body_til["rows"][0]["implied_net_fish_count"] == 100
