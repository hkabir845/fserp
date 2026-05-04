"""
Smoke tests: every registered report endpoint returns 200 and a JSON body with expected report_id.
Keeps the Reports hub and analytics API in sync with backend handlers.
"""
from __future__ import annotations

import json

import pytest
from django.test import Client

from tests.test_api_production_audit import _audit_master_headers

# Must match api.views.reports_views: _REPORT_HANDLERS + item-scoped branches + financial-analytics
ALL_REGISTERED_REPORT_IDS: tuple[str, ...] = (
    "trial-balance",
    "balance-sheet",
    "income-statement",
    "customer-balances",
    "vendor-balances",
    "fuel-sales",
    "tank-inventory",
    "shift-summary",
    "sales-by-nozzle",
    "tank-dip-variance",
    "tank-dip-register",
    "meter-readings",
    "daily-summary",
    "financial-analytics",
    "inventory-sku-valuation",
    "item-master-by-category",
    "item-sales-by-category",
    "item-purchases-by-category",
    "item-sales-custom",
    "item-purchases-custom",
    "item-stock-movement",
    "item-velocity-analysis",
    "item-purchase-velocity-analysis",
)


@pytest.mark.parametrize("report_id", ALL_REGISTERED_REPORT_IDS)
def test_report_get_json_ok(
    api_client: Client,
    auth_super_headers,
    company_master,
    report_id: str,
):
    h = _audit_master_headers(auth_super_headers, company_master)
    r = api_client.get(
        f"/api/reports/{report_id}/",
        {"start_date": "2026-01-01", "end_date": "2026-01-31"},
        **h,
    )
    assert r.status_code == 200, (report_id, r.status_code, r.content[:800])
    data = json.loads(r.content)
    assert data.get("report_id") == report_id, (report_id, data.get("report_id"))
