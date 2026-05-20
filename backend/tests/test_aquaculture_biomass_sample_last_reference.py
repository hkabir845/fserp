"""Last biomass sample reference for stock ledger quantities."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import AquacultureBiomassSample, AquaculturePond, AquacultureProductionCycle, Company
from api.services.aquaculture_biomass_sample_reference_service import last_biomass_sample_reference_for_ledger


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
