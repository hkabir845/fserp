"""A harvest sale must save even if the derived biomass valuation snapshot fails.

The valuation runs a deep P&L / bio-cost computation as a side effect of saving a fish
sale. A failure there is analytics-only and must never surface as a 500 ("request failed")
on the sale POST — the sale is the source-of-truth record.
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureBiomassSample,
    AquacultureFishSale,
    AquaculturePond,
    AquacultureProductionCycle,
    Bill,
    BillLine,
    Company,
    Item,
    Vendor,
)


def _seed_stocked_pond(cid):
    pond = AquaculturePond.objects.create(
        company_id=cid, name="Res Pond", pond_role="grow_out", is_active=True
    )
    cy = AquacultureProductionCycle.objects.create(
        company_id=cid, pond=pond, name="Res Cycle", start_date=date(2026, 1, 1)
    )
    vendor = Vendor.objects.create(company_id=cid, company_name="Fry Co")
    fish_item = Item.objects.create(
        company_id=cid, name="Tilapia Fingerling", pos_category="fish",
        unit="kg", unit_price=Decimal("100"), cost=Decimal("80"),
    )
    bill = Bill.objects.create(
        company_id=cid, vendor=vendor, bill_number="B-FRY-RES",
        bill_date=date(2026, 1, 5), status="posted",
        stock_receipt_applied=True, total=Decimal("10000"),
    )
    BillLine.objects.create(
        bill=bill, item=fish_item, quantity=Decimal("1"), amount=Decimal("10000"),
        aquaculture_pond=pond, aquaculture_production_cycle=cy,
        aquaculture_fish_count=20000, aquaculture_fish_weight_kg=Decimal("200"),
    )
    return pond, cy


@pytest.mark.django_db
def test_harvest_sale_saves_when_valuation_raises(
    api_client, company_tenant, auth_admin_headers, monkeypatch
):
    Company.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    pond, cy = _seed_stocked_pond(company_tenant.id)

    import api.services.aquaculture_biomass_sample_valuation_service as val_mod

    def boom(*a, **k):
        raise RuntimeError("simulated deep P&L failure")

    monkeypatch.setattr(val_mod, "compute_biomass_sample_valuation_dict", boom)

    payload = {
        "pond_id": pond.id, "sale_date": "2026-04-01", "weight_kg": 50,
        "total_amount": 25000, "income_type": "fish_harvest_sale",
        "fish_species": "tilapia", "buyer_name": "Buyer", "memo": "x",
        "production_cycle_id": cy.id, "fish_count": 5000,
    }
    r = api_client.post(
        "/api/aquaculture/sales/", data=json.dumps(payload),
        content_type="application/json", HTTP_X_COMPANY_ID=str(company_tenant.id),
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()[:1000]
    # Sale persisted, and the base biomass sample exists with a cleared (null) valuation.
    sale = AquacultureFishSale.objects.get(pond_id=pond.id)
    sample = AquacultureBiomassSample.objects.get(source_fish_sale_id=sale.id)
    assert sample.market_value is None
    assert sample.estimated_fish_count == 5000
