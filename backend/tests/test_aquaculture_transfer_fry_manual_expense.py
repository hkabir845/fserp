"""Manual fry expense capitalizes Dr 1581 so fingerling transfer GL can move fry cost."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from django.db.models import Sum

from api.models import (
    AquacultureExpense,
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquacultureFishStockLedger,
    AquaculturePond,
    ChartOfAccount,
    JournalEntry,
    JournalEntryLine,
)
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
from api.services.aquaculture_fish_transfer_gl_service import sync_aquaculture_fish_pond_transfer_gl
from api.services.gl_posting import post_aquaculture_manual_expense_journal
from tests.conftest import seed_min_gl_accounts
from tests.test_aquaculture_fish_bioasset_gl import _enable_aquaculture_with_coa


@pytest.mark.django_db
def test_manual_fry_expense_posts_dr_1581(company_tenant):
    _enable_aquaculture_with_coa(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(
        company_id=cid, name="Nursing Manual Fry", pond_role="nursing", is_active=True
    )
    cash = ChartOfAccount.objects.filter(company_id=cid, account_code="1010").first()
    if not cash:
        cash = ChartOfAccount.objects.create(
            company_id=cid,
            account_code="1010",
            account_name="Cash",
            account_type="asset",
            is_active=True,
        )
    exp = AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_category="fry_stocking",
        expense_date=date(2026, 4, 1),
        amount=Decimal("350000.00"),
        funding_account_code="1010",
    )
    assert post_aquaculture_manual_expense_journal(cid, exp.id, exp.expense_date) is True

    je = JournalEntry.objects.get(company_id=cid, entry_number=f"AUTO-AQ-EXP-{exp.id}")
    dr = JournalEntryLine.objects.filter(
        journal_entry=je, account__account_code="1581", debit__gt=0
    ).aggregate(t=Sum("debit"))["t"]
    assert dr == Decimal("350000.00")


@pytest.mark.django_db
def test_manual_fry_1581_moves_on_fingerling_transfer_gl(company_tenant, monkeypatch):
    _enable_aquaculture_with_coa(company_tenant)
    cid = company_tenant.id
    src = AquaculturePond.objects.create(
        company_id=cid, name="Nursing Fry GL", pond_role="nursing", is_active=True
    )
    dst = AquaculturePond.objects.create(company_id=cid, name="Grow Fry GL", is_active=True)
    cash = ChartOfAccount.objects.filter(company_id=cid, account_code="1010").first()
    if not cash:
        ChartOfAccount.objects.create(
            company_id=cid,
            account_code="1010",
            account_name="Cash",
            account_type="asset",
            is_active=True,
        )
    exp = AquacultureExpense.objects.create(
        company_id=cid,
        pond=src,
        expense_category="fry_stocking",
        expense_date=date(2026, 4, 1),
        amount=Decimal("350000.00"),
        funding_account_code="1010",
    )
    assert post_aquaculture_manual_expense_journal(cid, exp.id, exp.expense_date) is True

    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=src,
        entry_date=date(2026, 4, 1),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=500000,
        weight_kg_delta=Decimal("250"),
        memo="Opening stock for manual fry transfer test",
    )

    monkeypatch.setattr(
        "api.services.aquaculture_transfer_cost._nursing_stocked_heads_basis",
        lambda **kwargs: 500000,
    )

    tr = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=src,
        transfer_date=date(2026, 5, 17),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=tr,
        to_pond=dst,
        weight_kg=Decimal("100"),
        fish_count=250000,
        cost_amount=Decimal("175000.00"),
    )

    result = sync_aquaculture_fish_pond_transfer_gl(cid, tr)
    assert result["posted"] is True, result
    assert Decimal(result["total_gl_amount"]) == Decimal("175000.00")

    je = JournalEntry.objects.get(company_id=cid, entry_number=f"AUTO-AQ-FISH-XFER-{tr.id}")
    cr_src = JournalEntryLine.objects.filter(
        journal_entry=je,
        account__account_code="1581",
        aquaculture_pond_id=src.id,
        credit__gt=0,
    ).aggregate(t=Sum("credit"))["t"]
    assert cr_src == Decimal("175000.00")
