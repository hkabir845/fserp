"""Offset list pagination (paged=1) for core ERP list endpoints."""
from __future__ import annotations

import json

import pytest
from django.test import Client

pytestmark = pytest.mark.django_db


def test_customers_paged_envelope(api_client: Client, auth_super_headers, company_master):
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    r = api_client.get("/api/customers/?paged=1&skip=0&limit=10", **h)
    assert r.status_code == 200
    data = json.loads(r.content)
    assert data["count"] == 0
    assert data["skip"] == 0
    assert data["limit"] == 10
    assert data["results"] == []
    assert "stats" in data
    assert data["stats"]["active_count"] == 0


def test_vendors_paged_envelope(api_client: Client, auth_super_headers, company_master):
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    r = api_client.get("/api/vendors/?paged=1&skip=0&limit=5", **h)
    assert r.status_code == 200
    data = json.loads(r.content)
    assert "count" in data and "results" in data
    assert isinstance(data["results"], list)


def test_items_paged_envelope(api_client: Client, auth_super_headers, company_master):
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    r = api_client.get("/api/items/?paged=1&skip=0&limit=5", **h)
    assert r.status_code == 200
    data = json.loads(r.content)
    assert "stats" in data and "by_type" in data["stats"]
    assert data["stats"]["catalog_total"] >= 0


def test_bills_paged_envelope(api_client: Client, auth_super_headers, company_master):
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    r = api_client.get("/api/bills/?paged=1&skip=0&limit=5", **h)
    assert r.status_code == 200
    data = json.loads(r.content)
    assert isinstance(data["results"], list)
