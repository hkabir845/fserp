"""Last biomass sample reference for stock ledger quantities."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureBiomassSample,
    AquacultureDataBankPondClose,
    AquaculturePond,
    AquacultureProductionCycle,
    Company,
)
from api.services.aquaculture_biomass_sample_reference_service import last_biomass_sample_reference_for_ledger
from api.services.aquaculture_data_bank_service import close_pond


@pytest.mark.django_db
def test_last_biomass_sample_reference_for_ledger(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)
    cy = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        name="C1",
        start_date=date(2026, 1, 1),
    )
    AquacultureBiomassSample.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=cy,
        fish_species="tilapia",
        sample_date=date(2026, 5, 1),
        estimated_fish_count=10000,
        estimated_total_weight_kg=Decimal("2000"),
    )
    ref = last_biomass_sample_reference_for_ledger(
        company_tenant.id,
        pond_id=pond.id,
        production_cycle_id=cy.id,
        fish_species="tilapia",
    )
    assert ref is not None
    assert ref["estimated_fish_count"] == 10000
    assert float(ref["fish_per_kg"]) == pytest.approx(5.0)

    h = auth_admin_headers
    r = api_client.get(
        "/api/aquaculture/biomass-samples/last-reference/",
        {"pond_id": pond.id, "production_cycle_id": cy.id, "fish_species": "tilapia"},
        **h,
    )
    assert r.status_code == 200
    body = json.loads(r.content.decode())
    assert body["found"] is True
    assert body["estimated_fish_count"] == 10000


@pytest.mark.django_db
def test_last_biomass_sample_without_cycle_finds_cycle_tagged_sample(
    api_client, company_tenant, auth_admin_headers
):
    """Transfers often leave source cycle blank; latest pond sample must still resolve."""
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="Nursing", is_active=True)
    cy = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        name="Mid Cycle",
        start_date=date(2026, 1, 1),
    )
    AquacultureBiomassSample.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=cy,
        fish_species="tilapia",
        sample_date=date(2026, 5, 15),
        estimated_fish_count=620650,
        estimated_total_weight_kg=Decimal("12413"),
    )
    ref = last_biomass_sample_reference_for_ledger(
        company_tenant.id,
        pond_id=pond.id,
        production_cycle_id=None,
        fish_species="tilapia",
    )
    assert ref is not None
    assert float(ref["fish_per_kg"]) == pytest.approx(50.0, rel=0.01)

    h = auth_admin_headers
    r = api_client.get(
        "/api/aquaculture/biomass-samples/last-reference/",
        {"pond_id": pond.id, "fish_species": "tilapia"},
        **h,
    )
    assert r.status_code == 200
    body = json.loads(r.content.decode())
    assert body["found"] is True
    assert body["production_cycle_id"] == cy.id


@pytest.mark.django_db
def test_last_biomass_sample_ignores_archived_data_bank_period(
    api_client, company_tenant, auth_admin_headers
):
    """Live transfer UI must match the sampling list — not older archived samples."""
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="Digonta Nursing", is_active=True)
    old_cy = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        name="Old Cycle",
        start_date=date(2025, 1, 1),
    )
    new_cy = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        name="Nursing Mid Cycle",
        start_date=date(2026, 1, 1),
    )
    close_pond(
        company_id=company_tenant.id,
        pond_id=pond.id,
        period_end=date(2025, 12, 31),
        period_start=date(2025, 1, 1),
        user=None,
    )
    AquacultureBiomassSample.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=old_cy,
        fish_species="tilapia",
        sample_date=date(2025, 11, 1),
        estimated_fish_count=100,
        estimated_total_weight_kg=Decimal("10"),
    )
    AquacultureBiomassSample.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=new_cy,
        fish_species="tilapia",
        sample_date=date(2026, 6, 16),
        estimated_fish_count=45,
        estimated_total_weight_kg=Decimal("1"),
    )

    ref = last_biomass_sample_reference_for_ledger(
        company_tenant.id,
        pond_id=pond.id,
        production_cycle_id=None,
        fish_species="tilapia",
    )
    assert ref is not None
    assert ref["sample_date"] == "2026-06-16"
    assert ref["pond_name"] == "Digonta"
    assert float(ref["fish_per_kg"]) == pytest.approx(45.0)
    assert ref["production_cycle_id"] == new_cy.id

    h = auth_admin_headers
    r = api_client.get(
        "/api/aquaculture/biomass-samples/last-reference/",
        {"pond_id": pond.id, "fish_species": "tilapia"},
        **h,
    )
    assert r.status_code == 200
    body = json.loads(r.content.decode())
    assert body["found"] is True
    assert body["sample_date"] == "2026-06-16"
    assert float(body["fish_per_kg"]) == pytest.approx(45.0)


@pytest.mark.django_db
def test_last_biomass_sample_cycle_fallback_when_selected_cycle_has_no_sample(
    api_client, company_tenant, auth_admin_headers
):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)
    sampled_cy = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        name="Nursing Mid Cycle",
        start_date=date(2026, 1, 1),
    )
    empty_cy = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        name="Other Cycle",
        start_date=date(2026, 1, 1),
    )
    AquacultureBiomassSample.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=sampled_cy,
        fish_species="tilapia",
        sample_date=date(2026, 6, 16),
        estimated_fish_count=45,
        estimated_total_weight_kg=Decimal("1"),
    )

    ref = last_biomass_sample_reference_for_ledger(
        company_tenant.id,
        pond_id=pond.id,
        production_cycle_id=empty_cy.id,
        fish_species="tilapia",
    )
    assert ref is not None
    assert ref["cycle_scope_fallback"] is True
    assert ref["production_cycle_id"] == sampled_cy.id
    assert float(ref["fish_per_kg"]) == pytest.approx(45.0)


@pytest.mark.django_db
def test_last_biomass_sample_skips_incomplete_latest_row(api_client, company_tenant, auth_admin_headers):
    """Latest row without seine data must not block an older valid sample."""
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="Digonta Nursing", is_active=True)
    cy = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        name="Nursing Mid Cycle",
        start_date=date(2026, 1, 1),
    )
    AquacultureBiomassSample.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=cy,
        fish_species="tilapia",
        sample_date=date(2026, 6, 17),
        estimated_fish_count=None,
        estimated_total_weight_kg=None,
    )
    AquacultureBiomassSample.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=cy,
        fish_species="tilapia",
        sample_date=date(2026, 6, 16),
        estimated_fish_count=45,
        estimated_total_weight_kg=Decimal("1"),
    )

    ref = last_biomass_sample_reference_for_ledger(
        company_tenant.id,
        pond_id=pond.id,
        production_cycle_id=None,
        fish_species="tilapia",
    )
    assert ref is not None
    assert ref["sample_date"] == "2026-06-16"
    assert float(ref["fish_per_kg"]) == pytest.approx(45.0)


@pytest.mark.django_db
def test_last_biomass_sample_same_site_inactive_peer(api_client, company_tenant, auth_admin_headers):
    """Active nursing pond must resolve the latest sample recorded on an inactive same-site duplicate."""
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    nursing = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Digonta",
        pond_role="nursing",
        physical_site_name="Digonta",
        is_active=True,
    )
    legacy = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Digonta Nursing",
        pond_role="grow_out",
        physical_site_name="Digonta",
        is_active=False,
    )
    cy = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id,
        pond=legacy,
        name="Nursing Mid Cycle",
        start_date=date(2026, 1, 1),
    )
    AquacultureBiomassSample.objects.create(
        company_id=company_tenant.id,
        pond=legacy,
        production_cycle=cy,
        fish_species="tilapia",
        sample_date=date(2026, 6, 16),
        estimated_fish_count=45,
        estimated_total_weight_kg=Decimal("1"),
        stock_reference_fish_count=130000,
    )

    ref = last_biomass_sample_reference_for_ledger(
        company_tenant.id,
        pond_id=nursing.id,
        production_cycle_id=None,
        fish_species="tilapia",
    )
    assert ref is not None
    assert ref["sample_date"] == "2026-06-16"
    assert float(ref["fish_per_kg"]) == pytest.approx(45.0)
    assert ref["site_scope_fallback"] is True
    assert ref["pond_name"] == "Digonta"

    h = auth_admin_headers
    r = api_client.get(
        "/api/aquaculture/biomass-samples/last-reference/",
        {"pond_id": nursing.id, "fish_species": "tilapia"},
        **h,
    )
    assert r.status_code == 200
    body = json.loads(r.content.decode())
    assert body["found"] is True
    assert body["sample_date"] == "2026-06-16"
    assert body["site_scope_fallback"] is True


@pytest.mark.django_db
def test_samples_list_excludes_inactive_pond_rows(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    inactive = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Digonta Nursing",
        pond_role="grow_out",
        physical_site_name="Digonta",
        is_active=False,
    )
    AquacultureBiomassSample.objects.create(
        company_id=company_tenant.id,
        pond=inactive,
        fish_species="tilapia",
        sample_date=date(2026, 6, 16),
        estimated_fish_count=45,
        estimated_total_weight_kg=Decimal("1"),
    )

    h = auth_admin_headers
    r = api_client.get("/api/aquaculture/samples/", **h)
    assert r.status_code == 200
    body = json.loads(r.content.decode())
    assert body == []


@pytest.mark.django_db
def test_samples_list_without_pond_filter_excludes_archived_period(api_client, company_tenant, auth_admin_headers):
    """All-ponds sampling list must match live transfer visibility."""
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="Digonta Nursing", is_active=True)
    old_cy = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        name="Old Cycle",
        start_date=date(2025, 1, 1),
    )
    new_cy = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        name="Nursing Mid Cycle",
        start_date=date(2026, 1, 1),
    )
    close_pond(
        company_id=company_tenant.id,
        pond_id=pond.id,
        period_end=date(2025, 12, 31),
        period_start=date(2025, 1, 1),
        user=None,
    )
    AquacultureBiomassSample.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=old_cy,
        fish_species="tilapia",
        sample_date=date(2025, 11, 1),
        estimated_fish_count=100,
        estimated_total_weight_kg=Decimal("10"),
    )
    live = AquacultureBiomassSample.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=new_cy,
        fish_species="tilapia",
        sample_date=date(2026, 6, 16),
        estimated_fish_count=45,
        estimated_total_weight_kg=Decimal("1"),
    )

    h = auth_admin_headers
    r = api_client.get("/api/aquaculture/samples/", **h)
    assert r.status_code == 200
    body = json.loads(r.content.decode())
    ids = [row["id"] for row in body]
    assert live.id in ids
    assert len(ids) == 1
