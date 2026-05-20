"""Tenant release hooks run on Apply release / master push."""
from __future__ import annotations

import json

import pytest
from django.conf import settings

from api.services.tenant_release import TENANT_RELEASE_HOOKS, apply_platform_release
from api.services.tenant_release_hooks import hook_aquaculture_module


@pytest.mark.django_db
def test_tenant_release_hooks_are_registered():
    names = {h.__name__ for h in TENANT_RELEASE_HOOKS}
    assert "hook_ensure_organization" in names
    assert "hook_aquaculture_module" in names
    assert len(TENANT_RELEASE_HOOKS) >= 6


@pytest.mark.django_db
def test_apply_release_runs_hooks(company_tenant):
    company_tenant.platform_release = "legacy-pre-hooks"
    company_tenant.save(update_fields=["platform_release"])
    company_tenant.aquaculture_enabled = True
    company_tenant.aquaculture_licensed = True
    company_tenant.save(update_fields=["aquaculture_enabled", "aquaculture_licensed"])

    result = apply_platform_release(company_tenant, settings.PLATFORM_TARGET_RELEASE)
    assert result.get("ok") is True
    assert any("upgrade hook" in m for m in result.get("messages", []))

    company_tenant.refresh_from_db()
    assert company_tenant.platform_release == settings.PLATFORM_TARGET_RELEASE


@pytest.mark.django_db
def test_hook_aquaculture_module_idempotent(company_tenant):
    company_tenant.aquaculture_enabled = True
    company_tenant.aquaculture_licensed = False
    company_tenant.save(update_fields=["aquaculture_enabled", "aquaculture_licensed"])
    hook_aquaculture_module(company_tenant.id)
    company_tenant.refresh_from_db()
    assert company_tenant.aquaculture_licensed is True
    hook_aquaculture_module(company_tenant.id)


@pytest.mark.django_db
def test_platform_release_lists_hooks(api_client, auth_super_headers):
    r = api_client.get("/api/admin/platform-release/", **auth_super_headers)
    assert r.status_code == 200
    body = json.loads(r.content.decode())
    hooks = body.get("tenant_upgrade_hooks") or []
    assert len(hooks) >= 6
    assert any(h.get("name") == "hook_aquaculture_module" for h in hooks)
