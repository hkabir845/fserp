"""Per-pond P&L summary from posted GL (ponds-pl-summary report)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from django.utils import timezone

from api.models import AquaculturePond, ChartOfAccount, JournalEntry, JournalEntryLine
from api.services.reporting import report_entities_pl_summary, report_ponds_pl_summary

pytestmark = pytest.mark.django_db


def test_ponds_pl_summary_lists_each_pond(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    p1 = AquaculturePond.objects.create(company_id=cid, name="Pond Alpha", is_active=True)
    p2 = AquaculturePond.objects.create(company_id=cid, name="Pond Beta", is_active=True)
    income = ChartOfAccount.objects.get(company_id=cid, account_code="4200")
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")

    def post_pond_income(pond_id: int, amount: str):
        je = JournalEntry.objects.create(
            company_id=cid,
            entry_number=f"POND-PL-{pond_id}-{amount}",
            entry_date=date(2026, 9, 10),
            is_posted=True,
            posted_at=timezone.now(),
        )
        JournalEntryLine.objects.create(
            journal_entry=je,
            account=income,
            aquaculture_pond_id=pond_id,
            debit=Decimal("0"),
            credit=Decimal(amount),
        )
        JournalEntryLine.objects.create(
            journal_entry=je,
            account=cash,
            aquaculture_pond_id=pond_id,
            debit=Decimal(amount),
            credit=Decimal("0"),
        )

    post_pond_income(p1.id, "80")
    post_pond_income(p2.id, "40")

    start, end = date(2026, 9, 1), date(2026, 9, 30)
    out = report_ponds_pl_summary(cid, start, end)
    assert out["report_id"] == "ponds-pl-summary"
    by_id = {r["pond_id"]: r for r in out["ponds"]}
    assert Decimal(str(by_id[p1.id]["income"])) == Decimal("80.00")
    assert Decimal(str(by_id[p2.id]["income"])) == Decimal("40.00")
    assert Decimal(str(by_id[p1.id]["net_income"])) == Decimal("80.00")

    full = report_entities_pl_summary(cid, start, end)
    assert len(full["by_pond"]) == len(out["ponds"])
