"""When aquaculture_capitalize_pond_consumption_to_bioasset is on, pond feed consume Dr 1581."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import AquaculturePond, ChartOfAccount, Company, Item, JournalEntryLine
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
from api.services.aquaculture_pond_stock_service import add_pond_stock, consume_pond_warehouse_stock

from tests.conftest import seed_min_gl_accounts

pytestmark = pytest.mark.django_db


def _enable(company):
    Company.objects.filter(pk=company.id).update(
        aquaculture_enabled=True,
        aquaculture_licensed=True,
        aquaculture_capitalize_pond_consumption_to_bioasset=True,
    )
    seed_min_gl_accounts(company)
    ensure_aquaculture_chart_accounts(company.id)


@pytest.mark.django_db
def test_feed_consumption_capitalizes_to_1581_when_flag_on(company_tenant):
    _enable(company_tenant)
    cid = company_tenant.id
    inv_acc = ChartOfAccount.objects.filter(
        company_id=cid, account_type="asset", is_active=True
    ).exclude(account_code="1581").first()
    cogs_acc = ChartOfAccount.objects.filter(
        company_id=cid, account_type="cost_of_goods_sold", is_active=True
    ).first()
    bio = ChartOfAccount.objects.get(company_id=cid, account_code="1581")
    assert inv_acc is not None and cogs_acc is not None

    pond = AquaculturePond.objects.create(company_id=cid, name="Grow-1", is_active=True)
    item = Item.objects.create(
        company_id=cid,
        name="Feed pellet",
        item_number="FEED-CAP",
        unit="kg",
        item_type="inventory",
        pos_category="feed",
        quantity_on_hand=Decimal("100"),
        cost=Decimal("50"),
        inventory_account=inv_acc,
        cogs_account=cogs_acc,
    )
    add_pond_stock(cid, pond.id, item.id, Decimal("10"))
    exp = consume_pond_warehouse_stock(
        company_id=cid,
        pond=pond,
        production_cycle_id=None,
        expense_category="feed_consumed",
        expense_date=date(2026, 6, 1),
        item=item,
        quantity=Decimal("2"),
        memo="capitalize test",
    )

    je_lines = JournalEntryLine.objects.filter(
        journal_entry__company_id=cid,
        journal_entry__entry_number=f"AUTO-AQ-POND-{exp.id}-COGS",
    )
    assert je_lines.filter(account=bio, debit__gt=0).exists()
    assert not je_lines.filter(account=cogs_acc, debit__gt=0).exists()
    assert je_lines.filter(account=inv_acc, credit__gt=0).exists()
