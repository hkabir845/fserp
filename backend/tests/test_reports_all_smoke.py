"""
Smoke tests: every registered report endpoint returns 200 and a JSON body with expected report_id.
Keeps the Reports hub and analytics API in sync with backend handlers.
"""
from __future__ import annotations

import json

import pytest
from django.test import Client

from tests.report_registry import ALL_API_REPORT_IDS
from tests.test_api_production_audit import _audit_master_headers

# Re-export for scripts that import ALL_REGISTERED_REPORT_IDS from this module.
ALL_REGISTERED_REPORT_IDS = ALL_API_REPORT_IDS


@pytest.mark.parametrize("report_id", ALL_API_REPORT_IDS)
def test_report_get_json_ok(
    api_client: Client,
    auth_super_headers,
    company_master,
    report_id: str,
):
    company_master.__class__.objects.filter(pk=company_master.id).update(
        aquaculture_enabled=True,
        aquaculture_licensed=True,
    )
    h = _audit_master_headers(auth_super_headers, company_master)
    r = api_client.get(
        f"/api/reports/{report_id}/",
        {"start_date": "2026-01-01", "end_date": "2026-01-31"},
        **h,
    )
    assert r.status_code == 200, (report_id, r.status_code, r.content[:800])
    data = json.loads(r.content)
    assert data.get("report_id") == report_id, (report_id, data.get("report_id"))
