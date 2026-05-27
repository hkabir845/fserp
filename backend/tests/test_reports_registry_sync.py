"""Registry alignment: API handlers, RBAC catalog, and smoke coverage."""
from __future__ import annotations

import json

import pytest
from django.test import Client

from tests.report_registry import (
    ALL_API_REPORT_IDS,
    PERMISSION_REPORT_IDS,
    UI_ONLY_REPORT_IDS,
)
from tests.test_api_production_audit import _audit_master_headers

pytestmark = pytest.mark.django_db


def test_every_api_report_has_permission_catalog_entry():
    missing = [rid for rid in ALL_API_REPORT_IDS if rid not in PERMISSION_REPORT_IDS]
    assert missing == [], f"Add to REPORT_PERMISSION_DEFINITIONS: {missing}"


def test_permission_catalog_api_reports_are_implemented():
    extra = PERMISSION_REPORT_IDS - set(ALL_API_REPORT_IDS) - UI_ONLY_REPORT_IDS - {"financial-analytics"}
    assert extra == set(), f"Permission entries without API handler: {sorted(extra)}"


@pytest.mark.parametrize("report_id", ALL_API_REPORT_IDS)
def test_every_api_report_returns_200(
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
    assert r.status_code == 200, (report_id, r.status_code, r.content[:600])
    data = json.loads(r.content)
    assert data.get("report_id") == report_id, (report_id, data.get("report_id"))
