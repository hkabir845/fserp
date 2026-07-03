"""Meter reset is restricted to users with station management permission (not cashiers)."""
from __future__ import annotations

import json
from decimal import Decimal

import pytest

from api.models import Dispenser, Island, Meter, Station, User


@pytest.fixture
def user_cashier(db, company_tenant):
    u = User(
        username="meter_cashier@test.com",
        email="meter_cashier@test.com",
        full_name="Meter Cashier",
        role="cashier",
        is_active=True,
        company_id=company_tenant.id,
    )
    u.set_password("AuditTest#99")
    u.save()
    return u


@pytest.fixture
def auth_cashier_headers(api_client, user_cashier):
    r = api_client.post(
        "/api/auth/login/",
        data=json.dumps({"username": user_cashier.username, "password": "AuditTest#99"}),
        content_type="application/json",
    )
    assert r.status_code == 200, r.content.decode()
    data = json.loads(r.content)
    return {"HTTP_AUTHORIZATION": f"Bearer {data['access_token']}"}


def _seed_meter(company):
    station = Station.objects.create(company=company, station_name="Perm Stn", is_active=True)
    island = Island.objects.create(company=company, station=station, island_name="Perm Isle")
    dispenser = Dispenser.objects.create(company=company, island=island, dispenser_name="Perm D1")
    return Meter.objects.create(
        company=company,
        dispenser=dispenser,
        meter_name="Perm Meter",
        current_reading=Decimal("1500.0000"),
    )


@pytest.mark.django_db
def test_cashier_cannot_reset_meter(api_client, company_tenant, auth_cashier_headers):
    meter = _seed_meter(company_tenant)
    r = api_client.post(
        f"/api/meters/{meter.id}/reset/",
        data=json.dumps({"reason": "should be blocked"}),
        content_type="application/json",
        **auth_cashier_headers,
    )
    assert r.status_code == 403
    body = json.loads(r.content)
    assert "station management" in body.get("detail", "").lower()

    meter.refresh_from_db()
    assert meter.current_reading == Decimal("1500.0000")


@pytest.mark.django_db
def test_admin_can_reset_meter(api_client, company_tenant, auth_admin_headers):
    meter = _seed_meter(company_tenant)
    r = api_client.post(
        f"/api/meters/{meter.id}/reset/",
        data=json.dumps({"reason": "annual rollover"}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()

    meter.refresh_from_db()
    assert meter.current_reading == Decimal("0")
    assert meter.reset_count == 1
