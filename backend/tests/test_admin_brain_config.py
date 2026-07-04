"""Super Admin Brain API config."""
from __future__ import annotations

import pytest

from api.models import PlatformBrainConfig


@pytest.mark.django_db
def test_admin_brain_config_get_and_put(api_client, auth_super_headers):
    h = {**auth_super_headers}
    r = api_client.get("/api/admin/brain-config/", **h)
    assert r.status_code == 200
    data = r.json()
    assert "free_api_key_set" in data
    assert data["free_api_key_set"] is False

    put = api_client.put(
        "/api/admin/brain-config/",
        {
            "free_api_key": "sk-or-test-free-key-abcdefghij",
            "free_model_reasoning": "google/gemini-2.0-flash-001",
        },
        content_type="application/json",
        **h,
    )
    assert put.status_code == 200
    saved = put.json()
    assert saved["free_api_key_set"] is True
    assert "••••" in saved["free_api_key_masked"]
    assert "abcdefghij" not in saved["free_api_key_masked"]

    cfg = PlatformBrainConfig.objects.get(pk=1)
    assert cfg.free_api_key.startswith("sk-or-test")


@pytest.mark.django_db
def test_brain_config_api_key_for_plan():
    from api.services.brain.config import api_key_for_plan, get_platform_brain_config

    cfg = get_platform_brain_config()
    cfg.free_api_key = "free-key"
    cfg.vendor_api_key = "vendor-key"
    cfg.save()

    assert api_key_for_plan("free") == "free-key"
    assert api_key_for_plan("growth") == "vendor-key"
    assert api_key_for_plan("enterprise") == "vendor-key"
