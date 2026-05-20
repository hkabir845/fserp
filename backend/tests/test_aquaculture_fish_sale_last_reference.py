"""Last fish sale reference for stock ledger book value."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import AquacultureFishSale, AquaculturePond, AquacultureProductionCycle, Company
from api.services.aquaculture_sale_reference_service import (
    last_fish_sale_reference_for_ledger,
    suggest_ledger_book_value_from_sale,
)


@pytest.mark.django_db
def test_last_reference_matches_pond_cycle_species(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)
    cy = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        name="C1",
        start_date=date(2026, 1, 1),
    )
    AquacultureFishSale.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=cy,
        fish_species="tilapia",
        sale_date=date(2026, 4, 1),
        weight_kg=Decimal("100"),
        fish_count=5000,
        total_amount=Decimal("20000"),
        income_type="fish_harvest_sale",
    )
    AquacultureFishSale.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=cy,
        fish_species="tilapia",
        sale_date=date(2026, 5, 1),
        weight_kg=Decimal("50"),
        fish_count=2000,
        total_amount=Decimal("15000"),
        income_type="fish_harvest_sale",
    )
    ref = last_fish_sale_reference_for_ledger(
        company_tenant.id,
        pond_id=pond.id,
        production_cycle_id=cy.id,
        fish_species="tilapia",
    )
    assert ref is not None
    assert ref["sale_id"] == AquacultureFishSale.objects.order_by("-sale_date").first().id
    assert float(ref["price_per_kg"]) == pytest.approx(300.0)
    assert suggest_ledger_book_value_from_sale(price_per_kg=ref["price_per_kg"], weight_kg="10") == "3000.00"

    h = auth_admin_headers
    r = api_client.get(
        "/api/aquaculture/fish-sales/last-reference/",
        {"pond_id": pond.id, "production_cycle_id": cy.id, "fish_species": "tilapia"},
        **h,
    )
    assert r.status_code == 200
    body = json.loads(r.content.decode())
    assert body["found"] is True
    assert float(body["price_per_kg"]) == pytest.approx(300.0)
