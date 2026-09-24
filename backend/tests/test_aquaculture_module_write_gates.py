"""Aquaculture submodule write gates + report drill page permission."""
from __future__ import annotations

import json

import pytest
from django.test import Client

from api.models import Company, CompanyRole, User

pytestmark = pytest.mark.django_db


def _login(api_client: Client, username: str, password: str = "AuditTest#99") -> dict:
    r = api_client.post(
        "/api/auth/login/",
        data=json.dumps({"username": username, "password": password}),
        content_type="application/json",
    )
    assert r.status_code == 200, r.content.decode()
    token = json.loads(r.content)["access_token"]
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _enable_aqua(company: Company) -> None:
    Company.objects.filter(pk=company.id).update(aquaculture_enabled=True, aquaculture_licensed=True)


def _user_with_perms(company: Company, *, username: str, perms: list[str]) -> User:
    role = CompanyRole.objects.create(
        company_id=company.id,
        name=f"role-{username}",
        permissions=perms,
    )
    u = User(
        username=username,
        email=username,
        full_name=username,
        role="user",
        is_active=True,
        company_id=company.id,
        custom_role=role,
    )
    u.set_password("AuditTest#99")
    u.save()
    return u


def test_sales_write_denied_without_sales_module(api_client: Client, company_tenant):
    _enable_aqua(company_tenant)
    _user_with_perms(
        company_tenant,
        username="aq_ponds_only@test.com",
        perms=["app.launcher", "app.aquaculture.ponds"],
    )
    headers = _login(api_client, "aq_ponds_only@test.com")
    # GET list still allowed (any aqua module via _aquaculture_access)
    get_res = api_client.get("/api/aquaculture/sales/", **headers)
    assert get_res.status_code == 200, get_res.content.decode()
    # POST requires sales module
    post_res = api_client.post(
        "/api/aquaculture/sales/",
        data=json.dumps({}),
        content_type="application/json",
        **headers,
    )
    assert post_res.status_code == 403
    assert "permission" in (post_res.json().get("detail") or "").lower()


def test_sales_write_allowed_with_sales_module(api_client: Client, company_tenant):
    _enable_aqua(company_tenant)
    _user_with_perms(
        company_tenant,
        username="aq_sales@test.com",
        perms=["app.launcher", "app.aquaculture.sales"],
    )
    headers = _login(api_client, "aq_sales@test.com")
    post_res = api_client.post(
        "/api/aquaculture/sales/",
        data=json.dumps({}),
        content_type="application/json",
        **headers,
    )
    # Passes permission gate; body validation may still 400
    assert post_res.status_code != 403, post_res.content.decode()


def test_report_drill_requires_reports_page(api_client: Client, company_tenant):
    _user_with_perms(
        company_tenant,
        username="no_reports@test.com",
        perms=["app.launcher", "app.page.dashboard"],
    )
    headers = _login(api_client, "no_reports@test.com")
    res = api_client.get("/api/reports/drill/invoices/?customer_id=1", **headers)
    assert res.status_code == 403
