"""Manual journal entry site tagging: clear entry and line stations on update."""
from __future__ import annotations

import json
from decimal import Decimal

import pytest


@pytest.mark.django_db
def test_journal_entry_update_clears_entry_and_line_stations(
    api_client, company_tenant, auth_admin_headers
):
    from api.models import ChartOfAccount, JournalEntry, JournalEntryLine, Station

    st = Station.objects.create(
        company_id=company_tenant.id,
        station_name="Premium Agro",
        is_active=True,
    )
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
        entry_number="JE-SITE-CLR",
        entry_date="2026-05-01",
        description="tagged",
        station_id=st.id,
        is_posted=False,
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=cash,
        debit=Decimal("100.00"),
        credit=Decimal("0"),
        station_id=st.id,
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=equity,
        debit=Decimal("0"),
        credit=Decimal("100.00"),
        station_id=st.id,
    )

    r = api_client.put(
        f"/api/journal-entries/{je.id}/",
        data=json.dumps(
            {
                "entry_date": "2026-05-01",
                "description": "untagged",
                "station_id": None,
                "lines": [
                    {
                        "debit_account_id": cash.id,
                        "credit_account_id": None,
                        "amount": "100.00",
                        "station_id": None,
                    },
                    {
                        "debit_account_id": None,
                        "credit_account_id": equity.id,
                        "amount": "100.00",
                        "station_id": None,
                    },
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    body = json.loads(r.content.decode())
    assert body.get("station_id") is None
    assert not (body.get("station_name") or "").strip()
    for line in body.get("lines") or []:
        assert line.get("station_id") is None
        assert not (line.get("station_name") or "").strip()

    je.refresh_from_db()
    assert je.station_id is None
    assert set(je.lines.values_list("station_id", flat=True)) == {None}
