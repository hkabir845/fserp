"""Fleet preview, audit, and history endpoints for tenant platform upgrades."""
from __future__ import annotations

import json

import pytest
from django.conf import settings


@pytest.mark.django_db
def test_push_preview_matches_apply_plan(
    api_client, auth_super_headers, company_master, company_tenant
):
    company_tenant.platform_release = "old-tag"
    company_tenant.save(update_fields=["platform_release"])

    body = {
        "scope": "all_tenants",
        "apply_platform_release": True,
        "sync_chart_of_accounts": False,
        "sync_items": False,
        "sync_tax_codes": False,
        "sync_company_settings": False,
    }
    prev = api_client.post(
        "/api/admin/master-company/push-updates/preview/",
        data=json.dumps(body),
        content_type="application/json",
        **auth_super_headers,
    )
    assert prev.status_code == 200, prev.content.decode()
    pout = json.loads(prev.content)
    assert pout.get("dry_run") is True
    rs = pout.get("release_preview_summary") or {}
    assert rs.get("would_apply") == 1
    assert rs.get("would_skip_already_at_target") == 0


@pytest.mark.django_db
def test_platform_release_includes_fleet_summary(api_client, auth_super_headers, company_tenant):
    r = api_client.get("/api/admin/platform-release/", **auth_super_headers)
    assert r.status_code == 200
    out = json.loads(r.content)
    fs = out.get("fleet_summary") or {}
    assert "compliance_pct" in fs
    assert "tenant_count" in fs
    assert out.get("target_release") == settings.PLATFORM_TARGET_RELEASE


@pytest.mark.django_db
def test_master_push_creates_audit_events(
    api_client, auth_super_headers, company_master, company_tenant
):
    from api.models import TenantPlatformReleaseEvent

    company_tenant.platform_release = "pre-audit"
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
    assert r.status_code == 200
    assert TenantPlatformReleaseEvent.objects.filter(company_id=company_tenant.id, category="master_push").exists()

    h = api_client.get("/api/admin/platform-release/history/?limit=10", **auth_super_headers)
    assert h.status_code == 200
    hist = json.loads(h.content)
    assert hist.get("count", 0) >= 1
