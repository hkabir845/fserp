"""Finalizing an aquaculture harvest sale must post an invoice + GL without a 500.

Regression: `select_for_update()` combined with `select_related("production_cycle")`
(a nullable FK -> LEFT OUTER JOIN) raised on Postgres:
    "FOR UPDATE cannot be applied to the nullable side of an outer join"
The row lock must target only the sale table (`of=("self",)`).
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureFishSale,
    AquaculturePond,
    Bill,
    BillLine,
    Company,
    Item,
    Invoice,
    Vendor,
)
from tests.conftest import seed_min_gl_accounts


def _enable_aq(c):
    Company.objects.filter(pk=c.id).update(aquaculture_enabled=True, aquaculture_licensed=True)


def _seed_stocked_pond(cid):
    pond = AquaculturePond.objects.create(
        company_id=cid, name="Finalize Pond", pond_role="grow_out", is_active=True
    )
    vendor = Vendor.objects.create(company_id=cid, company_name="Fry Co")
    fish_item = Item.objects.create(
        company_id=cid, name="Tilapia Fingerling", pos_category="fish",
        unit="kg", unit_price=Decimal("100"), cost=Decimal("80"),
    )
    bill = Bill.objects.create(
        company_id=cid, vendor=vendor, bill_number="B-FRY-FIN",
        bill_date=date(2026, 1, 5), status="posted",
        stock_receipt_applied=True, total=Decimal("10000"),
    )
    BillLine.objects.create(
        bill=bill, item=fish_item, quantity=Decimal("1"), amount=Decimal("10000"),
        aquaculture_pond=pond, aquaculture_fish_count=20000,
        aquaculture_fish_weight_kg=Decimal("200"),
    )
    return pond


def _create_sale(api_client, pond, headers):
    r = api_client.post(
        "/api/aquaculture/sales/",
        data=json.dumps({
            "pond_id": pond.id, "sale_date": "2026-05-19",
            "income_type": "fish_harvest_sale", "fish_species": "tilapia",
            "weight_kg": "50", "fish_count": 5000, "total_amount": "25000",
            "buyer_name": "Rajon",
        }),
        content_type="application/json", **headers,
    )
    assert r.status_code == 201, r.content.decode()
    return json.loads(r.content.decode())["id"]


@pytest.mark.django_db
def test_finalize_harvest_sale_cash_posts_invoice(api_client, company_tenant, auth_admin_headers):
    _enable_aq(company_tenant)
    seed_min_gl_accounts(company_tenant)
    pond = _seed_stocked_pond(company_tenant.id)
    sale_id = _create_sale(api_client, pond, auth_admin_headers)

    r = api_client.post(
        f"/api/aquaculture/sales/{sale_id}/finalize/",
        data=json.dumps({"record_as": "cash_paid"}),
        content_type="application/json", **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    body = json.loads(r.content.decode())
    assert body["invoice"]["invoice_number"] == f"INV-AQ-{sale_id}"
    sale = AquacultureFishSale.objects.get(pk=sale_id)
    assert sale.invoice_id is not None
    assert Invoice.objects.filter(pk=sale.invoice_id).exists()


@pytest.mark.django_db
def test_finalize_is_idempotent(api_client, company_tenant, auth_admin_headers):
    _enable_aq(company_tenant)
    seed_min_gl_accounts(company_tenant)
    pond = _seed_stocked_pond(company_tenant.id)
    sale_id = _create_sale(api_client, pond, auth_admin_headers)

    first = api_client.post(
        f"/api/aquaculture/sales/{sale_id}/finalize/",
        data=json.dumps({"record_as": "cash_paid"}),
        content_type="application/json", **auth_admin_headers,
    )
    assert first.status_code == 200, first.content.decode()
    second = api_client.post(
        f"/api/aquaculture/sales/{sale_id}/finalize/",
        data=json.dumps({"record_as": "cash_paid"}),
        content_type="application/json", **auth_admin_headers,
    )
    assert second.status_code == 200, second.content.decode()
    assert Invoice.objects.filter(company_id=company_tenant.id).count() == 1
