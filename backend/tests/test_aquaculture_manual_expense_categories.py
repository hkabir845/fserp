"""Pond costs: manual expense categories must not duplicate bills, POS, or automation."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import AquacultureExpense, AquaculturePond, Company


@pytest.mark.django_db
def test_expense_categories_include_manual_create_flag(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    r = api_client.get("/api/aquaculture/expense-categories/", **auth_admin_headers)
    assert r.status_code == 200
    rows = json.loads(r.content.decode())
    assert isinstance(rows, list) and rows
    fry = next((x for x in rows if x.get("id") == "fry_stocking"), None)
    feed = next((x for x in rows if x.get("id") == "feed_purchase"), None)
    lease = next((x for x in rows if x.get("id") == "lease"), None)
    wage = next((x for x in rows if x.get("id") == "worker_salary"), None)
    assert fry is not None and fry.get("manual_create_allowed") is False
    assert feed is not None and feed.get("manual_create_allowed") is False
    assert lease is not None and lease.get("manual_create_allowed") is False
    assert wage is not None and wage.get("manual_create_allowed") is False


@pytest.mark.django_db
def test_post_pond_expense_rejects_fry_stocking(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)
    r = api_client.post(
        "/api/aquaculture/expenses/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "expense_category": "fry_stocking",
                "expense_date": "2026-05-01",
                "amount": "100.00",
                "memo": "should use bill",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400
    low = r.content.decode().lower()
    assert "vendor bill" in low or "fish-type" in low


@pytest.mark.django_db
def test_post_pond_expense_rejects_feed_purchase(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)
    r = api_client.post(
        "/api/aquaculture/expenses/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "expense_category": "feed_purchase",
                "expense_date": "2026-05-01",
                "amount": "100.00",
                "memo": "should use bill or POS",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400
    low = r.content.decode().lower()
    assert "feed" in low or "pos" in low or "bill" in low


@pytest.mark.django_db
def test_post_pond_expense_rejects_lease_category(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)
    r = api_client.post(
        "/api/aquaculture/expenses/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "expense_category": "lease",
                "expense_date": "2026-05-01",
                "amount": "100.00",
                "memo": "should use landlords",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400
    low = r.content.decode().lower()
    assert "landlord" in low or "lease" in low


@pytest.mark.django_db
def test_post_pond_expense_rejects_worker_salary(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)
    r = api_client.post(
        "/api/aquaculture/expenses/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "expense_category": "worker_salary",
                "expense_date": "2026-05-01",
                "amount": "100.00",
                "memo": "should use payroll",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400
    low = r.content.decode().lower()
    assert "payroll" in low or "wage" in low or "salary" in low


@pytest.mark.django_db
def test_put_pond_expense_allows_keeping_legacy_lease_category(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)
    x = AquacultureExpense.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        expense_category="lease",
        expense_date=date(2026, 5, 1),
        amount=Decimal("100.00"),
        memo="legacy",
    )
    r = api_client.put(
        f"/api/aquaculture/expenses/{x.id}/",
        data=json.dumps({"memo": "updated only", "expense_category": "lease"}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    x.refresh_from_db()
    assert x.memo == "updated only"


@pytest.mark.django_db
def test_post_pond_expense_rejects_all_manual_categories(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)
    for cat in ("repair_maintenance", "electricity"):
        r = api_client.post(
            "/api/aquaculture/expenses/",
            data=json.dumps(
                {
                    "pond_id": pond.id,
                    "expense_category": cat,
                    "expense_date": "2026-05-10",
                    "amount": "75.00",
                }
            ),
            content_type="application/json",
            **auth_admin_headers,
        )
        assert r.status_code == 400
        assert "vendor bill" in r.content.decode().lower()


@pytest.mark.django_db
def test_put_pond_expense_cannot_switch_to_fry_stocking(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)
    x = AquacultureExpense.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        expense_category="electricity",
        expense_date=date(2026, 5, 1),
        amount=Decimal("100.00"),
        memo="x",
    )
    r = api_client.put(
        f"/api/aquaculture/expenses/{x.id}/",
        data=json.dumps({"expense_category": "fry_stocking"}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400


@pytest.mark.django_db
def test_put_pond_expense_allows_keeping_legacy_fry_category(api_client, company_tenant, auth_admin_headers):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)
    x = AquacultureExpense.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        expense_category="fry_stocking",
        expense_date=date(2026, 5, 1),
        amount=Decimal("100.00"),
        memo="legacy",
    )
    r = api_client.put(
        f"/api/aquaculture/expenses/{x.id}/",
        data=json.dumps({"memo": "updated memo only", "expense_category": "fry_stocking"}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    x.refresh_from_db()
    assert x.memo == "updated memo only"


@pytest.mark.django_db
def test_put_pond_expense_allows_keeping_legacy_feed_purchase_category(
    api_client, company_tenant, auth_admin_headers
):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="P1", is_active=True)
    x = AquacultureExpense.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        expense_category="feed_purchase",
        expense_date=date(2026, 5, 1),
        amount=Decimal("50.00"),
        memo="legacy manual feed",
    )
    r = api_client.put(
        f"/api/aquaculture/expenses/{x.id}/",
        data=json.dumps({"memo": "still legacy", "expense_category": "feed_purchase"}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    x.refresh_from_db()
    assert x.memo == "still legacy"
