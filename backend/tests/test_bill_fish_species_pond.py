"""Fish purchase bill lines: species (required) + destination pond (required), and stored-species reporting."""
from __future__ import annotations

import json
from decimal import Decimal

import pytest

from api.models import AquaculturePond, BillLine, Company, Item, Station
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows


def _vendor(api_client, headers, name):
    r = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": name}),
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 201, r.content.decode()
    return json.loads(r.content)["id"]


def _fish_item(company_id, name):
    return Item.objects.create(
        company_id=company_id,
        name=name,
        item_type="inventory",
        pos_category="fish",
        unit="piece",
        category="Aquaculture",
    )


@pytest.mark.django_db
def test_fish_bill_stores_species_and_pond(api_client, company_tenant, auth_admin_headers):
    h = auth_admin_headers
    vendor_id = _vendor(api_client, h, "Hatchery Species")
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Nursing S", pond_role="nursing", is_active=True
    )
    fry = _fish_item(company_tenant.id, "Pangas Fry")

    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "bill_date": "2026-05-08",
                "subtotal": "100.00",
                "tax_total": "0",
                "total": "100.00",
                "status": "draft",
                "lines": [
                    {
                        "description": "Pangas Fry",
                        "item_id": fry.id,
                        "quantity": "1",
                        "unit_cost": "100.00",
                        "amount": "100.00",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_fish_species": "pangas",
                        "aquaculture_fish_weight_kg": "10",
                        "aquaculture_fish_count": 3000,
                    },
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    line = json.loads(r.content)["lines"][0]
    assert line["aquaculture_fish_species"] == "pangas"
    assert line["aquaculture_fish_species_label"] == "Pangas"

    bl = BillLine.objects.get(pk=line["id"])
    assert bl.aquaculture_fish_species == "pangas"
    assert bl.aquaculture_pond_id == pond.id


@pytest.mark.django_db
def test_fish_bill_other_species_keeps_free_text(api_client, company_tenant, auth_admin_headers):
    h = auth_admin_headers
    vendor_id = _vendor(api_client, h, "Hatchery Other")
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Nursing O", pond_role="nursing", is_active=True
    )
    fry = _fish_item(company_tenant.id, "Mystery Fry")

    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "bill_date": "2026-05-08",
                "subtotal": "50.00",
                "tax_total": "0",
                "total": "50.00",
                "status": "draft",
                "lines": [
                    {
                        "description": "Mystery Fry",
                        "item_id": fry.id,
                        "quantity": "1",
                        "unit_cost": "50.00",
                        "amount": "50.00",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_fish_species": "other",
                        "aquaculture_fish_species_other": "Koi carp",
                        "aquaculture_fish_weight_kg": "5",
                        "aquaculture_fish_count": 1000,
                    },
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    line = json.loads(r.content)["lines"][0]
    assert line["aquaculture_fish_species"] == "other"
    assert line["aquaculture_fish_species_other"] == "Koi carp"
    assert line["aquaculture_fish_species_label"] == "Other: Koi carp"


@pytest.mark.django_db
def test_fish_bill_missing_species_rejected(api_client, company_tenant, auth_admin_headers):
    h = auth_admin_headers
    vendor_id = _vendor(api_client, h, "Hatchery NoSpecies")
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Nursing NS", pond_role="nursing", is_active=True
    )
    fry = _fish_item(company_tenant.id, "Tilapia Fry NS")

    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "bill_date": "2026-05-08",
                "subtotal": "100.00",
                "tax_total": "0",
                "total": "100.00",
                "status": "draft",
                "lines": [
                    {
                        "description": "Tilapia Fry NS",
                        "item_id": fry.id,
                        "quantity": "1",
                        "unit_cost": "100.00",
                        "amount": "100.00",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_fish_weight_kg": "10",
                        "aquaculture_fish_count": 1000,
                    },
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 400
    assert "species" in json.loads(r.content)["detail"].lower()


@pytest.mark.django_db
def test_fish_bill_missing_pond_rejected(api_client, company_tenant, auth_admin_headers):
    h = auth_admin_headers
    vendor_id = _vendor(api_client, h, "Hatchery NoPond")
    fry = _fish_item(company_tenant.id, "Tilapia Fry NP")

    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "bill_date": "2026-05-08",
                "subtotal": "100.00",
                "tax_total": "0",
                "total": "100.00",
                "status": "draft",
                "lines": [
                    {
                        "description": "Tilapia Fry NP",
                        "item_id": fry.id,
                        "quantity": "1",
                        "unit_cost": "100.00",
                        "amount": "100.00",
                        "aquaculture_fish_species": "tilapia",
                        "aquaculture_fish_weight_kg": "10",
                        "aquaculture_fish_count": 1000,
                    },
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 400
    assert "pond" in json.loads(r.content)["detail"].lower()


@pytest.mark.django_db
def test_fish_stock_position_uses_stored_species(api_client, company_tenant, auth_admin_headers):
    """A pangas line posted into a pond is bucketed under pangas via stored species, not item-name guessing."""
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    Station.objects.create(company_id=company_tenant.id, station_name="Shop SP", is_active=True)
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Grow SP", pond_role="grow_out", is_active=True
    )
    h = auth_admin_headers
    vendor_id = _vendor(api_client, h, "Hatchery Pos")
    # Item name says nothing about pangas; only the stored species classifies it.
    fish = _fish_item(company_tenant.id, "Premium Fingerling Batch")

    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "bill_date": "2026-05-09",
                "subtotal": "200.00",
                "tax_total": "0",
                "total": "200.00",
                "status": "open",
                "lines": [
                    {
                        "description": "Pangas fingerling",
                        "item_id": fish.id,
                        "quantity": "1",
                        "unit_cost": "200.00",
                        "amount": "200.00",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_fish_species": "pangas",
                        "aquaculture_fish_weight_kg": "40",
                        "aquaculture_fish_count": 20000,
                    },
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()

    pangas = compute_fish_stock_position_rows(
        company_tenant.id, pond_id=pond.id, fish_species_filter="pangas"
    )
    assert len(pangas) == 1
    assert pangas[0]["vendor_bill_in_fish_count"] == 20000
    assert Decimal(pangas[0]["vendor_bill_in_weight_kg"]) == Decimal("40")

    # Filtering by tilapia must not pick up the pangas line.
    tilapia = compute_fish_stock_position_rows(
        company_tenant.id, pond_id=pond.id, fish_species_filter="tilapia"
    )
    assert all(row["vendor_bill_in_fish_count"] == 0 for row in tilapia)
