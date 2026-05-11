"""Aquaculture API: kg + head count required together (samples, transfers, stock ledger)."""
from __future__ import annotations

import json

import pytest

from api.models import AquaculturePond, Company


@pytest.mark.django_db
def test_sample_rejects_missing_total_weight(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="S1", is_active=True)
    h = auth_admin_headers
    r = api_client.post(
        "/api/aquaculture/samples/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "sample_date": "2026-06-01",
                "fish_species": "tilapia",
                "estimated_fish_count": 1000,
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 400


@pytest.mark.django_db
def test_transfer_rejects_line_without_fish_count(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    a = AquaculturePond.objects.create(company_id=company_tenant.id, name="A", is_active=True)
    b = AquaculturePond.objects.create(company_id=company_tenant.id, name="B", is_active=True)
    h = auth_admin_headers
    r = api_client.post(
        "/api/aquaculture/fish-pond-transfers/",
        data=json.dumps(
            {
                "from_pond_id": a.id,
                "transfer_date": "2026-06-02",
                "fish_species": "tilapia",
                "lines": [{"to_pond_id": b.id, "weight_kg": "100"}],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 400
    detail = (json.loads(r.content.decode()).get("detail") or "").lower()
    assert "fish_count" in detail


@pytest.mark.django_db
def test_stock_ledger_rejects_single_dimension_delta(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="L1", is_active=True)
    h = auth_admin_headers
    r = api_client.post(
        "/api/aquaculture/fish-stock-ledger/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "entry_date": "2026-06-03",
                "entry_kind": "loss",
                "loss_reason": "mortality",
                "fish_species": "tilapia",
                "fish_count_delta": -5,
                "weight_kg_delta": "0",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 400
    assert "non-zero" in (json.loads(r.content.decode()).get("detail") or "").lower()
