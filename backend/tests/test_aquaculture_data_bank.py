"""Aquaculture Data Bank: per-pond year close, locks, reopen for reference."""
from __future__ import annotations

import json
from datetime import date

import pytest

from api.models import AquacultureDataBankPondClose, AquacultureFishSale, AquaculturePond, Customer, Station
from api.services.aquaculture_data_bank_service import (
    close_pond,
    close_station,
    list_data_bank,
    pond_ids_for_station,
    pond_write_blocked_detail,
    preview_station_close,
    reopen_close_for_reference,
)


@pytest.mark.django_db
def test_close_one_pond_does_not_lock_other_pond(api_client, company_tenant, auth_admin_headers):
    company_tenant.__class__.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True, fiscal_year_start="01-01"
    )
    p1 = AquaculturePond.objects.create(company_id=company_tenant.id, name="Pond A", is_active=True)
    p2 = AquaculturePond.objects.create(company_id=company_tenant.id, name="Pond B", is_active=True)

    r_close = api_client.post(
        "/api/aquaculture/data-bank/close-pond/",
        data=json.dumps(
            {"pond_id": p1.id, "period_end": "2025-06-30", "period_start": "2024-07-01"}
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r_close.status_code == 201, r_close.content.decode()

    assert pond_write_blocked_detail(company_tenant.id, p1.id) is not None
    assert pond_write_blocked_detail(company_tenant.id, p2.id) is None

    r_cycle_locked = api_client.post(
        "/api/aquaculture/production-cycles/",
        data=json.dumps({"pond_id": p1.id, "name": "C1", "start_date": "2025-01-01"}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r_cycle_locked.status_code == 409

    r_cycle_ok = api_client.post(
        "/api/aquaculture/production-cycles/",
        data=json.dumps({"pond_id": p2.id, "name": "C2", "start_date": "2025-01-01"}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r_cycle_ok.status_code == 201, r_cycle_ok.content.decode()


@pytest.mark.django_db
def test_different_ponds_different_period_ends(api_client, company_tenant, auth_admin_headers):
    company_tenant.__class__.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    p1 = AquaculturePond.objects.create(company_id=company_tenant.id, name="Early", is_active=True)
    p2 = AquaculturePond.objects.create(company_id=company_tenant.id, name="Late", is_active=True)

    for pond, end in ((p1, "2025-03-31"), (p2, "2025-12-31")):
        r = api_client.post(
            "/api/aquaculture/data-bank/close-pond/",
            data=json.dumps({"pond_id": pond.id, "period_end": end}),
            content_type="application/json",
            **auth_admin_headers,
        )
        assert r.status_code == 201, r.content.decode()

    assert AquacultureDataBankPondClose.objects.filter(company_id=company_tenant.id).count() == 2
    ends = set(
        AquacultureDataBankPondClose.objects.filter(company_id=company_tenant.id).values_list(
            "period_end", flat=True
        )
    )
    assert ends == {date(2025, 3, 31), date(2025, 12, 31)}


@pytest.mark.django_db
def test_reopen_for_reference_still_blocks_writes(company_tenant):
    company_tenant.__class__.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="Ref", is_active=True)
    close, err = close_pond(
        company_id=company_tenant.id,
        pond_id=pond.id,
        period_end=date(2024, 12, 31),
        user=None,
    )
    assert err is None
    close, err2 = reopen_close_for_reference(
        company_id=company_tenant.id,
        close_id=close.id,
        user=None,
        reason="Review",
    )
    assert err2 is None
    assert close.reference_access_enabled is True
    assert pond_write_blocked_detail(company_tenant.id, pond.id) is not None


@pytest.mark.django_db
def test_data_bank_lists_all_ponds_including_without_close(company_tenant):
    company_tenant.__class__.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    p_open = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Open Pond", is_active=True
    )
    p_closed = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Closed Pond", is_active=True
    )
    close_pond(
        company_id=company_tenant.id,
        pond_id=p_closed.id,
        period_end=date(2024, 12, 31),
        user=None,
    )
    payload = list_data_bank(company_tenant.id)
    pond_ids = {row["pond_id"] for row in payload["ponds"]}
    assert pond_ids == {p_open.id, p_closed.id}
    open_row = next(p for p in payload["ponds"] if p["pond_id"] == p_open.id)
    closed_row = next(p for p in payload["ponds"] if p["pond_id"] == p_closed.id)
    assert open_row["is_currently_locked"] is False
    assert closed_row["is_currently_locked"] is True


@pytest.mark.django_db
def test_data_bank_list_and_non_admin_cannot_close(
    api_client, company_tenant, auth_admin_headers, auth_accountant_headers
):
    company_tenant.__class__.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="Only", is_active=True)
    close_pond(company_id=company_tenant.id, pond_id=pond.id, period_end=date(2023, 12, 31), user=None)

    r_list = api_client.get("/api/aquaculture/data-bank/", **auth_admin_headers)
    assert r_list.status_code == 200
    body = json.loads(r_list.content.decode())
    assert "ponds" in body
    assert len(body["ponds"]) >= 1
    row = next(p for p in body["ponds"] if p["pond_id"] == pond.id)
    assert row["is_currently_locked"] is True
    assert len(row["close_history"]) == 1

    r_denied = api_client.post(
        "/api/aquaculture/data-bank/close-pond/",
        data=json.dumps({"pond_id": pond.id, "period_end": "2024-12-31"}),
        content_type="application/json",
        **auth_accountant_headers,
    )
    assert r_denied.status_code == 403


@pytest.mark.django_db
def test_close_station_closes_linked_ponds_only(api_client, company_tenant, auth_admin_headers):
    company_tenant.__class__.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True, fiscal_year_start="01-01"
    )
    shop = Station.objects.create(
        company_id=company_tenant.id,
        station_name="Premium Agro",
        operates_fuel_retail=False,
        is_active=True,
    )
    other_shop = Station.objects.create(
        company_id=company_tenant.id,
        station_name="Other Shop",
        operates_fuel_retail=False,
        is_active=True,
    )
    p_shop_a = AquaculturePond.objects.create(company_id=company_tenant.id, name="Shop A", is_active=True)
    p_shop_b = AquaculturePond.objects.create(company_id=company_tenant.id, name="Shop B", is_active=True)
    p_other = AquaculturePond.objects.create(company_id=company_tenant.id, name="Elsewhere", is_active=True)

    for pond, station in ((p_shop_a, shop), (p_shop_b, shop), (p_other, other_shop)):
        cust = Customer.objects.create(
            company_id=company_tenant.id,
            display_name=f"Aquaculture — {pond.name}",
            default_station_id=station.id,
        )
        pond.pos_customer_id = cust.id
        pond.auto_pos_customer = True
        pond.save(update_fields=["pos_customer_id", "auto_pos_customer"])

    assert set(pond_ids_for_station(company_tenant.id, shop.id)) == {p_shop_a.id, p_shop_b.id}

    r = api_client.post(
        "/api/aquaculture/data-bank/close-station/",
        data=json.dumps({"station_id": shop.id, "period_end": "2025-12-31"}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    body = json.loads(r.content.decode())
    assert len(body["closed"]) == 2
    assert pond_write_blocked_detail(company_tenant.id, p_shop_a.id) is not None
    assert pond_write_blocked_detail(company_tenant.id, p_shop_b.id) is not None
    assert pond_write_blocked_detail(company_tenant.id, p_other.id) is None


@pytest.mark.django_db
def test_locked_pond_live_api_hides_archived_sales(api_client, company_tenant, auth_admin_headers):
    company_tenant.__class__.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="Archived", is_active=True)
    close_pond(
        company_id=company_tenant.id,
        pond_id=pond.id,
        period_end=date(2025, 6, 30),
        period_start=date(2024, 7, 1),
        user=None,
    )
    AquacultureFishSale.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        sale_date=date(2025, 3, 15),
        weight_kg="100",
        total_amount="5000",
        income_type="fish_harvest_sale",
    )
    AquacultureFishSale.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        sale_date=date(2025, 8, 1),
        weight_kg="50",
        total_amount="2500",
        income_type="fish_harvest_sale",
    )
    r = api_client.get(f"/api/aquaculture/sales/?pond_id={pond.id}", **auth_admin_headers)
    assert r.status_code == 200
    body = json.loads(r.content.decode())
    assert len(body) == 1
    assert body[0]["sale_date"] == "2025-08-01"


@pytest.mark.django_db
def test_preview_station_close(company_tenant):
    company_tenant.__class__.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    shop = Station.objects.create(
        company_id=company_tenant.id,
        station_name="Shop Hub",
        operates_fuel_retail=False,
    )
    pond = AquaculturePond.objects.create(company_id=company_tenant.id, name="Linked", is_active=True)
    shop.default_aquaculture_pond_id = pond.id
    shop.save(update_fields=["default_aquaculture_pond_id"])

    payload = preview_station_close(company_tenant, shop, date(2025, 6, 30))
    assert payload["pond_count"] == 1
    assert payload["ponds"][0]["pond_id"] == pond.id

    result, err = close_station(
        company_id=company_tenant.id,
        station_id=shop.id,
        period_end=date(2025, 6, 30),
        user=None,
    )
    assert err is None
    assert len(result["closed"]) == 1
