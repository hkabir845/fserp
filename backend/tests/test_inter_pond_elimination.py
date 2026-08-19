"""
Consolidation elimination for inter-pond fish trade.

One pond selling fish to another is real for each pond and unreal for the company: nothing left
the business. Consolidated revenue must therefore exclude it, and the profit the selling pond
booked is still sitting unsold inside the buying pond's fish, so it has to come out of biological
inventory too. Get only half of that right and the balance sheet stops balancing.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquaculturePond,
    ChartOfAccount,
    Company,
    JournalEntry,
    JournalEntryLine,
)
from api.services.reporting import report_balance_sheet, report_income_statement

PERIOD_START = date(2026, 1, 1)
PERIOD_END = date(2026, 12, 31)
CENT = 0.02

SALE_PRICE = Decimal("50000.00")
SELLER_COST = Decimal("30000.00")
MARGIN = SALE_PRICE - SELLER_COST  # 20,000 unrealized until the buyer sells outside


@pytest.fixture
def traded(company_tenant):
    """Two ponds, one having sold fish to the other at market rate."""
    from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
    from tests.conftest import seed_min_gl_accounts

    cid = company_tenant.id
    seed_min_gl_accounts(company_tenant)
    Company.objects.filter(pk=cid).update(aquaculture_enabled=True, aquaculture_licensed=True)
    ensure_aquaculture_chart_accounts(cid)

    seller = AquaculturePond.objects.create(
        company_id=cid, name="Seller Pond", pond_role="nursing", is_active=True
    )
    buyer = AquaculturePond.objects.create(
        company_id=cid, name="Buyer Pond", pond_role="grow_out", is_active=True
    )

    def acc(code):
        return ChartOfAccount.objects.get(company_id=cid, account_code=code)

    # Seller side: revenue 4245 against the inter-pond current account 1595.
    je_sell = JournalEntry.objects.create(
        company_id=cid,
        entry_number="TEST-AQ-INTERNAL-SELL",
        entry_date=date(2026, 5, 1),
        description="Inter-pond sale (seller)",
        is_posted=True,
    )
    JournalEntryLine.objects.create(
        journal_entry=je_sell, account=acc("1595"), debit=SALE_PRICE, credit=Decimal("0"),
        aquaculture_pond_id=seller.id,
    )
    JournalEntryLine.objects.create(
        journal_entry=je_sell, account=acc("4245"), debit=Decimal("0"), credit=SALE_PRICE,
        aquaculture_pond_id=seller.id,
    )
    # Seller relieves its own biological cost to internal cost of sales.
    je_cost = JournalEntry.objects.create(
        company_id=cid,
        entry_number="TEST-AQ-INTERNAL-COST",
        entry_date=date(2026, 5, 1),
        description="Inter-pond sale (seller cost)",
        is_posted=True,
    )
    JournalEntryLine.objects.create(
        journal_entry=je_cost, account=acc("5245"), debit=SELLER_COST, credit=Decimal("0"),
        aquaculture_pond_id=seller.id,
    )
    JournalEntryLine.objects.create(
        journal_entry=je_cost, account=acc("1581"), debit=Decimal("0"), credit=SELLER_COST,
        aquaculture_pond_id=seller.id,
    )
    # Buyer capitalizes what it paid - including the seller's margin.
    je_buy = JournalEntry.objects.create(
        company_id=cid,
        entry_number="TEST-AQ-INTERNAL-BUY",
        entry_date=date(2026, 5, 1),
        description="Inter-pond purchase (buyer)",
        is_posted=True,
    )
    JournalEntryLine.objects.create(
        journal_entry=je_buy, account=acc("1581"), debit=SALE_PRICE, credit=Decimal("0"),
        aquaculture_pond_id=buyer.id,
    )
    JournalEntryLine.objects.create(
        journal_entry=je_buy, account=acc("1595"), debit=Decimal("0"), credit=SALE_PRICE,
        aquaculture_pond_id=buyer.id,
    )
    return {"cid": cid, "seller": seller, "buyer": buyer}


@pytest.mark.django_db
def test_company_revenue_excludes_the_inter_pond_sale(traded):
    inc = report_income_statement(traded["cid"], PERIOD_START, PERIOD_END)
    assert inc["income"]["total"] == 0.0, (
        "an internal transfer was counted as company revenue"
    )
    assert inc["cost_of_goods_sold"]["total"] == 0.0
    codes = {a["account_code"] for a in inc["income"]["accounts"]}
    assert "4245" not in codes


@pytest.mark.django_db
def test_the_eliminated_amounts_are_disclosed_not_hidden(traded):
    """Removing internal trade silently would be as misleading as leaving it in."""
    block = report_income_statement(traded["cid"], PERIOD_START, PERIOD_END)["internal_eliminations"]
    assert block["applied"] is True
    assert block["internal_revenue"] == float(SALE_PRICE)
    assert block["internal_cost_of_sales"] == float(SELLER_COST)
    assert block["unrealized_margin"] == float(MARGIN)
    assert {a["account_code"] for a in block["accounts"]} == {"4245", "5245"}


@pytest.mark.django_db
def test_company_profit_is_not_inflated_by_unsold_internal_margin(traded):
    """The whole point: the group has not earned 20,000 by moving fish between its own ponds."""
    inc = report_income_statement(traded["cid"], PERIOD_START, PERIOD_END)
    assert inc["net_income"] == 0.0, (
        f"company profit reads {inc['net_income']} on an internal transfer"
    )


@pytest.mark.django_db
def test_biological_inventory_is_written_down_by_the_unrealized_margin(traded):
    bs = report_balance_sheet(traded["cid"], PERIOD_START, PERIOD_END)
    contra = [a for a in bs["assets"]["accounts"] if a["account_code"] == "1585"]
    assert contra, "no unrealized-margin contra on the balance sheet"
    assert contra[0]["balance"] == -float(MARGIN)


@pytest.mark.django_db
def test_the_balance_sheet_still_balances_after_elimination(traded):
    """Eliminating profit without writing down the asset would break the accounting equation."""
    bs = report_balance_sheet(traded["cid"], PERIOD_START, PERIOD_END)
    assert bs["auto_plug_amount"] == 0, (
        f"elimination left the sheet needing a plug of {bs['auto_plug_amount']}"
    )
    assert bs["is_balanced"] is True
    assets = bs["assets"]["total"]
    assert abs(assets - (bs["liabilities"]["total"] + bs["equity"]["total"])) <= CENT


@pytest.mark.django_db
def test_balance_sheet_and_income_statement_still_agree(traded):
    cid = traded["cid"]
    bs = report_balance_sheet(cid, PERIOD_START, PERIOD_END)
    inc = report_income_statement(cid, PERIOD_START, PERIOD_END)
    assert abs(bs["net_income_cumulative"] - inc["net_income"]) <= CENT


@pytest.mark.django_db
def test_each_pond_still_sees_its_own_side_of_the_trade(traded):
    """
    Elimination is a consolidation view. A pond is run as a profit centre, so the selling pond
    must still show the revenue it earned - otherwise pond P&L becomes useless.
    """
    cid = traded["cid"]
    seller_pl = report_income_statement(cid, PERIOD_START, PERIOD_END, pond_id=traded["seller"].id)
    assert seller_pl["income"]["total"] == float(SALE_PRICE), "the selling pond lost its revenue"
    assert seller_pl["cost_of_goods_sold"]["total"] == float(SELLER_COST)
    assert seller_pl["net_income"] == float(MARGIN)
    assert seller_pl["internal_eliminations"]["applied"] is False

    buyer_pl = report_income_statement(cid, PERIOD_START, PERIOD_END, pond_id=traded["buyer"].id)
    assert buyer_pl["income"]["total"] == 0.0, "the buying pond has not sold anything yet"


@pytest.mark.django_db
def test_a_company_with_no_inter_pond_trade_is_untouched(company_tenant):
    """The elimination must be inert for the ordinary case."""
    from tests.conftest import seed_min_gl_accounts

    seed_min_gl_accounts(company_tenant)
    cid = company_tenant.id
    inc = report_income_statement(cid, PERIOD_START, PERIOD_END)
    assert inc["internal_eliminations"]["applied"] is False
    bs = report_balance_sheet(cid, PERIOD_START, PERIOD_END)
    assert not [a for a in bs["assets"]["accounts"] if a["account_code"] == "1585"]
    assert bs["auto_plug_amount"] == 0
