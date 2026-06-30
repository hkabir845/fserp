"""Soft delete + restore for customers, vendors, and items (matches suppliers pattern)."""
from __future__ import annotations

import json

import pytest

from api.models import Customer, Item, Vendor


@pytest.mark.django_db
def test_customer_soft_delete_and_restore(api_client, company_tenant, auth_admin_headers):
    c = Customer.objects.create(
        company_id=company_tenant.id,
        display_name="Soft Del Cust",
        customer_number="C-SOFT-1",
        is_active=True,
    )
    r = api_client.delete(f"/api/customers/{c.id}/", **auth_admin_headers)
    assert r.status_code == 200, r.content.decode()
    c.refresh_from_db()
    assert c.is_active is False

    hidden = api_client.get("/api/customers/?paged=1&skip=0&limit=50", **auth_admin_headers)
    ids = [row["id"] for row in json.loads(hidden.content.decode())["results"]]
    assert c.id not in ids

    shown = api_client.get(
        "/api/customers/?paged=1&skip=0&limit=50&include_inactive=true",
        **auth_admin_headers,
    )
    ids2 = [row["id"] for row in json.loads(shown.content.decode())["results"]]
    assert c.id in ids2

    r2 = api_client.put(
        f"/api/customers/{c.id}/",
        data=json.dumps({"is_active": True}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r2.status_code == 200, r2.content.decode()
    c.refresh_from_db()
    assert c.is_active is True


@pytest.mark.django_db
def test_vendor_soft_delete(api_client, company_tenant, auth_admin_headers):
    v = Vendor.objects.create(
        company_id=company_tenant.id,
        company_name="Soft Del Vendor",
        display_name="Soft Del Vendor",
        vendor_number="V-SOFT-1",
        is_active=True,
    )
    r = api_client.delete(f"/api/vendors/{v.id}/", **auth_admin_headers)
    assert r.status_code == 200, r.content.decode()
    v.refresh_from_db()
    assert v.is_active is False


@pytest.mark.django_db
def test_item_soft_delete(api_client, company_tenant, auth_admin_headers):
    it = Item.objects.create(
        company_id=company_tenant.id,
        name="Soft Del Item",
        item_number="ITM-SOFT-1",
        item_type="inventory",
        is_active=True,
    )
    r = api_client.delete(f"/api/items/{it.id}/", **auth_admin_headers)
    assert r.status_code == 200, r.content.decode()
    it.refresh_from_db()
    assert it.is_active is False
