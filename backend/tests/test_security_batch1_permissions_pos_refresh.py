"""Batch 1 security: page permissions, POS Idempotency-Key, cookie-refresh Origin."""
from __future__ import annotations

import json
from decimal import Decimal

import pytest
from django.conf import settings
from django.test import Client, override_settings

from api.models import AuthRefreshSession, Invoice, Item, User
from api.services.auth_refresh_sessions import issue_refresh_session
from api.utils.auth import create_tokens
from api.utils.auth_origin import origin_is_allowed

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


def _make_user(company, *, username: str, role: str) -> User:
    u = User(
        username=username,
        email=username,
        full_name=username,
        role=role,
        is_active=True,
        company_id=company.id,
    )
    u.set_password("AuditTest#99")
    u.save()
    return u


def test_cashier_cannot_post_journal(api_client: Client, company_tenant):
    _make_user(company_tenant, username="pos_only@test.com", role="cashier")
    headers = _login(api_client, "pos_only@test.com")
    res = api_client.post(
        "/api/journal-entries/",
        data=json.dumps(
            {
                "entry_date": "2026-01-15",
                "memo": "should be denied",
                "lines": [
                    {"account_id": 1, "debit": "10.00", "credit": "0"},
                    {"account_id": 2, "debit": "0", "credit": "10.00"},
                ],
            }
        ),
        content_type="application/json",
        **headers,
    )
    assert res.status_code == 403
    assert "permission" in (res.json().get("detail") or "").lower()


def test_cashier_can_post_pos_sale(api_client: Client, company_tenant):
    from api.models import Station
    from api.services.station_stock import set_station_stock
    from tests.conftest import seed_min_gl_accounts

    seed_min_gl_accounts(company_tenant)
    st = Station.objects.create(company=company_tenant, station_name="POS Perm Site")
    _make_user(company_tenant, username="pos_ok@test.com", role="cashier")
    headers = _login(api_client, "pos_ok@test.com")
    item = Item.objects.create(
        company=company_tenant,
        name="Shop Snack",
        unit_price=Decimal("50.00"),
        quantity_on_hand=Decimal("100"),
        item_type="inventory",
    )
    set_station_stock(company_tenant.id, st.id, item.id, Decimal("100"))
    res = api_client.post(
        "/api/cashier/pos/",
        data=json.dumps(
            {
                "payment_method": "cash",
                "station_id": st.id,
                "items": [{"item_id": item.id, "quantity": 1, "unit_price": "50.00"}],
                "fuel_lines": [],
            }
        ),
        content_type="application/json",
        HTTP_IDEMPOTENCY_KEY="pos-perm-ok-1",
        **headers,
    )
    assert res.status_code == 201, res.content.decode()
    assert res.json().get("invoice_id")


def test_pos_idempotency_key_returns_same_invoice(api_client: Client, company_tenant):
    from api.models import Station
    from api.services.station_stock import set_station_stock
    from tests.conftest import seed_min_gl_accounts

    seed_min_gl_accounts(company_tenant)
    st = Station.objects.create(company=company_tenant, station_name="POS Idem Site")
    _make_user(company_tenant, username="pos_idem@test.com", role="cashier")
    headers = _login(api_client, "pos_idem@test.com")
    item = Item.objects.create(
        company=company_tenant,
        name="Idem Snack",
        unit_price=Decimal("25.00"),
        quantity_on_hand=Decimal("100"),
        item_type="inventory",
    )
    set_station_stock(company_tenant.id, st.id, item.id, Decimal("100"))
    payload = {
        "payment_method": "cash",
        "station_id": st.id,
        "items": [{"item_id": item.id, "quantity": 1, "unit_price": "25.00"}],
        "fuel_lines": [],
    }
    key = "pos-idem-abc-001"
    first = api_client.post(
        "/api/cashier/pos/",
        data=json.dumps(payload),
        content_type="application/json",
        HTTP_IDEMPOTENCY_KEY=key,
        **headers,
    )
    assert first.status_code == 201, first.content.decode()
    inv_id = first.json()["invoice_id"]

    second = api_client.post(
        "/api/cashier/pos/",
        data=json.dumps(payload),
        content_type="application/json",
        HTTP_IDEMPOTENCY_KEY=key,
        **headers,
    )
    assert second.status_code == 200, second.content.decode()
    assert second.json()["invoice_id"] == inv_id
    assert second.json().get("idempotent_replay") is True
    assert Invoice.objects.filter(company=company_tenant, idempotency_key=key).count() == 1


@override_settings(
    CORS_ALLOWED_ORIGINS=["https://app.example.com"],
    CORS_ALLOWED_ORIGIN_REGEXES=[r"^https://[a-z0-9-]+\.example\.com$"],
)
def test_origin_is_allowed_exact_and_regex():
    assert origin_is_allowed("https://app.example.com") is True
    assert origin_is_allowed("https://tenant.example.com") is True
    assert origin_is_allowed("https://evil.com") is False


def test_cookie_refresh_rejects_foreign_origin(company_tenant):
    user = _make_user(company_tenant, username="refresh_origin@test.com", role="admin")
    jti, fid, _ = issue_refresh_session(user)
    _, refresh = create_tokens(user, refresh_jti=jti, refresh_family_id=fid)
    c = Client()
    c.cookies[settings.AUTH_REFRESH_COOKIE_NAME] = refresh
    res = c.post(
        "/api/auth/refresh/",
        data=json.dumps({}),
        content_type="application/json",
        HTTP_X_AUTH_CLIENT="browser",
        HTTP_ORIGIN="https://evil.attacker.example",
    )
    assert res.status_code == 403
    assert "origin" in (res.json().get("detail") or "").lower()


def test_cookie_refresh_allows_cors_origin(company_tenant):
    user = _make_user(company_tenant, username="refresh_ok@test.com", role="admin")
    jti, fid, _ = issue_refresh_session(user)
    _, refresh = create_tokens(user, refresh_jti=jti, refresh_family_id=fid)
    allowed = (settings.CORS_ALLOWED_ORIGINS or ["http://localhost:3000"])[0]
    c = Client()
    c.cookies[settings.AUTH_REFRESH_COOKIE_NAME] = refresh
    res = c.post(
        "/api/auth/refresh/",
        data=json.dumps({}),
        content_type="application/json",
        HTTP_X_AUTH_CLIENT="browser",
        HTTP_ORIGIN=allowed,
    )
    assert res.status_code == 200, res.content.decode()
    assert res.json().get("access_token")
    assert AuthRefreshSession.objects.filter(user=user).exists()


def test_body_refresh_skips_origin_check(company_tenant):
    user = _make_user(company_tenant, username="refresh_native@test.com", role="admin")
    jti, fid, _ = issue_refresh_session(user)
    _, refresh = create_tokens(user, refresh_jti=jti, refresh_family_id=fid)
    c = Client()
    res = c.post(
        "/api/auth/refresh/",
        data=json.dumps({"refresh_token": refresh}),
        content_type="application/json",
        HTTP_X_AUTH_CLIENT="native",
        HTTP_ORIGIN="https://evil.attacker.example",
    )
    assert res.status_code == 200, res.content.decode()
