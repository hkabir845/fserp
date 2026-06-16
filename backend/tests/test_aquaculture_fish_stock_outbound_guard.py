"""Outbound fish movements must not exceed implied pond stock (count + kg)."""
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
    Item,
    Vendor,
)
from api.services.aquaculture_stock_service import assert_outbound_fish_within_implied_stock


@pytest.mark.django_db
def test_assert_outbound_blocks_when_no_stock(company_tenant):
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Guard Pond",
        pond_role="grow_out",
        is_active=True,
    )
    err = assert_outbound_fish_within_implied_stock(
        company_tenant.id,
        pond.id,
        production_cycle_id=None,
        fish_species="tilapia",
        fish_count=1000,
        weight_kg=Decimal("50"),
    )
    assert err is not None
    assert "Insufficient fish stock" in err


@pytest.mark.django_db
def test_assert_outbound_allows_after_vendor_fry_receipt(company_tenant):
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Stocked Pond",
        pond_role="grow_out",
        is_active=True,
    )
    vendor = Vendor.objects.create(company_id=company_tenant.id, company_name="Fry Vendor")
    fish_item = Item.objects.create(
        company_id=company_tenant.id,
        name="Tilapia Fry",
        pos_category="fish",
        unit="kg",
        unit_price=Decimal("100"),
        cost=Decimal("80"),
    )
    bill = Bill.objects.create(
        company_id=company_tenant.id,
        vendor=vendor,
        bill_number="B-FRY-1",
        bill_date=date(2026, 5, 1),
        status="posted",
        stock_receipt_applied=True,
        total=Decimal("5000"),
    )
    BillLine.objects.create(
        bill=bill,
        item=fish_item,
        quantity=Decimal("1"),
        amount=Decimal("5000"),
        aquaculture_pond=pond,
        aquaculture_fish_count=50000,
        aquaculture_fish_weight_kg=Decimal("500"),
    )
    err = assert_outbound_fish_within_implied_stock(
        company_tenant.id,
        pond.id,
        production_cycle_id=None,
        fish_species="tilapia",
        fish_count=10000,
        weight_kg=Decimal("100"),
    )
    assert err is None


@pytest.mark.django_db
def test_assert_outbound_allows_transfer_weight_from_biomass_sample_after_fry_stocking(company_tenant):
    """
    Fry bills record tiny kg vs head count; transfers use seine pcs/kg.
    Outbound guard must use sample-based biomass, not transaction book weight alone.
    """
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Nursing Pond",
        pond_role="nursing",
        physical_site_name="Site-A",
        is_active=True,
    )
    cy = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        name="Mid Cycle",
        start_date=date(2026, 1, 1),
    )
    vendor = Vendor.objects.create(company_id=company_tenant.id, company_name="Fry Vendor")
    fish_item = Item.objects.create(
        company_id=company_tenant.id,
        name="Tilapia Fry",
        pos_category="fish",
        unit="kg",
        unit_price=Decimal("100"),
        cost=Decimal("80"),
    )
    bill = Bill.objects.create(
        company_id=company_tenant.id,
        vendor=vendor,
        bill_number="B-FRY-N",
        bill_date=date(2026, 4, 1),
        status="posted",
        stock_receipt_applied=True,
        total=Decimal("5000"),
    )
    BillLine.objects.create(
        bill=bill,
        item=fish_item,
        quantity=Decimal("1"),
        amount=Decimal("5000"),
        aquaculture_pond=pond,
        aquaculture_production_cycle=cy,
        aquaculture_fish_count=500000,
        aquaculture_fish_weight_kg=Decimal("166.6667"),
    )
    AquacultureBiomassSample.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        production_cycle=cy,
        fish_species="tilapia",
        sample_date=date(2026, 6, 16),
        estimated_fish_count=45,
        estimated_total_weight_kg=Decimal("1"),
        stock_reference_fish_count=498650,
        extrapolated_biomass_kg=Decimal("11081"),
    )
    err = assert_outbound_fish_within_implied_stock(
        company_tenant.id,
        pond.id,
        production_cycle_id=cy.id,
        fish_species="tilapia",
        fish_count=50000,
        weight_kg=Decimal("1111.11"),
    )
    assert err is None


@pytest.mark.django_db
def test_api_rejects_harvest_sale_over_stock(api_client, company_tenant, auth_accountant_headers):
    company_tenant.aquaculture_enabled = True
    company_tenant.aquaculture_licensed = True
    company_tenant.save(update_fields=["aquaculture_enabled", "aquaculture_licensed"])
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Sale Guard Pond",
        pond_role="grow_out",
        is_active=True,
    )
    r = api_client.post(
        "/api/aquaculture/sales/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "sale_date": "2026-05-15",
                "income_type": "fish_harvest_sale",
                "fish_species": "tilapia",
                "weight_kg": "100",
                "fish_count": 5000,
                "total_amount": "50000",
            }
        ),
        content_type="application/json",
        HTTP_X_COMPANY_ID=str(company_tenant.id),
        **auth_accountant_headers,
    )
    assert r.status_code == 400
    body = json.loads(r.content)
    assert "Insufficient fish stock" in body.get("detail", "")


@pytest.mark.django_db
def test_api_allows_harvest_sale_within_stock(api_client, company_tenant, auth_accountant_headers):
    company_tenant.aquaculture_enabled = True
    company_tenant.aquaculture_licensed = True
    company_tenant.save(update_fields=["aquaculture_enabled", "aquaculture_licensed"])
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Sale OK Pond",
        pond_role="grow_out",
        is_active=True,
    )
    vendor = Vendor.objects.create(company_id=company_tenant.id, company_name="Fry Co")
    fish_item = Item.objects.create(
        company_id=company_tenant.id,
        name="Tilapia Fingerling",
        pos_category="fish",
        unit="kg",
        unit_price=Decimal("100"),
        cost=Decimal("80"),
    )
    bill = Bill.objects.create(
        company_id=company_tenant.id,
        vendor=vendor,
        bill_number="B-FRY-2",
        bill_date=date(2026, 5, 1),
        status="posted",
        stock_receipt_applied=True,
        total=Decimal("10000"),
    )
    BillLine.objects.create(
        bill=bill,
        item=fish_item,
        quantity=Decimal("1"),
        amount=Decimal("10000"),
        aquaculture_pond=pond,
        aquaculture_fish_count=20000,
        aquaculture_fish_weight_kg=Decimal("200"),
    )
    r = api_client.post(
        "/api/aquaculture/sales/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "sale_date": "2026-05-15",
                "income_type": "fish_harvest_sale",
                "fish_species": "tilapia",
                "weight_kg": "50",
                "fish_count": 5000,
                "total_amount": "25000",
            }
        ),
        content_type="application/json",
        HTTP_X_COMPANY_ID=str(company_tenant.id),
        **auth_accountant_headers,
    )
    assert r.status_code == 201, r.content.decode()
    assert AquacultureFishSale.objects.filter(pond_id=pond.id).count() == 1
