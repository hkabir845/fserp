"""Biomass sample market valuation and margin snapshots."""
from __future__ import annotations

import json

from decimal import Decimal

import pytest

from api.models import AquacultureBiomassSample, AquaculturePond, Company


@pytest.mark.django_db
def test_sample_without_market_price_has_null_valuation(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="Grow1", is_active=True)
    h = auth_admin_headers

    api_client.post(
        "/api/aquaculture/fish-stock-ledger/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "entry_date": "2026-05-01",
                "entry_kind": "adjustment",
                "loss_reason": "",
                "fish_species": "tilapia",
                "fish_count_delta": 10000,
                "weight_kg_delta": "2000",
                "book_value": "0",
                "post_to_books": False,
                "memo": "Opening position",
            }
        ),
        content_type="application/json",
        **h,
    )

    r = api_client.post(
        "/api/aquaculture/samples/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "sample_date": "2026-05-10",
                "fish_species": "tilapia",
                "estimated_fish_count": 10,
                "estimated_total_weight_kg": "2.5",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    data = json.loads(r.content.decode())
    assert data["market_price_per_kg"] is None
    assert data["market_value"] is None
    assert data["bioasset_margin"] is None
    assert data["full_cycle_margin"] is None


@pytest.mark.django_db
def test_sample_with_market_price_computes_valuation(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="Grow1", is_active=True)
    h = auth_admin_headers

    api_client.post(
        "/api/aquaculture/fish-stock-ledger/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "entry_date": "2026-05-01",
                "entry_kind": "adjustment",
                "loss_reason": "",
                "fish_species": "tilapia",
                "fish_count_delta": 10000,
                "weight_kg_delta": "2000",
                "book_value": "0",
                "post_to_books": False,
                "memo": "Opening position",
            }
        ),
        content_type="application/json",
        **h,
    )

    r = api_client.post(
        "/api/aquaculture/samples/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "sample_date": "2026-05-10",
                "fish_species": "tilapia",
                "estimated_fish_count": 10,
                "estimated_total_weight_kg": "2.5",
                "market_price_per_kg": "200",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    data = json.loads(r.content.decode())
    assert float(data["extrapolated_biomass_kg"]) == pytest.approx(2500.0, rel=0.001)
    assert float(data["market_value"]) == pytest.approx(500_000.0, rel=0.001)
    assert data["bioasset_margin"] is not None
    assert data["full_cycle_margin"] is not None
    assert float(data["bioasset_margin"]) == pytest.approx(float(data["market_value"]), rel=0.001)
    assert float(data["full_cycle_margin"]) == pytest.approx(float(data["market_value"]), rel=0.001)

    sample = AquacultureBiomassSample.objects.get(pk=data["id"])
    assert sample.market_price_per_kg == pytest.approx(Decimal("200"))


@pytest.mark.django_db
def test_valuation_preview_endpoint(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="Grow1", is_active=True)
    h = auth_admin_headers

    r = api_client.get(
        "/api/aquaculture/samples/valuation-preview/",
        {
            "pond_id": pond.id,
            "sample_date": "2026-05-10",
            "extrapolated_biomass_kg": "1000",
            "market_price_per_kg": "150",
        },
        **h,
    )
    assert r.status_code == 200, r.content.decode()
    data = json.loads(r.content.decode())
    assert float(data["market_value"]) == pytest.approx(150_000.0, rel=0.001)


@pytest.mark.django_db
def test_sampling_report_includes_valuation_fields(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="Grow1", is_active=True)
    h = auth_admin_headers

    api_client.post(
        "/api/aquaculture/fish-stock-ledger/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "entry_date": "2026-06-01",
                "entry_kind": "adjustment",
                "loss_reason": "",
                "fish_species": "tilapia",
                "fish_count_delta": 5000,
                "weight_kg_delta": "1000",
                "book_value": "0",
                "post_to_books": False,
                "memo": "Opening",
            }
        ),
        content_type="application/json",
        **h,
    )
    api_client.post(
        "/api/aquaculture/samples/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "sample_date": "2026-06-05",
                "fish_species": "tilapia",
                "estimated_fish_count": 10,
                "estimated_total_weight_kg": "2",
                "market_price_per_kg": "180",
            }
        ),
        content_type="application/json",
        **h,
    )

    r = api_client.get(
        "/api/reports/aquaculture-sampling/",
        {
            "start_date": "2026-06-01",
            "end_date": "2026-06-30",
        },
        **h,
    )
    assert r.status_code == 200, r.content.decode()
    payload = json.loads(r.content.decode())
    groups = payload.get("groups") or payload.get("data", {}).get("groups") or []
    assert len(groups) == 1
    lines = groups[0]["lines"]
    ln = lines[0]
    assert ln["market_price_per_kg"] == "180.00"
    assert ln["market_value"]
    assert "bioasset_margin" in ln
    assert "full_cycle_margin" in ln
