"""
Django API test fixtures (FSMS). Replaces legacy FastAPI/SQLAlchemy conftest.
"""
from __future__ import annotations

import json

import pytest
from django.test import Client


@pytest.fixture
def api_client() -> Client:
    return Client()


@pytest.fixture
def company_master(db):
    from api.models import Company

    return Company.objects.create(
        name="Audit Master Co",
        legal_name="Audit Master Ltd",
        currency="BDT",
        is_master="true",
        is_deleted=False,
        is_active=True,
    )


@pytest.fixture
def company_tenant(db):
    from api.models import Company

    return Company.objects.create(
        name="Audit Tenant Co",
        legal_name="Audit Tenant Ltd",
        currency="BDT",
        is_master="false",
        is_deleted=False,
        is_active=True,
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
