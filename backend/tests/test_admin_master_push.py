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
    company_master.platform_release = "pre-upgrade-master"
    company_master.save(update_fields=["platform_release"])
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
    assert out.get("updated_count") == 2
    assert out.get("failed_count") == 0
    summary = out.get("platform_release_summary") or {}
    assert summary.get("target") == tgt
    assert summary.get("tenants_applied") == 2
    assert summary.get("tenants_skipped_already_at_target") == 0
    assert summary.get("tenants_failed") == 0
    company_master.refresh_from_db()
    assert company_master.platform_release == tgt
    assert company_master.platform_release_previous == "pre-upgrade-master"
    company_tenant.refresh_from_db()
    assert company_tenant.platform_release == tgt
    assert company_tenant.platform_release_previous == "pre-upgrade-test"


@pytest.mark.django_db
def test_push_release_all_tenants_skipped_when_already_current(
    api_client, auth_super_headers, company_master, company_tenant
):
    """Second rollout when every tenant is already at the target — accurate skip counts."""
    tgt = settings.PLATFORM_TARGET_RELEASE
    company_master.platform_release = tgt
    company_master.save(update_fields=["platform_release"])
    company_tenant.platform_release = tgt
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
    assert out.get("updated_count") == 2
    summary = out.get("platform_release_summary") or {}
    assert summary.get("tenants_applied") == 0
    assert summary.get("tenants_skipped_already_at_target") == 2
    assert summary.get("tenants_failed") == 0


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


@pytest.mark.django_db
def test_rollback_release_restores_previous_tag(
    api_client, auth_super_headers, company_tenant
):
    tgt = settings.PLATFORM_TARGET_RELEASE
    company_tenant.platform_release = "my-old-tag"
    company_tenant.platform_release_previous = None
    company_tenant.save(update_fields=["platform_release", "platform_release_previous"])

    r = api_client.post(
        f"/api/admin/companies/{company_tenant.id}/apply-release/",
        data=json.dumps({}),
        content_type="application/json",
        **auth_super_headers,
    )
    assert r.status_code == 200, r.content.decode()
    company_tenant.refresh_from_db()
    assert company_tenant.platform_release == tgt
    assert company_tenant.platform_release_previous == "my-old-tag"

    r2 = api_client.post(
        f"/api/admin/companies/{company_tenant.id}/rollback-release/",
        data=json.dumps({}),
        content_type="application/json",
        **auth_super_headers,
    )
    assert r2.status_code == 200, r2.content.decode()
    out = json.loads(r2.content)
    assert out.get("release") == "my-old-tag"
    company_tenant.refresh_from_db()
    assert company_tenant.platform_release == "my-old-tag"
    assert company_tenant.platform_release_previous is None


@pytest.mark.django_db
def test_master_rollback_release_all_tenants(
    api_client, auth_super_headers, company_master, company_tenant
):
    tgt = settings.PLATFORM_TARGET_RELEASE
    company_master.platform_release = "tag-before-bulk"
    company_master.save(update_fields=["platform_release"])
    company_tenant.platform_release = "tag-before-bulk"
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
    company_master.refresh_from_db()
    company_tenant.refresh_from_db()
    assert company_master.platform_release == tgt
    assert company_tenant.platform_release == tgt

    r2 = api_client.post(
        "/api/admin/master-company/rollback-release/",
        data=json.dumps({"scope": "all_tenants"}),
        content_type="application/json",
        **auth_super_headers,
    )
    assert r2.status_code == 200, r2.content.decode()
    out = json.loads(r2.content)
    assert out.get("ok") is True
    assert (out.get("rollback_summary") or {}).get("tenants_rolled_back") == 2
    company_master.refresh_from_db()
    company_tenant.refresh_from_db()
    assert company_master.platform_release == "tag-before-bulk"
    assert company_tenant.platform_release == "tag-before-bulk"
    assert company_master.platform_release_previous is None
    assert company_tenant.platform_release_previous is None
