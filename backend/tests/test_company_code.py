"""Company codes: reserved FS-000001 for Master; FS-{id:06d} for tenants (FS-N000001 if id=1)."""
from __future__ import annotations

import json

import pytest
from django.test import override_settings

from api.services.company_code import MASTER_COMPANY_CODE, compute_company_code, resolved_company_code


@pytest.mark.django_db
def test_create_company_returns_computed_code(api_client, auth_super_headers):
    body = {
        "company_name": "Code Test Co",
        "admin_email": "codetest_owner@example.com",
        "admin_password": "secret12",
        "admin_full_name": "Owner",
        "currency": "BDT",
    }
    r = api_client.post(
        "/api/companies/",
        data=json.dumps(body),
        content_type="application/json",
        **auth_super_headers,
    )
    assert r.status_code == 201, r.content.decode()
    out = json.loads(r.content)
    cid = out.get("id")
    assert cid
    expected = compute_company_code(company_id=int(cid), is_master=False)
    assert out.get("company_code") == expected


@pytest.mark.django_db
def test_create_company_defaults_time_zone_asia_dhaka(api_client, auth_super_headers):
    r = api_client.post(
        "/api/companies/",
        data=json.dumps(
            {
                "company_name": "Time Zone Default Co",
                "admin_email": "tzdef_owner@example.com",
                "admin_password": "secret12",
            }
        ),
        content_type="application/json",
        **auth_super_headers,
    )
    assert r.status_code == 201, r.content.decode()
    out = json.loads(r.content)
    assert out.get("time_zone") == "Asia/Dhaka"


@pytest.mark.django_db
def test_create_company_rejects_invalid_time_zone(api_client, auth_super_headers):
    r = api_client.post(
        "/api/companies/",
        data=json.dumps(
            {
                "company_name": "Bad TZ Co",
                "admin_email": "badtz_owner@example.com",
                "admin_password": "secret12",
                "time_zone": "Not/A/Real/Zone",
            }
        ),
        content_type="application/json",
        **auth_super_headers,
    )
    assert r.status_code == 400
    assert "time zone" in json.loads(r.content).get("detail", "").lower()


@pytest.mark.django_db
def test_admin_companies_list_includes_company_code(api_client, auth_super_headers, company_tenant):
    r = api_client.get("/api/admin/companies/", **auth_super_headers)
    assert r.status_code == 200
    rows = json.loads(r.content)
    assert isinstance(rows, list)
    match = next((x for x in rows if x.get("id") == company_tenant.id), None)
    assert match is not None
    assert match.get("company_code") == resolved_company_code(company_tenant)


@pytest.mark.django_db
def test_master_company_uses_reserved_code(company_master):
    assert resolved_company_code(company_master) == MASTER_COMPANY_CODE
    assert company_master.company_code == MASTER_COMPANY_CODE


@pytest.mark.django_db
def test_protection_status_master_active(api_client, auth_super_headers, company_master):
    r = api_client.get(
        f"/api/admin/master-company/protection-status/?company_id={company_master.id}",
        **auth_super_headers,
    )
    assert r.status_code == 200, r.content.decode()
    out = json.loads(r.content)
    assert out["is_master"] is True
    assert out["is_locked"] is False
    assert out["is_testing"] is False
    assert out["status"] == "active"


@pytest.mark.django_db
def test_protection_status_tenant(api_client, auth_super_headers, company_tenant):
    r = api_client.get(
        f"/api/admin/master-company/protection-status/?company_id={company_tenant.id}",
        **auth_super_headers,
    )
    assert r.status_code == 200
    out = json.loads(r.content)
    assert out["is_master"] is False
    assert out["status"] == "tenant"


@pytest.mark.django_db
@override_settings(MASTER_COMPANY_PROTECTION_LOCKED=True, MASTER_COMPANY_PROTECTION_TESTING=True)
def test_protection_status_locked_overrides_testing(api_client, auth_super_headers, company_master):
    r = api_client.get(
        f"/api/admin/master-company/protection-status/?company_id={company_master.id}",
        **auth_super_headers,
    )
    assert r.status_code == 200
    out = json.loads(r.content)
    assert out["is_master"] is True
    assert out["is_locked"] is True
    assert out["is_testing"] is False
    assert out["status"] == "locked"


@pytest.mark.django_db
@override_settings(MASTER_COMPANY_PROTECTION_TESTING=True)
def test_protection_status_testing(api_client, auth_super_headers, company_master):
    r = api_client.get(
        f"/api/admin/master-company/protection-status/?company_id={company_master.id}",
        **auth_super_headers,
    )
    assert r.status_code == 200
    out = json.loads(r.content)
    assert out["is_testing"] is True
    assert out["status"] == "testing"
