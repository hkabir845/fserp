"""Biomass sampling extrapolates pond biomass from net-caught sample vs transactional fish stock."""
from __future__ import annotations

import json

import pytest

from api.models import AquaculturePond, Company


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
