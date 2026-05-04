"""
Password reset (forgot / link / OTP) and tenant backup/restore regression tests.
"""
from __future__ import annotations

import json
import re

import pytest
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from api.models import Customer, User
from api.services.tenant_backup import RESTORE_CONFIRM_PHRASE

pytestmark = pytest.mark.django_db


def test_forgot_password_requires_email(api_client):
    r = api_client.post(
        "/api/auth/forgot-password/",
        data=json.dumps({}),
        content_type="application/json",
    )
    assert r.status_code == 400


def test_forgot_password_unknown_user_still_200(api_client):
    r = api_client.post(
        "/api/auth/forgot-password/",
        data=json.dumps({"email": "nobody-exists@example.com", "method": "link"}),
        content_type="application/json",
    )
    assert r.status_code == 200
    data = json.loads(r.content)
    assert "detail" in data


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    FRONTEND_BASE_URL="https://app.example.com",
)
def test_forgot_password_link_then_reset_password(api_client, company_tenant):
    mail.outbox.clear()
    u = User(
        username="pw_reset_link@test.com",
        email="pw_reset_link@test.com",
        full_name="PW Reset Link",
        role="manager",
        is_active=True,
        company_id=company_tenant.id,
    )
    u.set_password("BeforeReset#1")
    u.save()

    r = api_client.post(
        "/api/auth/forgot-password/",
        data=json.dumps({"email": u.username, "method": "link"}),
        content_type="application/json",
    )
    assert r.status_code == 200
    assert len(mail.outbox) >= 1
    combined = mail.outbox[0].body
    if mail.outbox[0].alternatives:
        combined += str(mail.outbox[0].alternatives[0][0])
    m = re.search(r"token=([A-Za-z0-9_-]+)", combined)
    assert m, combined[:800]

    r2 = api_client.post(
        "/api/auth/reset-password/",
        data=json.dumps({"token": m.group(1), "new_password": "AfterReset#2"}),
        content_type="application/json",
    )
    assert r2.status_code == 200, r2.content.decode()
    u.refresh_from_db()
    assert u.check_password("AfterReset#2")


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
def test_forgot_password_otp_then_reset_password(api_client, company_tenant):
    mail.outbox.clear()
    u = User(
        username="pw_reset_otp@test.com",
        email="pw_reset_otp@test.com",
        full_name="PW Reset OTP",
        role="manager",
        is_active=True,
        company_id=company_tenant.id,
    )
    u.set_password("OtpBefore#1")
    u.save()

    r = api_client.post(
        "/api/auth/forgot-password/",
        data=json.dumps({"email": u.username, "method": "otp"}),
        content_type="application/json",
    )
    assert r.status_code == 200
    assert len(mail.outbox) >= 1
    combined = mail.outbox[0].body
    if mail.outbox[0].alternatives:
        combined += str(mail.outbox[0].alternatives[0][0])
    m = re.search(r"\b(\d{6})\b", combined)
    assert m, combined[:800]
    otp = m.group(1)

    r2 = api_client.post(
        "/api/auth/reset-password/",
        data=json.dumps(
            {"email": u.username, "otp": otp, "new_password": "OtpAfter#2"}
        ),
        content_type="application/json",
    )
    assert r2.status_code == 200, r2.content.decode()
    u.refresh_from_db()
    assert u.check_password("OtpAfter#2")


def test_reset_password_rejects_bad_token(api_client):
    r = api_client.post(
        "/api/auth/reset-password/",
        data=json.dumps({"token": "not-a-real-token", "new_password": "Whatever#99"}),
        content_type="application/json",
    )
    assert r.status_code == 400


def test_backup_constants_requires_auth(api_client):
    r = api_client.get("/api/backup/constants/")
    assert r.status_code == 401


def test_backup_constants_returns_phrase(api_client, auth_admin_headers):
    r = api_client.get("/api/backup/constants/", **auth_admin_headers)
    assert r.status_code == 200
    data = json.loads(r.content)
    assert data.get("restore_confirm_phrase") == RESTORE_CONFIRM_PHRASE


def test_company_backup_download_forbidden_for_cashier(api_client, company_tenant):
    u = User(
        username="cashier_backup@test.com",
        email="cashier_backup@test.com",
        role="cashier",
        is_active=True,
        company_id=company_tenant.id,
    )
    u.set_password("CashierBk#1")
    u.save()
    login = api_client.post(
        "/api/auth/login/",
        data=json.dumps({"username": u.username, "password": "CashierBk#1"}),
        content_type="application/json",
    )
    assert login.status_code == 200
    token = json.loads(login.content)["access_token"]
    h = {"HTTP_AUTHORIZATION": f"Bearer {token}"}
    r = api_client.get("/api/company/backup/", **h)
    assert r.status_code == 403


def test_company_backup_restore_roundtrip_customer(api_client, auth_admin_headers, company_tenant):
    cust = Customer.objects.create(
        company_id=company_tenant.id,
        display_name="Roundtrip Backup Customer",
        customer_number="RTC-001",
    )
    dl = api_client.get("/api/company/backup/", **auth_admin_headers)
    assert dl.status_code == 200
    assert dl["Content-Type"].startswith("application/json")
    blob = dl.content
    assert len(blob) > 100

    Customer.objects.filter(pk=cust.pk).delete()
    assert not Customer.objects.filter(pk=cust.pk).exists()

    up = api_client.post(
        "/api/company/restore/",
        data={
            "confirm_replace": RESTORE_CONFIRM_PHRASE,
            "file": SimpleUploadedFile(
                "backup.json", blob, content_type="application/json"
            ),
        },
        **auth_admin_headers,
    )
    assert up.status_code == 200, up.content.decode()
    out = json.loads(up.content)
    assert out.get("ok") is True
    assert Customer.objects.filter(display_name="Roundtrip Backup Customer").exists()


def test_company_restore_rejects_wrong_confirm(api_client, auth_admin_headers, company_tenant):
    from api.services.tenant_backup import backup_bundle_json_bytes

    raw = backup_bundle_json_bytes(company_tenant.id)
    r = api_client.post(
        "/api/company/restore/",
        data={
            "confirm_replace": "WRONG_PHRASE",
            "file": SimpleUploadedFile("backup.json", raw, content_type="application/json"),
        },
        **auth_admin_headers,
    )
    assert r.status_code == 400
