"""User home station: POS binding and report scope."""
from __future__ import annotations

import json

import pytest
from django.test import Client

pytestmark = pytest.mark.django_db


def test_user_put_home_station(api_client: Client, auth_admin_headers, company_tenant, user_admin):
    from api.models import Station

    st = Station.objects.create(company_id=company_tenant.id, station_name="Home A")
    r = api_client.put(
        f"/api/users/{user_admin.id}/",
        data=json.dumps({"home_station_id": st.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content
    data = json.loads(r.content)
    assert data.get("home_station_id") == st.id


def test_report_fuel_sales_respects_station_param(
    api_client: Client, auth_admin_headers, company_tenant, user_admin
):
    from api.models import Station

    Station.objects.create(company_id=company_tenant.id, station_name="S1")
    s2 = Station.objects.create(company_id=company_tenant.id, station_name="S2")
    r = api_client.get(
        f"/api/reports/fuel-sales/?start_date=2020-01-01&end_date=2030-12-31&station_id={s2.id}",
        **auth_admin_headers,
    )
    assert r.status_code == 200
    body = json.loads(r.content)
    assert body.get("filter_station_id") == s2.id


def test_create_cashier_multistation_requires_home_station(
    api_client: Client, auth_admin_headers, company_tenant
):
    from api.models import Station

    s1 = Station.objects.create(company_id=company_tenant.id, station_name="East")
    Station.objects.create(company_id=company_tenant.id, station_name="West")
    r = api_client.post(
        "/api/users/",
        data=json.dumps(
            {
                "username": "new_cashier_loc@test.com",
                "email": "new_cashier_loc@test.com",
                "full_name": "New Cashier",
                "role": "cashier",
                "password": "AuditTest#99",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400
    assert "location" in json.loads(r.content).get("detail", "").lower()

    r2 = api_client.post(
        "/api/users/",
        data=json.dumps(
            {
                "username": "new_cashier_ok@test.com",
                "email": "new_cashier_ok@test.com",
                "full_name": "New Cashier OK",
                "role": "cashier",
                "password": "AuditTest#99",
                "home_station_id": s1.id,
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r2.status_code == 201, r2.content
    body = json.loads(r2.content)
    assert body.get("home_station_id") == s1.id


def test_create_cashier_single_station_auto_home(
    api_client: Client, auth_admin_headers, company_tenant
):
    from api.models import Station

    st = Station.objects.create(company_id=company_tenant.id, station_name="Only Site")
    r = api_client.post(
        "/api/users/",
        data=json.dumps(
            {
                "username": "cashier_one_site@test.com",
                "email": "cashier_one_site@test.com",
                "full_name": "One Site Cashier",
                "role": "cashier",
                "password": "AuditTest#99",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content
    assert json.loads(r.content).get("home_station_id") == st.id


def test_cashier_without_home_multistation_report_forbidden(
    api_client: Client, company_tenant, user_admin
):
    from api.models import Station, User

    Station.objects.create(company_id=company_tenant.id, station_name="A")
    Station.objects.create(company_id=company_tenant.id, station_name="B")
    ch = User(
        username="audit_cashier_ns@test.com",
        email="audit_cashier_ns@test.com",
        full_name="Cashier No Home",
        role="cashier",
        is_active=True,
        company_id=company_tenant.id,
        home_station_id=None,
    )
    ch.set_password("AuditTest#99")
    ch.save()
    r = api_client.post(
        "/api/auth/login/",
        data=json.dumps({"username": ch.username, "password": "AuditTest#99"}),
        content_type="application/json",
    )
    assert r.status_code == 200, r.content
    token = json.loads(r.content)["access_token"]
    h = {"HTTP_AUTHORIZATION": f"Bearer {token}"}
    rep = api_client.get(
        "/api/reports/shift-summary/?start_date=2020-01-01&end_date=2030-12-31",
        **h,
    )
    assert rep.status_code == 403
    assert "home station" in json.loads(rep.content).get("detail", "").lower()


def test_item_stock_movement_includes_filter_station(
    api_client: Client, auth_admin_headers, company_tenant, user_admin
):
    from api.models import Station

    s1 = Station.objects.create(company_id=company_tenant.id, station_name="S1")
    Station.objects.create(company_id=company_tenant.id, station_name="S2")
    r = api_client.get(
        f"/api/reports/item-stock-movement/?start_date=2020-01-01&end_date=2030-12-31&station_id={s1.id}",
        **auth_admin_headers,
    )
    assert r.status_code == 200
    body = json.loads(r.content)
    assert body.get("filter_station_id") == s1.id
