"""Vendor supplier category, mill credit facility, MRP terms, and mill account credits."""
from __future__ import annotations

import json
from decimal import Decimal

import pytest

from api.models import Item, VendorCredit


def _vendor(api_client, headers, **extra) -> dict:
    body = {"company_name": extra.pop("company_name", "Test mill"), **extra}
    r = api_client.post(
        "/api/vendors/",
        data=json.dumps(body),
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 201, r.content.decode()
    return json.loads(r.content)


def _item(company_id: int, **kwargs) -> Item:
    defaults = dict(
        company_id=company_id,
        name="Feed sack",
        item_type="inventory",
        unit="sack",
        category="General",
        pos_category="feed",
        unit_price=Decimal("4000"),
        cost=Decimal("3500"),
        mrp=Decimal("4000"),
        content_weight_kg=Decimal("25"),
    )
    defaults.update(kwargs)
    return Item.objects.create(**defaults)


def _post_bill(api_client, headers, vendor_id: int, line: dict, status="open", extra=None):
    payload = {
        "vendor_id": vendor_id,
        "bill_date": "2026-08-20",
        "status": status,
        "lines": [line],
        **(extra or {}),
    }
    return api_client.post(
        "/api/bills/",
        data=json.dumps(payload),
        content_type="application/json",
        **headers,
    )


@pytest.mark.django_db
def test_vendor_supplier_categories_round_trip(api_client, company_tenant, auth_admin_headers):
    h = auth_admin_headers
    for cat, label in (
        ("feed", "Feed"),
        ("medicine", "Medicine"),
        ("fish_fry", "Fish fry & fingerling"),
        ("equipment", "Equipment"),
        ("general", "General"),
        ("other", "Other"),
    ):
        row = _vendor(api_client, h, company_name=f"{cat} co", supplier_category=cat)
        assert row["supplier_category"] == cat
        assert row["supplier_category_label"] == label
        assert row["uses_purchase_terms"] is (cat in ("feed", "medicine"))


@pytest.mark.django_db
def test_general_vendor_is_not_credit_gated(api_client, company_tenant, auth_admin_headers):
    h = auth_admin_headers
    v = _vendor(api_client, h, company_name="Electricity", supplier_category="general")
    item = _item(company_tenant.id, name="Office supply", pos_category="general", mrp=Decimal("0"))
    r = _post_bill(
        api_client,
        h,
        v["id"],
        {"item_id": item.id, "quantity": "1", "unit_cost": "999999", "amount": "999999"},
        status="draft",
    )
    assert r.status_code == 201, r.content.decode()


@pytest.mark.django_db
def test_feed_credit_limit_blocks_posted_bill_without_cash(
    api_client, company_tenant, auth_admin_headers
):
    h = auth_admin_headers
    v = _vendor(
        api_client,
        h,
        company_name="Feed mill",
        supplier_category="feed",
        credit_facility_enabled=True,
        credit_limit="1000",
        credit_start_date="2026-03-15",
    )
    item = _item(company_tenant.id, mrp=Decimal("0"))
    r = _post_bill(
        api_client,
        h,
        v["id"],
        {"item_id": item.id, "quantity": "1", "unit_cost": "1500", "amount": "1500"},
    )
    assert r.status_code == 400, r.content.decode()
    body = json.loads(r.content)
    assert body["code"] == "vendor_credit_limit"
    assert Decimal(body["cash_required"]) == Decimal("500.00")


@pytest.mark.django_db
def test_feed_draft_bill_skips_credit_gate(api_client, company_tenant, auth_admin_headers):
    h = auth_admin_headers
    v = _vendor(
        api_client,
        h,
        company_name="Feed mill draft",
        supplier_category="feed",
        credit_facility_enabled=True,
        credit_limit="100",
    )
    item = _item(company_tenant.id, mrp=Decimal("0"))
    r = _post_bill(
        api_client,
        h,
        v["id"],
        {"item_id": item.id, "quantity": "1", "unit_cost": "500", "amount": "500"},
        status="draft",
    )
    assert r.status_code == 201, r.content.decode()


@pytest.mark.django_db
def test_rate_card_prices_mrp_line(api_client, company_tenant, auth_admin_headers):
    h = auth_admin_headers
    v = _vendor(
        api_client,
        h,
        company_name="Scheme mill",
        supplier_category="feed",
        rate_card={
            "effective_from": "2026-01-01",
            "instant_discount_percent": "10",
            "transport_per_unit": "50",
        },
    )
    item = _item(company_tenant.id, mrp=Decimal("1000"))
    r = _post_bill(
        api_client,
        h,
        v["id"],
        {"item_id": item.id, "quantity": "10", "mrp": "1000"},
        status="draft",
    )
    assert r.status_code == 201, r.content.decode()
    bill = json.loads(r.content)
    line = bill["lines"][0]
    # 10 × 1000 = 10000; 10% = 1000; transport 50 × 10 = 500; net 8500
    assert Decimal(line["amount"]) == Decimal("8500.00")
    assert Decimal(line["instant_discount_amount"]) == Decimal("1000.00")
    assert Decimal(line["transport_amount"]) == Decimal("500.00")
    assert Decimal(bill["total"]) == Decimal("8500.00")


@pytest.mark.django_db
def test_mill_credit_reduces_vendor_balance(api_client, company_tenant, auth_admin_headers):
    h = auth_admin_headers
    v = _vendor(
        api_client,
        h,
        company_name="Credit mill",
        supplier_category="feed",
        opening_balance="500",
        opening_balance_date="2026-01-01",
    )
    cr = api_client.post(
        f"/api/vendors/{v['id']}/credits/",
        data=json.dumps({"amount": "200", "credit_kind": "monthly", "memo": "August scheme"}),
        content_type="application/json",
        **h,
    )
    assert cr.status_code == 201, cr.content.decode()
    terms = api_client.get(f"/api/vendors/{v['id']}/purchase-terms/", **h)
    assert terms.status_code == 200
    data = json.loads(terms.content)
    assert Decimal(data["used"]) == Decimal("300.00")
    assert VendorCredit.objects.filter(vendor_id=v["id"]).count() == 1


@pytest.mark.django_db
def test_purchase_terms_endpoint(api_client, company_tenant, auth_admin_headers):
    h = auth_admin_headers
    v = _vendor(
        api_client,
        h,
        company_name="Terms mill",
        supplier_category="medicine",
        credit_facility_enabled=True,
        credit_limit="50000",
        credit_start_date="2026-01-01",
    )
    r = api_client.get(f"/api/vendors/{v['id']}/purchase-terms/", **h)
    assert r.status_code == 200
    data = json.loads(r.content)
    assert data["uses_purchase_terms"] is True
    assert data["square_off_date"] == "2027-01-01"
    assert Decimal(data["credit_limit"]) == Decimal("50000.00")
