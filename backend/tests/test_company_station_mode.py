"""Company station_mode (single vs multi) and station create rules."""
from __future__ import annotations

import json

import pytest
from django.test import Client

pytestmark = pytest.mark.django_db


def test_companies_current_includes_station_mode_default(
    api_client: Client, auth_admin_headers, company_tenant
):
    r = api_client.get("/api/companies/current/", **auth_admin_headers)
    assert r.status_code == 200
    data = json.loads(r.content)
    assert data.get("station_mode") == "single"
    assert "active_station_count" in data
    assert "can_edit_station_mode" in data
    assert data.get("can_edit_station_mode") is False


def _super_tenant_headers(auth_super_headers, company_tenant):
    return {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_tenant.id)}


def test_put_single_rejected_when_two_stations(
    api_client: Client, auth_super_headers, company_tenant, user_admin
):
    from api.models import Station

    Station.objects.create(company_id=company_tenant.id, station_name="A")
    Station.objects.create(company_id=company_tenant.id, station_name="B")
    r = api_client.put(
        f"/api/companies/{company_tenant.id}/",
        data=json.dumps({"station_mode": "single"}),
        content_type="application/json",
        **_super_tenant_headers(auth_super_headers, company_tenant),
    )
    assert r.status_code == 400
    assert "active" in json.loads(r.content).get("detail", "").lower()


def test_post_second_station_rejected_in_single_mode(
    api_client: Client, auth_admin_headers, company_tenant, user_admin
):
    from api.models import Company, Station

    Company.objects.filter(id=company_tenant.id).update(station_mode="single")
    Station.objects.create(company_id=company_tenant.id, station_name="Only")
    r = api_client.post(
        "/api/stations/",
        data=json.dumps({"station_name": "Second"}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400
    assert "single" in json.loads(r.content).get("detail", "").lower()


def test_post_inactive_second_station_ok_in_single_mode(
    api_client: Client, auth_admin_headers, company_tenant, user_admin
):
    """Archived / inactive site rows do not count against the one-active cap."""
    from api.models import Company, Station

    Company.objects.filter(id=company_tenant.id).update(station_mode="single")
    Station.objects.create(company_id=company_tenant.id, station_name="Only", is_active=True)
    r = api_client.post(
        "/api/stations/",
        data=json.dumps({"station_name": "Former", "is_active": False}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201
    data = json.loads(r.content)
    assert data.get("is_active") is False


def test_put_single_ok_when_second_station_inactive(
    api_client: Client, auth_super_headers, company_tenant, user_admin
):
    from api.models import Station

    Station.objects.create(company_id=company_tenant.id, station_name="A", is_active=True)
    Station.objects.create(company_id=company_tenant.id, station_name="B", is_active=False)
    r = api_client.put(
        f"/api/companies/{company_tenant.id}/",
        data=json.dumps({"station_mode": "single"}),
        content_type="application/json",
        **_super_tenant_headers(auth_super_headers, company_tenant),
    )
    assert r.status_code == 200
    assert json.loads(r.content).get("station_mode") == "single"


def test_put_single_ok_with_one_station(
    api_client: Client, auth_super_headers, company_tenant, user_admin
):
    from api.models import Station

    Station.objects.create(company_id=company_tenant.id, station_name="One")
    r = api_client.put(
        f"/api/companies/{company_tenant.id}/",
        data=json.dumps({"station_mode": "single"}),
        content_type="application/json",
        **_super_tenant_headers(auth_super_headers, company_tenant),
    )
    assert r.status_code == 200
    assert json.loads(r.content).get("station_mode") == "single"


def test_put_station_mode_change_forbidden_for_tenant_admin(
    api_client: Client, auth_admin_headers, company_tenant, user_admin
):
    from api.models import Company

    Company.objects.filter(id=company_tenant.id).update(station_mode="multi")
    r = api_client.put(
        f"/api/companies/{company_tenant.id}/",
        data=json.dumps({"station_mode": "single"}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 403
    assert "super admin" in json.loads(r.content).get("detail", "").lower()


def test_put_station_mode_unchanged_ok_for_tenant_admin(
    api_client: Client, auth_admin_headers, company_tenant, user_admin
):
    """Tenant may PUT the same station_mode value when saving other company fields."""
    from api.models import Company

    Company.objects.filter(id=company_tenant.id).update(station_mode="multi")
    r = api_client.put(
        f"/api/companies/{company_tenant.id}/",
        data=json.dumps({"station_mode": "multi"}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200


def test_cannot_deactivate_last_active_station(
    api_client: Client, auth_admin_headers, company_tenant, user_admin
):
    from api.models import Station

    s = Station.objects.create(company_id=company_tenant.id, station_name="Solo", is_active=True)
    r = api_client.put(
        f"/api/stations/{s.id}/",
        data=json.dumps({"is_active": False}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400
    assert "active" in json.loads(r.content).get("detail", "").lower()


def test_post_inactive_station_rejected_when_no_active_exists(
    api_client: Client, auth_admin_headers, company_tenant, user_admin
):
    from api.models import Station

    Station.objects.create(company_id=company_tenant.id, station_name="Old", is_active=False)
    r = api_client.post(
        "/api/stations/",
        data=json.dumps({"station_name": "AnotherClosed", "is_active": False}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400


def test_deactivate_repoints_user_home_station(
    api_client: Client, auth_admin_headers, company_tenant, user_admin
):
    from api.models import Station, User

    a = Station.objects.create(company_id=company_tenant.id, station_name="A", is_active=True)
    b = Station.objects.create(company_id=company_tenant.id, station_name="B", is_active=True)
    User.objects.filter(pk=user_admin.id).update(home_station_id=a.id)
    r = api_client.put(
        f"/api/stations/{a.id}/",
        data=json.dumps({"is_active": False}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200
    user_admin.refresh_from_db()
    assert user_admin.home_station_id == b.id


def test_inventory_transfer_rejected_with_one_active_site(
    api_client: Client, auth_admin_headers, company_tenant, user_admin
):
    """Inter-station stock moves need two active sites; single-site tenants get a clear 400."""
    from api.models import Station

    st = Station.objects.create(company_id=company_tenant.id, station_name="Solo", is_active=True)
    r = api_client.post(
        "/api/inventory/transfers/",
        data=json.dumps(
            {
                "from_station_id": st.id,
                "to_station_id": 999000001,
                "lines": [{"item_id": 1, "quantity": "1"}],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400
    assert "at least two" in json.loads(r.content).get("detail", "").lower()
