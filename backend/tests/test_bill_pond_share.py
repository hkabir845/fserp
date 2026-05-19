"""Vendor bill lines: shared pond split (equal and manual)."""
from __future__ import annotations

import json
from decimal import Decimal

import pytest

from api.models import AquaculturePond, Bill, Company, Vendor
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts


@pytest.mark.django_db
def test_bill_shared_equal_split_creates_one_line_per_pond(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    ensure_aquaculture_chart_accounts(company_tenant.id)
    p1 = AquaculturePond.objects.create(company_id=company_tenant.id, name="Pond-A", is_active=True)
    p2 = AquaculturePond.objects.create(company_id=company_tenant.id, name="Pond-B", is_active=True)
    p3 = AquaculturePond.objects.create(company_id=company_tenant.id, name="Pond-C", is_active=True)
    vendor = Vendor.objects.filter(company_id=company_tenant.id).first()
    if vendor is None:
        vendor = Vendor.objects.create(
            company_id=company_tenant.id,
            company_name="Lease Vendor",
            display_name="Lease Vendor",
            vendor_number="V-LEASE",
            is_active=True,
        )

    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-05-10",
                "status": "draft",
                "bill_purpose": "pond",
                "lines": [
                    {
                        "description": "Shared lease",
                        "quantity": 1,
                        "unit_cost": "10000.00",
                        "amount": "10000.00",
                        "aquaculture_cost_mode": "shared_equal",
                        "shared_equal_pond_ids": [p1.id, p2.id, p3.id],
                        "aquaculture_expense_category": "electricity",
                    }
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content
    bill_id = r.json()["id"]
    bill = Bill.objects.get(pk=bill_id)
    lines = list(bill.lines.order_by("id"))
    assert len(lines) == 3
    pond_ids = {ln.aquaculture_pond_id for ln in lines}
    assert pond_ids == {p1.id, p2.id, p3.id}
    total = sum(ln.amount for ln in lines)
    assert total == Decimal("10000.00")
    amounts = sorted(ln.amount for ln in lines)
    assert amounts == [Decimal("3333.33"), Decimal("3333.33"), Decimal("3333.34")]


@pytest.mark.django_db
def test_bill_shared_manual_split_must_sum(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    ensure_aquaculture_chart_accounts(company_tenant.id)
    p1 = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)
    p2 = AquaculturePond.objects.create(company_id=company_tenant.id, name="P2", is_active=True)
    vendor = Vendor.objects.filter(company_id=company_tenant.id).first()
    if vendor is None:
        vendor = Vendor.objects.create(
            company_id=company_tenant.id,
            company_name="Utility Vendor",
            display_name="Utility Vendor",
            vendor_number="V-UTIL",
            is_active=True,
        )

    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-05-10",
                "bill_purpose": "pond",
                "lines": [
                    {
                        "description": "Electricity",
                        "amount": "500.00",
                        "aquaculture_cost_mode": "shared_manual",
                        "pond_shares": [
                            {"pond_id": p1.id, "amount": "200.00"},
                            {"pond_id": p2.id, "amount": "200.00"},
                        ],
                        "aquaculture_expense_category": "electricity",
                    }
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400
    assert "sum exactly" in r.json().get("detail", "").lower()
