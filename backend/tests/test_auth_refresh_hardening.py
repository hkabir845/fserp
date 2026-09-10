"""Auth refresh rotation, browser body omission, and replay detection."""
from __future__ import annotations

import json

import pytest
from django.conf import settings
from django.test import Client

from api.models import AuthRefreshSession, User
from api.services.auth_refresh_sessions import issue_refresh_session
from api.utils.auth import create_tokens

pytestmark = pytest.mark.django_db


def _user(company) -> User:
    u = User(
        username="auth_hard_user",
        role="admin",
        is_active=True,
        company_id=company.id,
    )
    u.set_password("Secret123!")
    u.save()
    return u


def test_browser_login_omits_refresh_token_from_json_body(company_tenant):
    _user(company_tenant)
    c = Client()
    res = c.post(
        "/api/auth/login/json/",
        data=json.dumps({"username": "auth_hard_user", "password": "Secret123!"}),
        content_type="application/json",
        HTTP_X_AUTH_CLIENT="browser",
    )
    assert res.status_code == 200, res.content
    body = res.json()
    assert body.get("access_token")
    assert "refresh_token" not in body
    assert settings.AUTH_REFRESH_COOKIE_NAME in res.cookies


def test_native_login_includes_refresh_token_in_json_body(company_tenant):
    _user(company_tenant)
    c = Client()
    res = c.post(
        "/api/auth/login/json/",
        data=json.dumps({"username": "auth_hard_user", "password": "Secret123!"}),
        content_type="application/json",
        HTTP_X_AUTH_CLIENT="native",
    )
    assert res.status_code == 200, res.content
    body = res.json()
    assert body.get("refresh_token")
    assert AuthRefreshSession.objects.filter(user__username="auth_hard_user").exists()


def test_refresh_token_replay_revokes_family(company_tenant):
    user = _user(company_tenant)
    jti, fid, _ = issue_refresh_session(user)
    _, refresh = create_tokens(user, refresh_jti=jti, refresh_family_id=fid)
    c = Client()

    first = c.post(
        "/api/auth/refresh/",
        data=json.dumps({"refresh_token": refresh}),
        content_type="application/json",
        HTTP_X_AUTH_CLIENT="native",
    )
    assert first.status_code == 200, first.content
    assert first.json().get("access_token")

    replay = c.post(
        "/api/auth/refresh/",
        data=json.dumps({"refresh_token": refresh}),
        content_type="application/json",
        HTTP_X_AUTH_CLIENT="native",
    )
    assert replay.status_code == 401
    detail = (replay.json().get("detail") or "").lower()
    assert "reuse" in detail or "revoked" in detail
    assert AuthRefreshSession.objects.filter(family_id=fid, revoked_at__isnull=False).exists()


def test_logout_revokes_refresh_session(company_tenant):
    user = _user(company_tenant)
    jti, fid, _ = issue_refresh_session(user)
    _, refresh = create_tokens(user, refresh_jti=jti, refresh_family_id=fid)
    c = Client()
    c.cookies[settings.AUTH_REFRESH_COOKIE_NAME] = refresh
    res = c.post("/api/auth/logout/")
    assert res.status_code == 200
    row = AuthRefreshSession.objects.get(jti=jti)
    assert row.revoked_at is not None
