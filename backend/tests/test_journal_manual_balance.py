"""Manual journal entry posting must enforce double-entry balance."""
from __future__ import annotations

import json
from decimal import Decimal

import pytest


@pytest.mark.django_db
def test_journal_post_rejects_unbalanced(api_client, company_tenant, auth_admin_headers):
    from api.models import ChartOfAccount, JournalEntry, JournalEntryLine

    cash = ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code="1010",
        account_name="Cash",
        account_type="asset",
        is_active=True,
    )
    je = JournalEntry.objects.create(
        company_id=company_tenant.id,
        entry_number="JE-TEST-UNBAL",
        entry_date="2026-04-01",
        description="unbalanced",
        is_posted=False,
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=cash, debit=Decimal("100.00"), credit=Decimal("0")
    )
    # Missing credit line — unbalanced

    r = api_client.post(
        f"/api/journal-entries/{je.id}/post/",
        data=json.dumps({}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400
    body = json.loads(r.content.decode())
    assert body.get("code") == "journal_not_balanced"
    assert "debits" in (body.get("detail") or "").lower()

    je.refresh_from_db()
    assert je.is_posted is False


@pytest.mark.django_db
def test_journal_post_accepts_balanced(api_client, company_tenant, auth_admin_headers):
    from api.models import ChartOfAccount, JournalEntry, JournalEntryLine

    cash = ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code="1010",
        account_name="Cash",
        account_type="asset",
        is_active=True,
    )
    equity = ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code="3000",
        account_name="Equity",
        account_type="equity",
        is_active=True,
    )

    je = JournalEntry.objects.create(
        company_id=company_tenant.id,
        entry_number="JE-TEST-BAL",
        entry_date="2026-04-01",
        description="balanced",
        is_posted=False,
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=cash, debit=Decimal("250.00"), credit=Decimal("0")
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=equity, debit=Decimal("0"), credit=Decimal("250.00")
    )

    r = api_client.post(
        f"/api/journal-entries/{je.id}/post/",
        data=json.dumps({}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    body = json.loads(r.content.decode())
    assert body.get("is_posted") is True


@pytest.mark.django_db
def test_journal_api_create_balanced_then_post(api_client, company_tenant, auth_admin_headers):
    """Full UI-shaped payload: one row with debit + credit accounts equal amount."""
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
        account_code="3000",
        account_name="Owner Equity",
        account_type="equity",
        is_active=True,
    )

    create_body = {
        "entry_date": "2026-04-15",
        "description": "Owner contribution (dev test)",
        "lines": [
            {
                "debit_account_id": cash.id,
                "credit_account_id": equity.id,
                "amount": "1000.00",
                "description": "Cash invested",
            }
        ],
    }
    r = api_client.post(
        "/api/journal-entries/",
        data=json.dumps(create_body),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    entry = json.loads(r.content.decode())
    assert entry["total_debit"] == entry["total_credit"] == "1000.00"
    assert entry["is_posted"] is False

    rid = entry["id"]
    r2 = api_client.post(
        f"/api/journal-entries/{rid}/post/",
        data=json.dumps({}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r2.status_code == 200, r2.content.decode()
    posted = json.loads(r2.content.decode())
    assert posted["is_posted"] is True


@pytest.mark.django_db
def test_journal_api_create_debit_only_then_post_rejected(
    api_client, company_tenant, auth_admin_headers
):
    """Single-sided API row stays unbalanced until user fixes lines."""
    from api.models import ChartOfAccount

    cash = ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code="1010",
        account_name="Cash",
        account_type="asset",
        is_active=True,
    )

    create_body = {
        "entry_date": "2026-04-15",
        "description": "Incomplete draft",
        "lines": [
            {
                "debit_account_id": cash.id,
                "credit_account_id": None,
                "amount": "75.50",
            }
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
    assert entry["total_debit"] != entry["total_credit"]

    r2 = api_client.post(
        f"/api/journal-entries/{entry['id']}/post/",
        data=json.dumps({}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r2.status_code == 400
    assert json.loads(r2.content.decode()).get("code") == "journal_not_balanced"
