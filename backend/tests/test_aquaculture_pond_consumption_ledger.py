"""Pond warehouse consumption ledger: lists feed/medicine_consumed expenses with optional advice + journal."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureExpense,
    AquacultureFeedingAdvice,
    AquaculturePond,
    Company,
    JournalEntry,
)


def _enable(c: Company) -> None:
    Company.objects.filter(pk=c.id).update(aquaculture_enabled=True, aquaculture_licensed=True)


@pytest.mark.django_db
def test_consumption_ledger_lists_feed_and_medicine(api_client, company_tenant, auth_admin_headers):
    _enable(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="P1", is_active=True)

    feed_exp = AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_category="feed_consumed",
        expense_date=date(2026, 5, 4),
        amount=Decimal("1200.50"),
        feed_weight_kg=Decimal("25.0000"),
        feed_sack_count=Decimal("1.0000"),
        memo="Pond warehouse feed consumed",
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_category="medicine_consumed",
        expense_date=date(2026, 5, 6),
        amount=Decimal("300.00"),
        memo="Treatment dose",
    )

    JournalEntry.objects.create(
        company_id=cid,
        entry_number=f"AUTO-AQ-POND-{feed_exp.id}-COGS",
        entry_date=date(2026, 5, 4),
        description="cogs",
        is_posted=True,
    )

    r = api_client.get("/api/aquaculture/pond-warehouse-consumption-ledger/", **auth_admin_headers)
    assert r.status_code == 200, r.content.decode()
    body = json.loads(r.content.decode())
    rows = body["rows"]
    kinds = {row["kind"] for row in rows}
    assert kinds == {"feed", "medicine"}

    feed_row = next(r for r in rows if r["kind"] == "feed")
    assert feed_row["pond_id"] == pond.id
    assert feed_row["amount"] == "1200.50"
    assert feed_row["feed_weight_kg"] == "25.0000"
    assert feed_row["journal_entry_number"].startswith("AUTO-AQ-POND-")
    assert feed_row["journal_is_posted"] is True
    assert feed_row["source"] == "manual_consume"


@pytest.mark.django_db
def test_consumption_ledger_links_feeding_advice(api_client, company_tenant, auth_admin_headers):
    _enable(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="P2", is_active=True)
    exp = AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_category="feed_consumed",
        expense_date=date(2026, 5, 7),
        amount=Decimal("500.00"),
        feed_weight_kg=Decimal("10.0000"),
        memo="advice apply",
    )
    advice = AquacultureFeedingAdvice.objects.create(
        company_id=cid,
        pond=pond,
        target_date=date(2026, 5, 7),
        status=AquacultureFeedingAdvice.STATUS_APPLIED,
        ai_advice_text="feed 10kg",
        suggested_feed_kg=Decimal("10.0000"),
        applied_feed_kg=Decimal("10.0000"),
        linked_expense=exp,
    )

    r = api_client.get(
        f"/api/aquaculture/pond-warehouse-consumption-ledger/?pond_id={pond.id}",
        **auth_admin_headers,
    )
    body = json.loads(r.content.decode())
    rows = body["rows"]
    assert len(rows) == 1
    assert rows[0]["source"] == "feeding_advice"
    assert rows[0]["feeding_advice_id"] == advice.id
    assert rows[0]["feeding_advice_target_date"] == "2026-05-07"


@pytest.mark.django_db
def test_consumption_ledger_kind_filter(api_client, company_tenant, auth_admin_headers):
    _enable(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="P3", is_active=True)
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_category="feed_consumed",
        expense_date=date(2026, 5, 1),
        amount=Decimal("100"),
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_category="medicine_consumed",
        expense_date=date(2026, 5, 2),
        amount=Decimal("50"),
    )

    r = api_client.get(
        "/api/aquaculture/pond-warehouse-consumption-ledger/?kind=medicine",
        **auth_admin_headers,
    )
    body = json.loads(r.content.decode())
    assert {row["kind"] for row in body["rows"]} == {"medicine"}

    r = api_client.get(
        "/api/aquaculture/pond-warehouse-consumption-ledger/?kind=garbage",
        **auth_admin_headers,
    )
    assert r.status_code == 400
