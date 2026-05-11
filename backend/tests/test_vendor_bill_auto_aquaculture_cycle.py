"""Vendor bills: auto-create production cycle when a line tags a pond but omits cycle_id."""
from __future__ import annotations

import json

import pytest

from api.models import AquaculturePond, AquacultureProductionCycle, Company, Station, Vendor


@pytest.mark.django_db
def test_vendor_bill_auto_creates_shared_cycle_per_pond(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    Station.objects.create(company_id=company_tenant.id, station_name="Recv", is_active=True)
    nursing = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Nursing A", pond_role="nursing", is_active=True
    )
    grow = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Grow B", pond_role="grow_out", is_active=True
    )

    h = auth_admin_headers
    v = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": "Hatchery Supply"}),
        content_type="application/json",
        **h,
    )
    assert v.status_code == 201
    vendor_id = json.loads(v.content)["id"]

    bill_r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "bill_date": "2026-05-10",
                "subtotal": "50000.00",
                "tax_total": "0",
                "total": "50000.00",
                "status": "draft",
                "lines": [
                    {
                        "description": "Tilapia fry",
                        "quantity": "1",
                        "unit_cost": "30000.00",
                        "amount": "30000.00",
                        "aquaculture_pond_id": nursing.id,
                        "aquaculture_cost_bucket": "fry_stocking",
                    },
                    {
                        "description": "Transport",
                        "quantity": "1",
                        "unit_cost": "20000.00",
                        "amount": "20000.00",
                        "aquaculture_pond_id": nursing.id,
                    },
                    {
                        "description": "Lime (other pond)",
                        "quantity": "1",
                        "unit_cost": "100.00",
                        "amount": "100.00",
                        "aquaculture_pond_id": grow.id,
                    },
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert bill_r.status_code == 201, bill_r.content.decode()
    bill = json.loads(bill_r.content)
    lines = bill["lines"]
    assert len(lines) == 3
    n_cy = lines[0]["aquaculture_production_cycle_id"]
    assert n_cy is not None
    assert lines[1]["aquaculture_production_cycle_id"] == n_cy
    g_cy = lines[2]["aquaculture_production_cycle_id"]
    assert g_cy is not None
    assert g_cy != n_cy

    cycles = list(AquacultureProductionCycle.objects.filter(company_id=company_tenant.id).order_by("id"))
    assert len(cycles) == 2
    assert cycles[0].pond_id == nursing.id
    assert cycles[1].pond_id == grow.id
    assert bill["bill_number"] in (cycles[0].name or "")
    assert cycles[0].start_date.isoformat() == "2026-05-10"


@pytest.mark.django_db
def test_vendor_bill_inherits_explicit_cycle_on_same_bill(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    Station.objects.create(company_id=company_tenant.id, station_name="Recv2", is_active=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)
    existing = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        name="Manual batch",
        code="C99",
        start_date="2026-01-01",
        end_date=None,
    )
    h = auth_admin_headers
    v = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": "V2"}),
        content_type="application/json",
        **h,
    )
    assert v.status_code == 201
    vendor_id = json.loads(v.content)["id"]

    bill_r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "subtotal": "10.00",
                "tax_total": "0",
                "total": "10.00",
                "status": "draft",
                "lines": [
                    {
                        "description": "A",
                        "quantity": "1",
                        "unit_cost": "5.00",
                        "amount": "5.00",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_production_cycle_id": existing.id,
                    },
                    {
                        "description": "B",
                        "quantity": "1",
                        "unit_cost": "5.00",
                        "amount": "5.00",
                        "aquaculture_pond_id": pond.id,
                    },
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert bill_r.status_code == 201
    bill = json.loads(bill_r.content)
    assert bill["lines"][0]["aquaculture_production_cycle_id"] == existing.id
    assert bill["lines"][1]["aquaculture_production_cycle_id"] == existing.id
    assert AquacultureProductionCycle.objects.filter(company_id=company_tenant.id, pond=pond).count() == 1


@pytest.mark.django_db
def test_vendor_bill_skips_auto_cycle_when_aquaculture_disabled(
    api_client, company_tenant, auth_admin_headers
):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=False, aquaculture_licensed=False)
    Station.objects.create(company_id=company_tenant.id, station_name="Recv3", is_active=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="Px", is_active=True)
    h = auth_admin_headers
    v = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": "V3"}),
        content_type="application/json",
        **h,
    )
    assert v.status_code == 201
    vendor_id = json.loads(v.content)["id"]

    bill_r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "subtotal": "1.00",
                "tax_total": "0",
                "total": "1.00",
                "status": "draft",
                "lines": [
                    {
                        "description": "Fry",
                        "quantity": "1",
                        "unit_cost": "1.00",
                        "amount": "1.00",
                        "aquaculture_pond_id": pond.id,
                    },
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert bill_r.status_code == 201
    bill = json.loads(bill_r.content)
    assert bill["lines"][0].get("aquaculture_production_cycle_id") in (None, "")
    assert AquacultureProductionCycle.objects.filter(company_id=company_tenant.id).count() == 0
