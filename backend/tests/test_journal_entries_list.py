"""Journal entries list: pagination, date, and amount filters."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest


@pytest.mark.django_db
def test_journal_entries_paged_list_and_filters(api_client, company_tenant, auth_admin_headers):
    from api.models import ChartOfAccount, JournalEntry, JournalEntryLine

    cash = ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code="1010",
        account_name="Cash",
        account_type="asset",
        is_active=True,
    )
    expense = ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code="5010",
        account_name="Expense",
        account_type="expense",
        is_active=True,
    )

    def _make(entry_number: str, entry_date: date, amount: str):
        je = JournalEntry.objects.create(
            company_id=company_tenant.id,
            entry_number=entry_number,
            entry_date=entry_date,
            description=f"Entry {entry_number}",
            is_posted=True,
        )
        JournalEntryLine.objects.create(
            journal_entry=je, account=cash, debit=Decimal(amount), credit=Decimal("0")
        )
        JournalEntryLine.objects.create(
            journal_entry=je, account=expense, debit=Decimal("0"), credit=Decimal(amount)
        )
        return je

    _make("JE-OLD", date(2024, 1, 15), "100.00")
    _make("JE-NEW", date(2026, 6, 1), "500.00")
    _make("JE-MID", date(2025, 3, 10), "250.00")

    r = api_client.get(
        "/api/journal-entries/?paged=1&skip=0&limit=2",
        **auth_admin_headers,
    )
    assert r.status_code == 200
    body = json.loads(r.content.decode())
    assert body["count"] == 3
    assert len(body["results"]) == 2
    assert body["results"][0]["entry_number"] == "JE-NEW"

    r2 = api_client.get(
        "/api/journal-entries/?paged=1&start_date=2025-01-01&end_date=2025-12-31",
        **auth_admin_headers,
    )
    assert r2.status_code == 200
    body2 = json.loads(r2.content.decode())
    assert body2["count"] == 1
    assert body2["results"][0]["entry_number"] == "JE-MID"

    r3 = api_client.get(
        "/api/journal-entries/?paged=1&min_amount=200&max_amount=300",
        **auth_admin_headers,
    )
    assert r3.status_code == 200
    body3 = json.loads(r3.content.decode())
    assert body3["count"] == 1
    assert body3["results"][0]["entry_number"] == "JE-MID"


@pytest.mark.django_db
def test_journal_create_accepts_backdated_entry_date(api_client, company_tenant, auth_admin_headers):
    from api.models import ChartOfAccount

    cash = ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code="1010",
        account_name="Cash",
        account_type="asset",
        is_active=True,
    )
    equity = ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code="3010",
        account_name="Equity",
        account_type="equity",
        is_active=True,
    )

    create_body = {
        "entry_date": "2020-05-01",
        "description": "Back-dated opening adjustment",
        "lines": [
            {"debit_account_id": cash.id, "credit_account_id": None, "amount": "1000.00"},
            {"debit_account_id": None, "credit_account_id": equity.id, "amount": "1000.00"},
        ],
    }
    r = api_client.post(
        "/api/journal-entries/",
        data=json.dumps(create_body),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201
    entry = json.loads(r.content.decode())
    assert entry["entry_date"] == "2020-05-01"


@pytest.mark.django_db
def test_journal_search_ignores_date_range(api_client, company_tenant, auth_admin_headers):
    from api.models import ChartOfAccount, JournalEntry, JournalEntryLine

    cash = ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code="1010",
        account_name="Cash",
        account_type="asset",
        is_active=True,
    )
    expense = ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code="5010",
        account_name="Expense",
        account_type="expense",
        is_active=True,
    )

    def _make(entry_number: str, entry_date: date, description: str):
        je = JournalEntry.objects.create(
            company_id=company_tenant.id,
            entry_number=entry_number,
            entry_date=entry_date,
            description=description,
            is_posted=True,
        )
        JournalEntryLine.objects.create(
            journal_entry=je, account=cash, debit=Decimal("100"), credit=Decimal("0")
        )
        JournalEntryLine.objects.create(
            journal_entry=je, account=expense, debit=Decimal("0"), credit=Decimal("100")
        )

    _make("JE-2024-LEGACY", date(2024, 2, 1), "Legacy rent payment")
    _make("JE-2026-RECENT", date(2026, 6, 1), "Recent utilities")

    # Date range alone would exclude the legacy entry.
    r_date_only = api_client.get(
        "/api/journal-entries/?paged=1&start_date=2026-01-01&end_date=2026-12-31",
        **auth_admin_headers,
    )
    assert json.loads(r_date_only.content.decode())["count"] == 1

    # Search finds legacy entry even with a narrow date range in the query string.
    r_search = api_client.get(
        "/api/journal-entries/?paged=1&q=Legacy&start_date=2026-01-01&end_date=2026-12-31",
        **auth_admin_headers,
    )
    body = json.loads(r_search.content.decode())
    assert body["count"] == 1
    assert body["results"][0]["entry_number"] == "JE-2024-LEGACY"
