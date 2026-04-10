"""Payroll run API (company-scoped headers)."""
from __future__ import annotations

import json

import pytest
from django.test import Client


@pytest.mark.django_db
def test_payroll_list_create_get_delete(api_client: Client, auth_admin_headers):
    r = api_client.get("/api/payroll/", **auth_admin_headers)
    assert r.status_code == 200
    assert json.loads(r.content) == []

    body = {
        "pay_period_start": "2026-04-01",
        "pay_period_end": "2026-04-15",
        "payment_date": "2026-04-15",
        "notes": "April half",
    }
    r = api_client.post(
        "/api/payroll/",
        data=json.dumps(body),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    data = json.loads(r.content)
    assert data["payroll_number"].startswith("PR-")
    assert data["status"] == "draft"
    assert data["total_net"] == 0.0
    pid = data["id"]

    r = api_client.get(f"/api/payroll/{pid}/", **auth_admin_headers)
    assert r.status_code == 200

    r = api_client.delete(f"/api/payroll/{pid}/", **auth_admin_headers)
    assert r.status_code == 200
