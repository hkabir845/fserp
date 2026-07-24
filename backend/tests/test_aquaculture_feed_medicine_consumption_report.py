"""Feed & medicine consumption report in the Reports hub."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureExpense,
    AquacultureExpenseInventoryLine,
    AquaculturePond,
    Company,
    Item,
)


def _enable(c: Company) -> None:
    Company.objects.filter(pk=c.id).update(aquaculture_enabled=True, aquaculture_licensed=True)


@pytest.mark.django_db
def test_feed_medicine_consumption_report_groups_by_pond(
    api_client, company_tenant, auth_admin_headers
):
    _enable(company_tenant)
    cid = company_tenant.id
    p1 = AquaculturePond.objects.create(company_id=cid, name="Pond Alpha", is_active=True)
    p2 = AquaculturePond.objects.create(company_id=cid, name="Pond Beta", is_active=True)

    AquacultureExpense.objects.create(
        company_id=cid,
        pond=p1,
        expense_category="feed_consumed",
        expense_date=date(2026, 5, 4),
        amount=Decimal("1200.00"),
        feed_weight_kg=Decimal("25.0000"),
        feed_sack_count=Decimal("1.00"),
        memo="Feed apply",
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=p1,
        expense_category="feed_consumed",
        expense_date=date(2026, 5, 4),
        amount=Decimal("600.00"),
        feed_weight_kg=Decimal("12.5000"),
        feed_sack_count=Decimal("0.50"),
        memo="Second feed same day",
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=p1,
        expense_category="medicine_consumed",
        expense_date=date(2026, 5, 6),
        amount=Decimal("300.00"),
        memo="Medicine dose",
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=p2,
        expense_category="feed_consumed",
        expense_date=date(2026, 5, 10),
        amount=Decimal("800.00"),
        feed_weight_kg=Decimal("15.0000"),
        feed_sack_count=Decimal("0.60"),
        memo="Other pond feed",
    )

    r = api_client.get(
        "/api/reports/aquaculture-feed-medicine-consumption/",
        {"start_date": "2026-05-01", "end_date": "2026-05-31"},
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    data = json.loads(r.content.decode())
    assert data.get("currency_code") == "BDT"
    assert len(data["groups"]) == 2
    totals = data["totals"]
    assert totals["total_feed_amount"] == "2600.00"
    assert totals["total_medicine_amount"] == "300.00"
    assert totals["total_amount"] == "2900.00"
    assert totals["total_feed_kg"] == "52.50"
    assert totals["total_feed_sacks"] == "2.10"
    assert totals["total_feed_tons"] == "0.0525"
    assert totals["feed_day_count"] == 2

    alpha = next(g for g in data["groups"] if g["pond_id"] == p1.id)
    assert alpha["subtotal_feed_amount"] == "1800.00"
    assert alpha["subtotal_medicine_amount"] == "300.00"
    assert alpha["subtotal_amount"] == "2100.00"
    assert alpha["subtotal_feed_kg"] == "37.50"
    assert alpha["subtotal_feed_sacks"] == "1.50"
    assert alpha["subtotal_feed_tons"] == "0.0375"
    assert len(alpha["lines"]) == 3
    assert len(alpha["daily_feed"]) == 1
    day = alpha["daily_feed"][0]
    assert day["date"] == "2026-05-04"
    assert day["sacks"] == "1.50"
    assert day["kg"] == "37.50"
    assert day["tons"] == "0.0375"
    assert day["amount"] == "1800.00"
    assert day["entry_count"] == 2
    assert len(alpha["daily_medicine"]) == 1
    assert alpha["daily_medicine"][0]["date"] == "2026-05-06"

    farm = data["farm_daily_feed"]
    assert len(farm) == 2
    may4 = next(x for x in farm if x["date"] == "2026-05-04")
    assert may4["kg"] == "37.50"
    assert may4["pond_count"] == 1


@pytest.mark.django_db
def test_feed_medicine_consumption_report_pond_filter(
    api_client, company_tenant, auth_admin_headers
):
    _enable(company_tenant)
    cid = company_tenant.id
    p1 = AquaculturePond.objects.create(company_id=cid, name="Only Pond", is_active=True)
    p2 = AquaculturePond.objects.create(company_id=cid, name="Other Pond", is_active=True)

    AquacultureExpense.objects.create(
        company_id=cid,
        pond=p1,
        expense_category="feed_consumed",
        expense_date=date(2026, 5, 4),
        amount=Decimal("500.00"),
        feed_weight_kg=Decimal("10.0000"),
        feed_sack_count=Decimal("0.40"),
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=p2,
        expense_category="feed_consumed",
        expense_date=date(2026, 5, 4),
        amount=Decimal("900.00"),
        feed_weight_kg=Decimal("20.0000"),
        feed_sack_count=Decimal("0.80"),
    )

    r = api_client.get(
        "/api/reports/aquaculture-feed-medicine-consumption/",
        {
            "start_date": "2026-05-01",
            "end_date": "2026-05-31",
            "pond_id": str(p1.id),
        },
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    data = json.loads(r.content.decode())
    assert len(data["groups"]) == 1
    assert data["groups"][0]["pond_id"] == p1.id
    assert data["totals"]["total_amount"] == "500.00"
    assert data["totals"]["total_feed_kg"] == "10.00"
    assert data["totals"]["total_feed_sacks"] == "0.40"
    assert data["totals"]["total_feed_tons"] == "0.0100"
    assert data["filter_pond_id"] == p1.id
    # Scoped farm daily still reflects filtered rows only
    assert len(data["farm_daily_feed"]) == 1
    assert data["farm_daily_feed"][0]["kg"] == "10.00"


@pytest.mark.django_db
def test_feed_consumption_and_medicine_consumption_are_separate(
    api_client, company_tenant, auth_admin_headers
):
    _enable(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="Split Pond", is_active=True)
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_category="feed_consumed",
        expense_date=date(2026, 5, 4),
        amount=Decimal("400.00"),
        feed_weight_kg=Decimal("8.0000"),
        feed_sack_count=Decimal("0.30"),
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_category="medicine_consumed",
        expense_date=date(2026, 5, 5),
        amount=Decimal("75.00"),
    )

    feed_r = api_client.get(
        "/api/reports/aquaculture-feed-consumption/",
        {"start_date": "2026-05-01", "end_date": "2026-05-31"},
        **auth_admin_headers,
    )
    assert feed_r.status_code == 200, feed_r.content.decode()
    feed_data = json.loads(feed_r.content.decode())
    assert feed_data["consumption_kind"] == "feed"
    assert feed_data["totals"]["total_feed_amount"] == "400.00"
    assert feed_data["totals"]["total_medicine_amount"] == "0.00"
    assert feed_data["totals"]["total_amount"] == "400.00"
    assert len(feed_data["groups"][0]["lines"]) == 1

    med_r = api_client.get(
        "/api/reports/aquaculture-medicine-consumption/",
        {"start_date": "2026-05-01", "end_date": "2026-05-31"},
        **auth_admin_headers,
    )
    assert med_r.status_code == 200, med_r.content.decode()
    med_data = json.loads(med_r.content.decode())
    assert med_data["consumption_kind"] == "medicine"
    assert med_data["totals"]["total_feed_amount"] == "0.00"
    assert med_data["totals"]["total_medicine_amount"] == "75.00"
    assert med_data["totals"]["total_amount"] == "75.00"
    assert len(med_data["groups"][0]["lines"]) == 1


@pytest.mark.django_db
def test_feed_medicine_consumption_report_item_filters(
    api_client, company_tenant, auth_admin_headers
):
    _enable(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="Filter Pond", is_active=True)
    feed_a = Item.objects.create(
        company_id=cid, name="Feed A", item_type="inventory", pos_category="feed", is_active=True
    )
    feed_b = Item.objects.create(
        company_id=cid, name="Feed B", item_type="inventory", pos_category="feed", is_active=True
    )
    med = Item.objects.create(
        company_id=cid,
        name="Med X",
        item_type="inventory",
        pos_category="medicine",
        is_active=True,
    )

    exp_a = AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_category="feed_consumed",
        expense_date=date(2026, 5, 4),
        amount=Decimal("100.00"),
        feed_weight_kg=Decimal("10.0000"),
        feed_sack_count=Decimal("0.40"),
    )
    AquacultureExpenseInventoryLine.objects.create(
        expense=exp_a, item=feed_a, quantity=Decimal("0.40")
    )
    exp_b = AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_category="feed_consumed",
        expense_date=date(2026, 5, 5),
        amount=Decimal("200.00"),
        feed_weight_kg=Decimal("20.0000"),
        feed_sack_count=Decimal("0.80"),
    )
    AquacultureExpenseInventoryLine.objects.create(
        expense=exp_b, item=feed_b, quantity=Decimal("0.80")
    )
    exp_m = AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_category="medicine_consumed",
        expense_date=date(2026, 5, 6),
        amount=Decimal("50.00"),
    )
    AquacultureExpenseInventoryLine.objects.create(
        expense=exp_m, item=med, quantity=Decimal("1.00")
    )

    r = api_client.get(
        "/api/reports/aquaculture-feed-medicine-consumption/",
        {
            "start_date": "2026-05-01",
            "end_date": "2026-05-31",
            "feed_item_id": str(feed_a.id),
        },
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    data = json.loads(r.content.decode())
    assert data["filter_feed_item_id"] == feed_a.id
    assert data["totals"]["total_feed_amount"] == "100.00"
    assert data["totals"]["total_medicine_amount"] == "50.00"
    assert data["totals"]["total_amount"] == "150.00"
    opt_ids = {o["id"] for o in data["feed_item_options"]}
    assert feed_a.id in opt_ids and feed_b.id in opt_ids

    r2 = api_client.get(
        "/api/reports/aquaculture-feed-medicine-consumption/",
        {
            "start_date": "2026-05-01",
            "end_date": "2026-05-31",
            "medicine_item_id": str(med.id),
            "feed_item_id": str(feed_b.id),
        },
        **auth_admin_headers,
    )
    assert r2.status_code == 200, r2.content.decode()
    data2 = json.loads(r2.content.decode())
    assert data2["totals"]["total_feed_amount"] == "200.00"
    assert data2["totals"]["total_medicine_amount"] == "50.00"
    assert data2["filter_medicine_item_id"] == med.id
