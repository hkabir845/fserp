"""Super Admin master → tenant push (POST /api/admin/master-company/push-updates/)."""
from __future__ import annotations

import json

import pytest
from django.conf import settings


@pytest.mark.django_db
def test_push_updates_all_tenants_applies_release(
    api_client, auth_super_headers, company_master, company_tenant
):
    tgt = settings.PLATFORM_TARGET_RELEASE
    company_tenant.platform_release = "pre-upgrade-test"
    company_tenant.save(update_fields=["platform_release"])

    body = {
        "scope": "all_tenants",
        "apply_platform_release": True,
        "sync_chart_of_accounts": False,
        "sync_items": False,
        "sync_tax_codes": False,
        "sync_company_settings": False,
    }
    r = api_client.post(
        "/api/admin/master-company/push-updates/",
        data=json.dumps(body),
        content_type="application/json",
        **auth_super_headers,
    )
    assert r.status_code == 200, r.content.decode()
    out = json.loads(r.content)
    assert out.get("ok") is True
    assert out.get("updated_count") == 1
    company_tenant.refresh_from_db()
    assert company_tenant.platform_release == tgt


@pytest.mark.django_db
def test_push_updates_selected_tenant_only(
    api_client, auth_super_headers, company_master, company_tenant
):
    from api.models import Company

    other = Company.objects.create(
        name="Other Tenant",
        currency="BDT",
        is_master="false",
        is_deleted=False,
        is_active=True,
        platform_release="",
    )
    company_tenant.platform_release = ""
    company_tenant.save(update_fields=["platform_release"])

    body = {
        "scope": "selected",
        "company_ids": [company_tenant.id],
        "apply_platform_release": True,
        "sync_chart_of_accounts": False,
        "sync_items": False,
        "sync_tax_codes": False,
        "sync_company_settings": False,
    }
    r = api_client.post(
        "/api/admin/master-company/push-updates/",
        data=json.dumps(body),
        content_type="application/json",
        **auth_super_headers,
    )
    assert r.status_code == 200, r.content.decode()
    out = json.loads(r.content)
    assert out.get("updated_count") == 1
    other.refresh_from_db()
    assert other.platform_release == ""


@pytest.mark.django_db
def test_push_data_sync_requires_master_company(api_client, auth_super_headers):
    from api.models import Company

    Company.objects.create(
        name="Lonely Tenant",
        currency="BDT",
        is_master="false",
        is_deleted=False,
        is_active=True,
    )
    body = {
        "scope": "all_tenants",
        "apply_platform_release": False,
        "sync_chart_of_accounts": True,
        "sync_items": False,
        "sync_tax_codes": False,
        "sync_company_settings": False,
    }
    r = api_client.post(
        "/api/admin/master-company/push-updates/",
        data=json.dumps(body),
        content_type="application/json",
        **auth_super_headers,
    )
    assert r.status_code == 400
    err = json.loads(r.content)
    assert "Master" in (err.get("detail") or "")
