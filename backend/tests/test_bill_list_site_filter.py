"""Vendor bill list site / entity scope filter."""
from __future__ import annotations

import json

import pytest

from api.models import AquaculturePond, Station, Vendor


@pytest.mark.django_db
def test_bill_list_filter_by_pond(api_client, company_tenant, auth_admin_headers):
    Company = company_tenant.__class__
    Company.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    pond_a = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Nursing A", is_active=True
    )
    pond_b = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Grow-out B", is_active=True
    )
    vendor = Vendor.objects.filter(company_id=company_tenant.id).first()
    if vendor is None:
        vendor = Vendor.objects.create(
            company_id=company_tenant.id,
            company_name="V",
            display_name="V",
            vendor_number="V-SF",
            is_active=True,
        )

    def create_pond_bill(pond_id: int, amount: str) -> int:
        r = api_client.post(
            "/api/bills/",
            data=json.dumps(
                {
                    "vendor_id": vendor.id,
                    "bill_date": "2026-06-01",
                    "status": "draft",
                    "bill_purpose": "pond",
                    "lines": [
                        {
                            "description": f"Pond {pond_id}",
                            "quantity": 1,
                            "unit_cost": amount,
                            "amount": amount,
                            "aquaculture_pond_id": pond_id,
                            "aquaculture_expense_category": "other",
                        }
                    ],
                }
            ),
            content_type="application/json",
            **auth_admin_headers,
        )
        assert r.status_code == 201, r.content
        return r.json()["id"]

    bill_a = create_pond_bill(pond_a.id, "100.00")
    bill_b = create_pond_bill(pond_b.id, "200.00")

    all_res = api_client.get("/api/bills/?skip=0&limit=50", **auth_admin_headers)
    assert all_res.status_code == 200
    all_body = all_res.json()
    all_rows = all_body["results"] if isinstance(all_body, dict) and "results" in all_body else all_body
    all_ids = {b["id"] for b in all_rows}
    assert bill_a in all_ids
    assert bill_b in all_ids

    pond_res = api_client.get(
        "/api/bills/",
        {"pond_id": str(pond_a.id), "skip": "0", "limit": "50"},
        **auth_admin_headers,
    )
    assert pond_res.status_code == 200
    pond_body = pond_res.json()
    pond_rows = pond_body["results"] if isinstance(pond_body, dict) and "results" in pond_body else pond_body
    pond_ids = {b["id"] for b in pond_rows}
    assert bill_a in pond_ids
    assert bill_b not in pond_ids


@pytest.mark.django_db
def test_bill_list_filter_by_station(api_client, company_tenant, auth_admin_headers):
    st = Station.objects.filter(company_id=company_tenant.id, is_active=True).first()
    if st is None:
        st = Station.objects.create(
            company_id=company_tenant.id,
            station_name="Filter Test Station",
            station_number="FTS-1",
            is_active=True,
            operates_fuel_retail=True,
        )
    vendor = Vendor.objects.filter(company_id=company_tenant.id).first()
    if vendor is None:
        vendor = Vendor.objects.create(
            company_id=company_tenant.id,
            company_name="V",
            display_name="V",
            vendor_number="V-ST",
            is_active=True,
        )

    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-06-02",
                "status": "draft",
                "bill_purpose": "station",
                "receipt_station_id": st.id,
                "lines": [
                    {
                        "description": "Site expense",
                        "quantity": 1,
                        "unit_cost": "50.00",
                        "amount": "50.00",
                        "line_receipt_station_id": st.id,
                        "fuel_station_expense_category": "other",
                    }
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content
    bill_id = r.json()["id"]

    scoped = api_client.get(
        "/api/bills/",
        {"station_id": str(st.id), "skip": "0", "limit": "50"},
        **auth_admin_headers,
    )
    assert scoped.status_code == 200
    scoped_body = scoped.json()
    scoped_rows = (
        scoped_body["results"] if isinstance(scoped_body, dict) and "results" in scoped_body else scoped_body
    )
    ids = {b["id"] for b in scoped_rows}
    assert bill_id in ids

    other_st = (
        Station.objects.filter(company_id=company_tenant.id, is_active=True)
        .exclude(pk=st.id)
        .first()
    )
    if other_st:
        other = api_client.get(
            "/api/bills/",
            {"station_id": str(other_st.id), "skip": "0", "limit": "50"},
            **auth_admin_headers,
        )
        assert other.status_code == 200
        other_body = other.json()
        other_rows = (
            other_body["results"] if isinstance(other_body, dict) and "results" in other_body else other_body
        )
        assert bill_id not in {b["id"] for b in other_rows}


@pytest.mark.django_db
def test_bill_list_filter_head_office(api_client, company_tenant, auth_admin_headers):
    vendor = Vendor.objects.filter(company_id=company_tenant.id).first()
    if vendor is None:
        vendor = Vendor.objects.create(
            company_id=company_tenant.id,
            company_name="V",
            display_name="V",
            vendor_number="V-HO",
            is_active=True,
        )

    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-06-03",
                "status": "draft",
                "bill_purpose": "office",
                "lines": [
                    {
                        "description": "Admin supplies",
                        "quantity": 1,
                        "unit_cost": "75.00",
                        "amount": "75.00",
                    }
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content
    bill_id = r.json()["id"]

    ho = api_client.get(
        "/api/bills/",
        {"head_office": "1", "skip": "0", "limit": "50"},
        **auth_admin_headers,
    )
    assert ho.status_code == 200
    ho_body = ho.json()
    ho_rows = ho_body["results"] if isinstance(ho_body, dict) and "results" in ho_body else ho_body
    assert bill_id in {b["id"] for b in ho_rows}
