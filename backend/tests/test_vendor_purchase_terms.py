"""Vendor supplier category, mill credit facility, MRP terms, and mill account credits."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import Item, VendorCredit, VendorSchemeReserve


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


def _mill_sack_line(item_id: int) -> dict:
    return {"item_id": item_id, "quantity": "200", "mrp": "1900"}


@pytest.mark.django_db
def test_mill_bill_applies_only_filled_instant_percent(api_client, company_tenant, auth_admin_headers):
    """Blank transport / scheme fields are skipped; only the filled instant % applies."""
    h = auth_admin_headers
    v = _vendor(
        api_client,
        h,
        company_name="Instant only mill",
        supplier_category="feed",
        rate_card={
            "effective_from": "2026-01-01",
            "instant_discount_percent": "5.5",
        },
    )
    item = _item(company_tenant.id, mrp=Decimal("1900"))
    r = _post_bill(api_client, h, v["id"], _mill_sack_line(item.id), status="draft")
    assert r.status_code == 201, r.content.decode()
    bill = json.loads(r.content)
    # 200 × 1900 = 380000; 5.5% = 20900; no transport
    assert Decimal(bill["total"]) == Decimal("359100.00")
    assert Decimal(bill["truck_transport_amount"]) == Decimal("0.00")


@pytest.mark.django_db
def test_truck_transport_is_once_per_bill(api_client, company_tenant, auth_admin_headers):
    h = auth_admin_headers
    v = _vendor(
        api_client,
        h,
        company_name="Truck mill",
        supplier_category="feed",
        rate_card={
            "effective_from": "2026-01-01",
            "instant_discount_percent": "5.5",
            "transport_per_truck": "950",
        },
    )
    item = _item(company_tenant.id, mrp=Decimal("1900"))
    r = _post_bill(api_client, h, v["id"], _mill_sack_line(item.id), status="draft")
    assert r.status_code == 201, r.content.decode()
    bill = json.loads(r.content)
    line = bill["lines"][0]
    # 380000 − 5.5% − 950 truck (once, not × 200)
    assert Decimal(line["instant_discount_amount"]) == Decimal("20900.00")
    assert Decimal(line["transport_amount"]) == Decimal("950.00")
    assert Decimal(bill["truck_transport_amount"]) == Decimal("950.00")
    assert Decimal(bill["total"]) == Decimal("358150.00")


@pytest.mark.django_db
def test_bill_may_skip_rate_card_truck_with_explicit_zero(api_client, company_tenant, auth_admin_headers):
    h = auth_admin_headers
    v = _vendor(
        api_client,
        h,
        company_name="Override mill",
        supplier_category="feed",
        rate_card={
            "effective_from": "2026-01-01",
            "instant_discount_percent": "5.5",
            "transport_per_truck": "950",
        },
    )
    item = _item(company_tenant.id, mrp=Decimal("1900"))
    r = _post_bill(
        api_client,
        h,
        v["id"],
        _mill_sack_line(item.id),
        status="draft",
        extra={"truck_transport_amount": "0"},
    )
    assert r.status_code == 201, r.content.decode()
    bill = json.loads(r.content)
    assert Decimal(bill["total"]) == Decimal("359100.00")
    assert Decimal(bill["truck_transport_amount"]) == Decimal("0.00")


@pytest.mark.django_db
def test_monthly_scheme_is_reserved_not_payable_credit(api_client, company_tenant, auth_admin_headers):
    h = auth_admin_headers
    v = _vendor(
        api_client,
        h,
        company_name="Reserve mill",
        supplier_category="feed",
        rate_card={
            "effective_from": "2026-01-01",
            "instant_discount_percent": "5.5",
            "transport_per_truck": "950",
            "monthly_rebate_percent": "3",
        },
    )
    item = _item(company_tenant.id, mrp=Decimal("1900"))
    today = date.today().isoformat()
    r = _post_bill(
        api_client,
        h,
        v["id"],
        _mill_sack_line(item.id),
        status="open",
        extra={"bill_date": today},
    )
    assert r.status_code == 201, r.content.decode()
    bill = json.loads(r.content)
    assert Decimal(bill["total"]) == Decimal("358150.00")
    terms = json.loads(api_client.get(f"/api/vendors/{v['id']}/purchase-terms/", **h).content)
    assert Decimal(terms["used"]) == Decimal("358150.00")
    assert Decimal(terms["scheme"]["monthly_reserved"]) == Decimal("11400.00")
    assert terms["scheme"]["monthly_is_reserve"] is True
    assert VendorSchemeReserve.objects.filter(vendor_id=v["id"]).count() == 1
    assert VendorCredit.objects.filter(vendor_id=v["id"]).count() == 0


@pytest.mark.django_db
def test_yearly_scheme_blocked_before_square_off(api_client, company_tenant, auth_admin_headers):
    h = auth_admin_headers
    v = _vendor(
        api_client,
        h,
        company_name="Early yearly mill",
        supplier_category="feed",
        credit_start_date="2026-03-15",
        rate_card={
            "effective_from": "2026-01-01",
            "instant_discount_percent": "5.5",
            "yearly_rebate_percent": "2.5",
            "yearly_target_tons": "5",
        },
    )
    item = _item(company_tenant.id, mrp=Decimal("1900"))
    r = _post_bill(api_client, h, v["id"], _mill_sack_line(item.id), status="open")
    assert r.status_code == 201, r.content.decode()
    cr = api_client.post(
        f"/api/vendors/{v['id']}/yearly-scheme/",
        data=json.dumps({"credit_date": "2026-08-20"}),
        content_type="application/json",
        **h,
    )
    assert cr.status_code == 400, cr.content.decode()


@pytest.mark.django_db
def test_yearly_scheme_blocked_when_target_missed(api_client, company_tenant, auth_admin_headers):
    h = auth_admin_headers
    v = _vendor(
        api_client,
        h,
        company_name="Missed target mill",
        supplier_category="feed",
        credit_start_date="2025-03-15",
        square_off_date="2026-03-15",
        rate_card={
            "effective_from": "2025-01-01",
            "instant_discount_percent": "5.5",
            "yearly_rebate_percent": "2.5",
            "yearly_target_tons": "500",
        },
    )
    item = _item(company_tenant.id, mrp=Decimal("1900"))
    r = _post_bill(
        api_client,
        h,
        v["id"],
        _mill_sack_line(item.id),
        status="open",
        extra={"bill_date": "2025-08-20"},
    )
    assert r.status_code == 201, r.content.decode()
    cr = api_client.post(
        f"/api/vendors/{v['id']}/yearly-scheme/",
        data=json.dumps({"credit_date": "2026-03-15"}),
        content_type="application/json",
        **h,
    )
    assert cr.status_code == 400, cr.content.decode()
    assert b"target" in cr.content.lower()


@pytest.mark.django_db
def test_yearly_scheme_credits_at_square_off_when_target_met(
    api_client, company_tenant, auth_admin_headers
):
    h = auth_admin_headers
    v = _vendor(
        api_client,
        h,
        company_name="Yearly mill",
        supplier_category="feed",
        opening_balance="0",
        opening_balance_date="2025-03-15",
        credit_start_date="2025-03-15",
        square_off_date="2026-03-15",
        rate_card={
            "effective_from": "2025-01-01",
            "instant_discount_percent": "5.5",
            "transport_per_truck": "950",
            "yearly_rebate_percent": "2.5",
            "yearly_target_tons": "5",
        },
    )
    item = _item(company_tenant.id, mrp=Decimal("1900"))
    r = _post_bill(
        api_client,
        h,
        v["id"],
        _mill_sack_line(item.id),
        status="open",
        extra={"bill_date": "2025-08-20"},
    )
    assert r.status_code == 201, r.content.decode()
    bill = json.loads(r.content)
    payable = Decimal(bill["total"])
    cr = api_client.post(
        f"/api/vendors/{v['id']}/yearly-scheme/",
        data=json.dumps({"credit_date": "2026-03-15"}),
        content_type="application/json",
        **h,
    )
    assert cr.status_code == 201, cr.content.decode()
    credit = json.loads(cr.content)
    # 2.5% of 380000 MRP
    assert Decimal(credit["amount"]) == Decimal("9500.00")
    assert credit["credit_kind"] == "yearly"
    terms = json.loads(api_client.get(f"/api/vendors/{v['id']}/purchase-terms/", **h).content)
    assert Decimal(terms["used"]) == payable - Decimal("9500.00")
    again = api_client.post(
        f"/api/vendors/{v['id']}/yearly-scheme/",
        data=json.dumps({"credit_date": "2026-03-15"}),
        content_type="application/json",
        **h,
    )
    assert again.status_code == 400

@pytest.mark.django_db
def test_transport_percent_of_mrp_on_bill(api_client, company_tenant, auth_admin_headers):
    """Variable transport as % of MRP stacks with instant % (no fixed truck)."""
    h = auth_admin_headers
    v = _vendor(
        api_client,
        h,
        company_name="Pct transport mill",
        supplier_category="feed",
        rate_card={
            "effective_from": "2026-01-01",
            "instant_discount_percent": "5.5",
            "transport_percent": "1.5",
        },
    )
    item = _item(company_tenant.id, mrp=Decimal("1900"))
    r = _post_bill(api_client, h, v["id"], _mill_sack_line(item.id), status="draft")
    assert r.status_code == 201, r.content.decode()
    bill = json.loads(r.content)
    line = bill["lines"][0]
    # Gross 380000; instant 5.5% = 20900; transport 1.5% = 5700; net = 353400
    assert Decimal(line["instant_discount_amount"]) == Decimal("20900.00")
    assert Decimal(line["transport_amount"]) == Decimal("5700.00")
    assert Decimal(bill["total"]) == Decimal("353400.00")
    assert Decimal(bill["truck_transport_amount"]) == Decimal("0.00")


@pytest.mark.django_db
def test_post_monthly_scheme_credits_payable(api_client, company_tenant, auth_admin_headers):
    h = auth_admin_headers
    v = _vendor(
        api_client,
        h,
        company_name="Monthly post mill",
        supplier_category="feed",
        rate_card={
            "effective_from": "2026-01-01",
            "instant_discount_percent": "5.5",
            "monthly_rebate_percent": "3",
        },
    )
    item = _item(company_tenant.id, mrp=Decimal("1900"))
    today = date.today().isoformat()
    r = _post_bill(
        api_client,
        h,
        v["id"],
        _mill_sack_line(item.id),
        status="open",
        extra={"bill_date": today},
    )
    assert r.status_code == 201, r.content.decode()
    bill = json.loads(r.content)
    payable = Decimal(bill["total"])
    cr = api_client.post(
        f"/api/vendors/{v['id']}/monthly-scheme/",
        data=json.dumps({}),
        content_type="application/json",
        **h,
    )
    assert cr.status_code == 201, cr.content.decode()
    credit = json.loads(cr.content)
    assert credit["credit_kind"] == "monthly"
    assert Decimal(credit["amount"]) == Decimal("11400.00")
    terms = json.loads(api_client.get(f"/api/vendors/{v['id']}/purchase-terms/", **h).content)
    assert Decimal(terms["used"]) == payable - Decimal("11400.00")
    assert terms["scheme"]["monthly_credit_posted"] is True
    again = api_client.post(
        f"/api/vendors/{v['id']}/monthly-scheme/",
        data=json.dumps({}),
        content_type="application/json",
        **h,
    )
    assert again.status_code == 400
