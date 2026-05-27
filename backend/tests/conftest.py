"""
Django API test fixtures (FSMS).
"""
from __future__ import annotations

import json
import os

# Test client uses one REMOTE_ADDR; auth rate limits would otherwise fail long suites.
os.environ.setdefault("FSERP_DISABLE_AUTH_RATELIMIT", "1")

import pytest
from django.test import Client


@pytest.fixture
def api_client() -> Client:
    return Client()


@pytest.fixture
def company_master(db):
    from api.models import Company, Organization

    org = Organization.objects.create(name="Audit Master Co", legal_name="Audit Master Ltd")
    return Company.objects.create(
        name="Audit Master Co",
        legal_name="Audit Master Ltd",
        currency="BDT",
        is_master="true",
        is_deleted=False,
        is_active=True,
        organization=org,
    )


@pytest.fixture
def company_tenant(db):
    from api.models import Company, Organization

    org = Organization.objects.create(name="Audit Tenant Co", legal_name="Audit Tenant Ltd")
    return Company.objects.create(
        name="Audit Tenant Co",
        legal_name="Audit Tenant Ltd",
        currency="BDT",
        is_master="false",
        is_deleted=False,
        is_active=True,
        organization=org,
    )


@pytest.fixture
def user_super(db):
    from api.models import User

    u = User(
        username="audit_super@test.com",
        email="audit_super@test.com",
        full_name="Audit Super",
        role="super_admin",
        is_active=True,
        company_id=None,
    )
    u.set_password("AuditTest#99")
    u.save()
    return u


@pytest.fixture
def user_admin(db, company_tenant):
    from api.models import User

    u = User(
        username="audit_admin@test.com",
        email="audit_admin@test.com",
        full_name="Audit Admin",
        role="admin",
        is_active=True,
        company_id=company_tenant.id,
    )
    u.set_password("AuditTest#99")
    u.save()
    return u


@pytest.fixture
def user_accountant(db, company_tenant):
    from api.models import User

    u = User(
        username="audit_accountant@test.com",
        email="audit_accountant@test.com",
        full_name="Audit Accountant",
        role="accountant",
        is_active=True,
        company_id=company_tenant.id,
    )
    u.set_password("AuditTest#99")
    u.save()
    return u


@pytest.fixture
def auth_accountant_headers(api_client, user_accountant):
    r = api_client.post(
        "/api/auth/login/",
        data=json.dumps({"username": user_accountant.username, "password": "AuditTest#99"}),
        content_type="application/json",
    )
    assert r.status_code == 200, r.content.decode()
    data = json.loads(r.content)
    token = data["access_token"]
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


@pytest.fixture
def user_operator(db, company_tenant):
    from api.models import User

    u = User(
        username="audit_operator@test.com",
        email="audit_operator@test.com",
        full_name="Audit Operator",
        role="operator",
        is_active=True,
        company_id=company_tenant.id,
    )
    u.set_password("AuditTest#99")
    u.save()
    return u


@pytest.fixture
def auth_operator_headers(api_client, user_operator):
    r = api_client.post(
        "/api/auth/login/",
        data=json.dumps({"username": user_operator.username, "password": "AuditTest#99"}),
        content_type="application/json",
    )
    assert r.status_code == 200, r.content.decode()
    data = json.loads(r.content)
    return {"HTTP_AUTHORIZATION": f"Bearer {data['access_token']}"}


@pytest.fixture
def user_inventory_clerk(db, company_tenant):
    from api.models import User

    u = User(
        username="audit_inv_clerk@test.com",
        email="audit_inv_clerk@test.com",
        full_name="Audit Inventory Clerk",
        role="inventory_clerk",
        is_active=True,
        company_id=company_tenant.id,
    )
    u.set_password("AuditTest#99")
    u.save()
    return u


@pytest.fixture
def auth_inventory_clerk_headers(api_client, user_inventory_clerk):
    r = api_client.post(
        "/api/auth/login/",
        data=json.dumps({"username": user_inventory_clerk.username, "password": "AuditTest#99"}),
        content_type="application/json",
    )
    assert r.status_code == 200, r.content.decode()
    data = json.loads(r.content)
    return {"HTTP_AUTHORIZATION": f"Bearer {data['access_token']}"}


@pytest.fixture
def auth_super_headers(api_client, user_super):
    r = api_client.post(
        "/api/auth/login/",
        data=json.dumps({"username": user_super.username, "password": "AuditTest#99"}),
        content_type="application/json",
    )
    assert r.status_code == 200, r.content.decode()
    data = json.loads(r.content)
    token = data["access_token"]
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


@pytest.fixture
def auth_admin_headers(api_client, user_admin):
    r = api_client.post(
        "/api/auth/login/",
        data=json.dumps({"username": user_admin.username, "password": "AuditTest#99"}),
        content_type="application/json",
    )
    assert r.status_code == 200, r.content.decode()
    data = json.loads(r.content)
    token = data["access_token"]
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def seed_min_gl_accounts(company) -> None:
    """Minimal COA (incl. 5100/5120 COGS) so auto-posting and P&L reports work in tests."""
    from api.models import ChartOfAccount

    specs = [
        ("1010", "Cash on Hand", "asset"),
        ("1030", "Bank Operating", "asset"),
        ("1100", "Accounts Receivable", "asset"),
        ("1120", "Card Clearing", "asset"),
        ("1200", "Inventory Fuel", "asset"),
        ("1220", "Inventory Shop", "asset"),
        ("2000", "Accounts Payable", "liability"),
        ("2100", "VAT Payable", "liability"),
        ("4100", "Fuel Sales", "income"),
        ("4200", "Shop Sales", "income"),
        ("5100", "COGS Fuel", "cost_of_goods_sold"),
        ("5120", "COGS Shop", "cost_of_goods_sold"),
        ("6900", "Office Expense", "expense"),
    ]
    for code, name, typ in specs:
        ChartOfAccount.objects.get_or_create(
            company=company,
            account_code=code,
            defaults={"account_name": name, "account_type": typ, "is_active": True},
        )


@pytest.fixture
def company_tenant_with_gl(company_tenant):
    seed_min_gl_accounts(company_tenant)
    return company_tenant
