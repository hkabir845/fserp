"""Pond POS customer auto-provision and shop-station default."""
from __future__ import annotations

import json

import pytest

from api.models import AquaculturePond, Company, Customer, Station
from api.services.aquaculture_pond_pos_customer import (
    auto_pos_customer_display_name,
    maybe_provision_auto_pos_customer,
    provision_missing_pond_pos_customers,
    resolve_shop_station_for_pond,
)


@pytest.fixture
def aquaculture_company(company_tenant):
    company_tenant.aquaculture_enabled = True
    company_tenant.aquaculture_licensed = True
    company_tenant.save(update_fields=["aquaculture_enabled", "aquaculture_licensed"])
    return company_tenant


@pytest.mark.django_db
def test_provision_pond_pos_customer_uses_shop_station(aquaculture_company):
    cid = aquaculture_company.id
    fuel = Station.objects.create(
        company_id=cid,
        station_name="Main Forecourt",
        is_active=True,
        operates_fuel_retail=True,
    )
    shop = Station.objects.create(
        company_id=cid,
        station_name="Premium Agro",
        is_active=True,
        operates_fuel_retail=False,
    )
    pond = AquaculturePond.objects.create(company_id=cid, name="Pond A", code="P01", is_active=True)
    err = maybe_provision_auto_pos_customer(company_id=cid, pond=pond, skip_auto=False)
    assert err is None
    pond.refresh_from_db()
    assert pond.pos_customer_id
    assert pond.auto_pos_customer is True
    cust = Customer.objects.get(pk=pond.pos_customer_id)
    assert cust.display_name == auto_pos_customer_display_name("Pond A")
    assert cust.default_station_id == shop.id
    assert cust.default_station_id != fuel.id


@pytest.mark.django_db
def test_provision_missing_pond_pos_customers_endpoint(
    api_client, aquaculture_company, auth_admin_headers
):
    cid = aquaculture_company.id
    Station.objects.create(
        company_id=cid,
        station_name="Premium Agro",
        is_active=True,
        operates_fuel_retail=False,
    )
    AquaculturePond.objects.create(company_id=cid, name="One", code="P01", is_active=True)
    AquaculturePond.objects.create(company_id=cid, name="Two", code="P02", is_active=True)

    res = api_client.post(
        "/api/aquaculture/ponds/provision-pos-customers/",
        data="{}",
        content_type="application/json",
        HTTP_X_SELECTED_COMPANY_ID=str(cid),
        **auth_admin_headers,
    )
    assert res.status_code == 200
    body = res.json()
    assert len(body["created"]) == 2
    assert body["errors"] == []
    assert Customer.objects.filter(company_id=cid, display_name__startswith="Aquaculture").count() == 2


@pytest.mark.django_db
def test_resolve_shop_station_prefers_pond_linked_station(aquaculture_company):
    cid = aquaculture_company.id
    pond = AquaculturePond.objects.create(company_id=cid, name="Linked", code="P99", is_active=True)
    other = Station.objects.create(
        company_id=cid,
        station_name="Other Shop",
        is_active=True,
        operates_fuel_retail=False,
    )
    linked = Station.objects.create(
        company_id=cid,
        station_name="Pond Depot",
        is_active=True,
        operates_fuel_retail=False,
        default_aquaculture_pond_id=pond.id,
    )
    sid = resolve_shop_station_for_pond(company_id=cid, pond_id=pond.id)
    assert sid == linked.id
    assert sid != other.id
