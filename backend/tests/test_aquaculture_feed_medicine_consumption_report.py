"""Feed & medicine consumption report in the Reports hub."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import AquacultureExpense, AquaculturePond, Company


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
        memo="Feed apply",
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
    assert totals["total_feed_amount"] == "2000.00"
    assert totals["total_medicine_amount"] == "300.00"
    assert totals["total_amount"] == "2300.00"
    assert totals["total_feed_kg"] == "40.00"

    alpha = next(g for g in data["groups"] if g["pond_id"] == p1.id)
    assert alpha["subtotal_feed_amount"] == "1200.00"
    assert alpha["subtotal_medicine_amount"] == "300.00"
    assert alpha["subtotal_amount"] == "1500.00"
    assert len(alpha["lines"]) == 2


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
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=p2,
        expense_category="feed_consumed",
        expense_date=date(2026, 5, 4),
        amount=Decimal("900.00"),
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
