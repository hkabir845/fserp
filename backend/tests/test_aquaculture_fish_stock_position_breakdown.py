"""Fish stock position breakdown by pond × production cycle × species."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import AquacultureFishStockLedger, AquaculturePond, AquacultureProductionCycle, Company


@pytest.mark.django_db
def test_fish_stock_position_breakdown_by_cycle_and_species(
    api_client, company_tenant, auth_admin_headers
):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="Poly pond", is_active=True)
    cy = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        name="C2026",
        start_date=date(2026, 1, 1),
    )
    h = auth_admin_headers
    AquacultureFishStockLedger.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=cy,
        entry_date=date(2026, 5, 1),
        entry_kind="adjustment",
        loss_reason="",
        fish_species="tilapia",
        fish_count_delta=1000,
        weight_kg_delta=Decimal("200"),
        book_value=Decimal("0"),
        post_to_books=False,
        memo="tilapia in cycle",
    )
    AquacultureFishStockLedger.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=cy,
        entry_date=date(2026, 5, 2),
        entry_kind="adjustment",
        loss_reason="",
        fish_species="pangas",
        fish_count_delta=500,
        weight_kg_delta=Decimal("100"),
        book_value=Decimal("0"),
        post_to_books=False,
        memo="pangas in cycle",
    )
    AquacultureFishStockLedger.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=None,
        entry_date=date(2026, 5, 3),
        entry_kind="adjustment",
        loss_reason="",
        fish_species="tilapia",
        fish_count_delta=50,
        weight_kg_delta=Decimal("10"),
        book_value=Decimal("0"),
        post_to_books=False,
        memo="no cycle",
    )

    r = api_client.get(
        f"/api/aquaculture/fish-stock-position/?pond_id={pond.id}&breakdown=1",
        **h,
    )
    assert r.status_code == 200
    body = json.loads(r.content.decode())
    assert body["rows"][0]["implied_net_fish_count"] == 1550
    breakdown = body["breakdown_rows"]
    assert len(breakdown) == 3
    by_key = {(b["production_cycle_id"], b["fish_species"]): b for b in breakdown}
    assert by_key[(cy.id, "tilapia")]["implied_net_fish_count"] == 1000
    assert by_key[(cy.id, "pangas")]["implied_net_fish_count"] == 500
    assert by_key[(None, "tilapia")]["implied_net_fish_count"] == 50
