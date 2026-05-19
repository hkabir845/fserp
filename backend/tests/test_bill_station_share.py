"""Vendor bill lines: shared station split."""
from __future__ import annotations

import json
from decimal import Decimal

import pytest

from api.models import Bill, Company, Station, Vendor
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts


@pytest.mark.django_db
def test_bill_shared_equal_station_split(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    ensure_aquaculture_chart_accounts(company_tenant.id)
    s1 = Station.objects.create(
        company_id=company_tenant.id,
        station_name="Pump A",
        station_number="STA-A",
        is_active=True,
    )
    s2 = Station.objects.create(
        company_id=company_tenant.id,
        station_name="Shop B",
        station_number="STA-B",
        is_active=True,
        operates_fuel_retail=False,
    )
    vendor = Vendor.objects.filter(company_id=company_tenant.id).first()
    if vendor is None:
        vendor = Vendor.objects.create(
            company_id=company_tenant.id,
            company_name="Utility Co",
            display_name="Utility Co",
            vendor_number="V-UTIL",
            is_active=True,
        )

    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-05-10",
                "status": "draft",
                "lines": [
                    {
                        "description": "Shared generator diesel",
                        "quantity": 1,
                        "unit_cost": "9000.00",
                        "amount": "9000.00",
                        "station_cost_mode": "shared_equal",
                        "shared_equal_station_ids": [s1.id, s2.id],
                        "fuel_station_expense_category": "utilities",
                    }
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content
    bill = Bill.objects.get(pk=r.json()["id"])
    lines = list(bill.lines.order_by("id"))
    assert len(lines) == 2
    st_ids = {ln.receipt_station_id for ln in lines}
    assert st_ids == {s1.id, s2.id}
    assert sum(ln.amount for ln in lines) == Decimal("9000.00")
