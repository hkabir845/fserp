"""P0 ops: sale clearance, day log, harvest lot plan."""
from __future__ import annotations

import json
from datetime import date

import pytest

from api.models import (
    AquacultureExpense,
    AquacultureHarvestLotPlan,
    AquaculturePond,
    AquaculturePondDayLog,
)
from api.services.aquaculture_sale_clearance_service import (
    apply_withdrawal_to_expense,
    assert_pond_cleared_for_sale,
    compute_clear_to_sell_on,
    parse_withdrawal_days_from_memo,
    pond_sale_clearance,
)


@pytest.mark.django_db
def test_parse_withdrawal_from_memo():
    assert parse_withdrawal_days_from_memo("Purpose: Therapeutic | Withdrawal: 14 d") == 14
    assert parse_withdrawal_days_from_memo("no withdrawal here") is None
    assert compute_clear_to_sell_on(date(2026, 9, 24), 14) == date(2026, 10, 8)


@pytest.mark.django_db
def test_pond_sale_clearance_blocks_until_clear(company_tenant):
    company = company_tenant
    company.__class__.objects.filter(pk=company.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    pond = AquaculturePond.objects.create(
        company=company, name="Digonta", water_area_decimal=400, pond_role="grow_out"
    )
    treated = date(2026, 9, 20)
    x = AquacultureExpense.objects.create(
        company=company,
        pond=pond,
        expense_category="medicine_consumed",
        expense_date=treated,
        amount=100,
        memo="Purpose: Therapeutic | Withdrawal: 21 d",
    )
    apply_withdrawal_to_expense(x)
    x.refresh_from_db()
    assert x.withdrawal_days == 21
    assert x.clear_to_sell_on == date(2026, 10, 11)

    early = pond_sale_clearance(company.id, pond.id, date(2026, 10, 1))
    assert early["cleared"] is False
    assert assert_pond_cleared_for_sale(company.id, pond.id, date(2026, 10, 1))

    ok = pond_sale_clearance(company.id, pond.id, date(2026, 10, 11))
    assert ok["cleared"] is True
    assert assert_pond_cleared_for_sale(company.id, pond.id, date(2026, 10, 11)) is None


@pytest.mark.django_db
def test_day_log_and_harvest_plan_api(api_client, company_tenant, auth_admin_headers):
    company = company_tenant
    company.__class__.objects.filter(pk=company.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    pond = AquaculturePond.objects.create(
        company=company, name="Mynuddin", water_area_decimal=750, pond_role="grow_out"
    )

    r = api_client.post(
        "/api/aquaculture/day-logs/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "log_date": "2026-09-25",
                "do_morning_mg_l": "4.2",
                "mortality_count": 12,
                "feed_kg": "80",
                "appetite": "low",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    body = r.json()
    assert body["pond_id"] == pond.id
    assert body["mortality_count"] == 12

    r2 = api_client.post(
        "/api/aquaculture/day-logs/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "log_date": "2026-09-25",
                "do_morning_mg_l": "5.0",
                "mortality_count": 8,
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r2.status_code == 200, r2.content.decode()
    assert AquaculturePondDayLog.objects.filter(company=company, pond=pond).count() == 1
    assert r2.json()["do_morning_mg_l"] == "5.00"

    pr = api_client.post(
        "/api/aquaculture/harvest-lot-plans/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "title": "Mynuddin full harvest",
                "planned_start": "2026-09-27",
                "planned_end": "2026-10-03",
                "target_avg_weight_g": "250",
                "priority": 10,
                "status": "planned",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert pr.status_code == 201, pr.content.decode()
    assert AquacultureHarvestLotPlan.objects.filter(company=company, pond=pond).count() == 1

    cr = api_client.get(
        "/api/aquaculture/sale-clearance/",
        {"pond_id": pond.id, "sale_date": "2026-09-27"},
        **auth_admin_headers,
    )
    assert cr.status_code == 200
    assert cr.json()["cleared"] is True
