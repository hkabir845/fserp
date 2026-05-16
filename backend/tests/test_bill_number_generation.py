"""Bill auto-number must not collide after deletes or non-sequential seed numbers."""
from __future__ import annotations

import json
from datetime import date

import pytest
from django.test import Client

from api.models import Bill
from tests.test_api_production_audit import _audit_master_headers


@pytest.mark.django_db
def test_bill_create_number_after_gap(api_client: Client, auth_super_headers, company_master):
    h = _audit_master_headers(auth_super_headers, company_master)
    v = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": "Gap Vendor"}),
        content_type="application/json",
        **h,
    )
    assert v.status_code == 201
    vendor_id = json.loads(v.content)["id"]

    bd = date(2026, 5, 1)
    Bill.objects.create(
        company_id=company_master.id,
        vendor_id=vendor_id,
        bill_number="BILL-1",
        bill_date=bd,
        status="draft",
        subtotal=0,
        tax_total=0,
        total=0,
    )
    Bill.objects.create(
        company_id=company_master.id,
        vendor_id=vendor_id,
        bill_number="BILL-3",
        bill_date=bd,
        status="draft",
        subtotal=0,
        tax_total=0,
        total=0,
    )
    Bill.objects.create(
        company_id=company_master.id,
        vendor_id=vendor_id,
        bill_number="DEMO-BILL-SEED-1",
        bill_date=bd,
        status="draft",
        subtotal=0,
        tax_total=0,
        total=0,
    )

    r = api_client.post(
        "/api/bills/",
        data=json.dumps({"vendor_id": vendor_id, "status": "draft", "lines": []}),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content
    assert json.loads(r.content)["bill_number"] == "BILL-4"
