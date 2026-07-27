"""POS lane scope (User.pos_sale_scope): both / general / fuel enforced at checkout."""
from __future__ import annotations

import json
from decimal import Decimal

import pytest
from django.test import Client

from api.services.permission_service import user_pos_sale_scope

pytestmark = pytest.mark.django_db


def _login_headers(api_client: Client, user) -> dict:
    r = api_client.post(
        "/api/auth/login/",
        data=json.dumps({"username": user.username, "password": "AuditTest#99"}),
        content_type="application/json",
    )
    assert r.status_code == 200, r.content.decode()
    token = json.loads(r.content)["access_token"]
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _make_cashier(company, *, scope: str, username: str):
    from api.models import User

    u = User(
        username=username,
        email=username,
        full_name=f"POS {scope}",
        role="cashier",
        is_active=True,
        company_id=company.id,
        pos_sale_scope=scope,
    )
    u.set_password("AuditTest#99")
    u.save()
    return u


def _fuel_nozzle(company):
    from api.models import Dispenser, Island, Item, Meter, Nozzle, Station, Tank

    station = Station.objects.create(company=company, station_name="Scope Pump Bay")
    product = Item.objects.create(
        company=company,
        name="Scope Petrol",
        unit_price=Decimal("100.00"),
        quantity_on_hand=Decimal("0"),
    )
    tank = Tank.objects.create(
        company=company,
        station=station,
        product=product,
        tank_name="T-scope",
        capacity=Decimal("50000"),
        current_stock=Decimal("10000"),
    )
    island = Island.objects.create(company=company, station=station, island_name="I1")
    dispenser = Dispenser.objects.create(company=company, island=island, dispenser_name="D1")
    meter = Meter.objects.create(
        company=company,
        dispenser=dispenser,
        current_reading=Decimal("100.0000"),
    )
    return Nozzle.objects.create(
        company=company,
        meter=meter,
        tank=tank,
        product=product,
    )


def test_user_pos_sale_scope_values(company_tenant):
    fuel_user = _make_cashier(company_tenant, scope="fuel", username="scope_fuel@test.com")
    shop_user = _make_cashier(company_tenant, scope="general", username="scope_shop@test.com")
    both_user = _make_cashier(company_tenant, scope="both", username="scope_both@test.com")
    assert user_pos_sale_scope(fuel_user) == "fuel"
    assert user_pos_sale_scope(shop_user) == "general"
    assert user_pos_sale_scope(both_user) == "both"


def test_login_exposes_pos_sale_scope(api_client: Client, company_tenant):
    user = _make_cashier(company_tenant, scope="fuel", username="scope_login@test.com")
    r = api_client.post(
        "/api/auth/login/",
        data=json.dumps({"username": user.username, "password": "AuditTest#99"}),
        content_type="application/json",
    )
    assert r.status_code == 200
    assert json.loads(r.content)["user"]["pos_sale_scope"] == "fuel"


def test_general_lane_rejects_fuel_lines(api_client: Client, company_tenant):
    from tests.conftest import seed_min_gl_accounts

    seed_min_gl_accounts(company_tenant)
    user = _make_cashier(company_tenant, scope="general", username="scope_gen_fuel@test.com")
    nozzle = _fuel_nozzle(company_tenant)
    h = _login_headers(api_client, user)
    r = api_client.post(
        "/api/cashier/pos/",
        data=json.dumps(
            {
                "items": [],
                "fuel_lines": [{"nozzle_id": nozzle.id, "quantity": "1"}],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 400, r.content
    detail = json.loads(r.content).get("detail", "").lower()
    assert "shop only" in detail or "fuel" in detail


def test_fuel_lane_rejects_shop_items(api_client: Client, company_tenant):
    from api.models import Item
    from tests.conftest import seed_min_gl_accounts

    seed_min_gl_accounts(company_tenant)
    user = _make_cashier(company_tenant, scope="fuel", username="scope_fuel_shop@test.com")
    item = Item.objects.create(
        company=company_tenant,
        name="Scope Snack",
        unit_price=Decimal("5.00"),
        quantity_on_hand=Decimal("20"),
    )
    h = _login_headers(api_client, user)
    r = api_client.post(
        "/api/cashier/pos/",
        data=json.dumps(
            {
                "items": [{"item_id": item.id, "quantity": "1", "unit_price": "5.00"}],
                "fuel_lines": [],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 400, r.content
    detail = json.loads(r.content).get("detail", "").lower()
    assert "fuel only" in detail or "shop" in detail


def test_both_lane_allows_shop_only_sale(api_client: Client, company_tenant):
    from api.models import Item, Station
    from api.services.station_stock import set_station_stock
    from tests.conftest import seed_min_gl_accounts

    seed_min_gl_accounts(company_tenant)
    st = Station.objects.create(company=company_tenant, station_name="Both Shop Site")
    user = _make_cashier(company_tenant, scope="both", username="scope_both_shop@test.com")
    item = Item.objects.create(
        company=company_tenant,
        name="Scope Both Snack",
        unit_price=Decimal("5.00"),
        quantity_on_hand=Decimal("20"),
    )
    set_station_stock(company_tenant.id, st.id, item.id, Decimal("20"))
    h = _login_headers(api_client, user)
    r = api_client.post(
        "/api/cashier/pos/",
        data=json.dumps(
            {
                "items": [{"item_id": item.id, "quantity": "1", "unit_price": "5.00"}],
                "fuel_lines": [],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content


def test_create_operator_defaults_fuel_scope(api_client: Client, auth_admin_headers, company_tenant):
    from api.models import Station

    st = Station.objects.create(company_id=company_tenant.id, station_name="Op Site")
    r = api_client.post(
        "/api/users/",
        data=json.dumps(
            {
                "username": "new_op_scope@test.com",
                "email": "new_op_scope@test.com",
                "full_name": "New Operator",
                "role": "operator",
                "password": "AuditTest#99",
                "home_station_id": st.id,
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content
    body = json.loads(r.content)
    assert body.get("pos_sale_scope") == "fuel"


def test_create_shopkeeper_defaults_general_scope(
    api_client: Client, auth_admin_headers, company_tenant
):
    from api.models import Station

    st = Station.objects.create(company_id=company_tenant.id, station_name="Shop Site")
    r = api_client.post(
        "/api/users/",
        data=json.dumps(
            {
                "username": "new_shop_scope@test.com",
                "email": "new_shop_scope@test.com",
                "full_name": "New Shopkeeper",
                "role": "shopkeeper",
                "password": "AuditTest#99",
                "home_station_id": st.id,
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content
    body = json.loads(r.content)
    assert body.get("pos_sale_scope") == "general"
