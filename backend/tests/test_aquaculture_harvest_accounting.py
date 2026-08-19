"""
The harvest side of aquaculture: turning a pond full of fish into revenue and cost.

This is the step that decides whether pond profit is right. Everything a pond consumes is
capitalized into 1581 Biological Inventory; only at harvest does that accumulated cost leave the
balance sheet and become an expense. If it leaves to the wrong account, or does not leave at all,
the P&L is wrong even though the ledger still balances.
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureFishSale,
    AquaculturePond,
    ChartOfAccount,
    Company,
    Invoice,
    JournalEntry,
    JournalEntryLine,
    Vendor,
)
from api.services.reporting import (
    report_balance_sheet,
    report_income_statement,
    report_trial_balance,
)
from api.utils.rounding import money

PERIOD_START = date(2026, 1, 1)
PERIOD_END = date(2026, 12, 31)
CENT = 0.02


def gl_balance(cid: int, code: str) -> Decimal:
    total = Decimal("0")
    for ln in JournalEntryLine.objects.filter(
        journal_entry__company_id=cid,
        journal_entry__is_posted=True,
        account__account_code=code,
    ):
        total += (ln.debit or Decimal("0")) - (ln.credit or Decimal("0"))
    return money(total)


def assert_ledger_sound(cid: int) -> None:
    for je in JournalEntry.objects.filter(company_id=cid, is_posted=True).prefetch_related("lines"):
        lines = list(je.lines.all())
        debit = sum((ln.debit or Decimal("0")) for ln in lines)
        credit = sum((ln.credit or Decimal("0")) for ln in lines)
        assert debit == credit, f"{je.entry_number} out of balance: {debit} vs {credit}"


@pytest.fixture
def farm(api_client, auth_super_headers, company_master):
    """A grow-out pond that has absorbed real production cost into 1581."""
    from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
    from tests.test_api_production_audit import _audit_master_headers, _audit_seed_min_gl_accounts

    cid = company_master.id
    _audit_seed_min_gl_accounts(company_master)
    Company.objects.filter(pk=cid).update(aquaculture_enabled=True, aquaculture_licensed=True)
    ensure_aquaculture_chart_accounts(cid)
    h = _audit_master_headers(auth_super_headers, company_master)

    pond = AquaculturePond.objects.create(
        company_id=cid, name="Harvest Pond", pond_role="grow_out", is_active=True
    )
    vendor = Vendor.objects.create(company_id=cid, company_name="Harvest Inputs Ltd")

    # Feed and fry the pond so 1581 carries a real accumulated cost.
    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-01-15",
                "status": "open",
                "lines": [
                    {
                        "description": "Fingerlings",
                        "quantity": "1",
                        "unit_cost": "40000.00",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_expense_category": "fry_stocking",
                    },
                    {
                        "description": "Grow-out feed",
                        "quantity": "1",
                        "unit_cost": "60000.00",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_expense_category": "feed_purchase",
                    },
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    assert gl_balance(cid, "1581") == Decimal("100000.00"), "pond inputs did not capitalize"

    return {"cid": cid, "headers": h, "pond": pond}


def _make_sale(cid: int, pond, *, weight="500", amount="180000.00", income_type="fish_harvest_sale"):
    return AquacultureFishSale.objects.create(
        company_id=cid,
        pond=pond,
        income_type=income_type,
        fish_species="tilapia",
        sale_date=date(2026, 6, 30),
        weight_kg=Decimal(weight),
        fish_count=2500,
        total_amount=Decimal(amount),
        buyer_name="Kawran Bazar Arot",
    )


def _finalize(api_client, headers, sale_id, **body):
    payload = {"record_as": "cash_paid", **body}
    return api_client.post(
        f"/api/aquaculture/sales/{sale_id}/finalize/",
        data=json.dumps(payload),
        content_type="application/json",
        **headers,
    )


# ------------------------------------------------------------------ the chart


@pytest.mark.django_db
def test_a_harvest_cost_of_sales_account_exists(farm):
    """
    Revenue 4240 needs a cost account to sit against. Without 5240 the only account that could
    relieve 1581 was 6726 mortality, which is not what selling fish is.
    """
    acc = ChartOfAccount.objects.filter(company_id=farm["cid"], account_code="5240").first()
    assert acc is not None, "no cost of fish sold account was seeded"
    assert acc.account_type == "cost_of_goods_sold"


# ------------------------------------------------------------------ finalizing a harvest


@pytest.mark.django_db
def test_finalizing_a_harvest_books_revenue_and_relieves_biological_inventory(api_client, farm):
    cid, h, pond = farm["cid"], farm["headers"], farm["pond"]
    sale = _make_sale(cid, pond)

    r = _finalize(api_client, h, sale.id)
    assert r.status_code in (200, 201), r.content.decode()

    sale.refresh_from_db()
    assert sale.invoice_id is not None, "the harvest did not produce an invoice"

    inv = Invoice.objects.get(pk=sale.invoice_id)
    assert inv.total == Decimal("180000.00")

    # Revenue recognised on an aquaculture revenue account.
    assert -gl_balance(cid, "4240") == Decimal("180000.00"), "harvest revenue did not reach 4240"

    # Biological inventory relieved, and the cost landed in COGS - not in mortality.
    bio_je = JournalEntry.objects.filter(
        company_id=cid, entry_number=f"AUTO-AQ-SALE-{sale.id}-BIO"
    ).first()
    assert bio_je is not None, "no biological relief journal for the harvest"
    codes = {ln.account.account_code for ln in bio_je.lines.all()}
    assert codes == {"5240", "1581"}, f"harvest relief hit {codes}, expected 5240 / 1581"

    assert gl_balance(cid, "1581") < Decimal("100000.00"), "1581 was never relieved"
    assert gl_balance(cid, "5240") > 0, "cost of fish sold is zero after a harvest"
    assert gl_balance(cid, "6726") == Decimal("0.00"), (
        "a sale was booked as mortality - that inflates shrinkage and overstates gross profit"
    )
    assert_ledger_sound(cid)


@pytest.mark.django_db
def test_harvest_gross_profit_is_revenue_less_the_cost_of_the_fish(api_client, farm):
    """The whole point of relieving 1581 to COGS: a real gross margin on the P&L."""
    cid, h, pond = farm["cid"], farm["headers"], farm["pond"]
    sale = _make_sale(cid, pond)
    assert _finalize(api_client, h, sale.id).status_code in (200, 201)

    inc = report_income_statement(cid, PERIOD_START, PERIOD_END)
    income = inc["income"]["total"]
    cogs = inc["cost_of_goods_sold"]["total"]
    assert income == 180000.00
    assert cogs > 0, "harvest revenue with no cost of goods sold overstates gross profit"
    assert abs(inc["gross_profit"] - (income - cogs)) <= CENT
    assert inc["gross_profit"] < income, "gross profit should be below revenue once cost is booked"


@pytest.mark.django_db
def test_the_cost_of_fish_sold_lands_on_the_pond_that_grew_them(api_client, farm):
    """Pond P&L only works if the harvest cost carries the pond tag, like every other pond cost."""
    cid, h, pond = farm["cid"], farm["headers"], farm["pond"]
    sale = _make_sale(cid, pond)
    assert _finalize(api_client, h, sale.id).status_code in (200, 201)

    tagged = JournalEntryLine.objects.filter(
        journal_entry__company_id=cid,
        journal_entry__entry_number=f"AUTO-AQ-SALE-{sale.id}-BIO",
        account__account_code="5240",
        aquaculture_pond_id=pond.id,
        debit__gt=0,
    )
    assert tagged.exists(), "cost of fish sold has no pond tag"

    pond_pl = report_income_statement(cid, PERIOD_START, PERIOD_END, pond_id=pond.id)
    assert pond_pl["cost_of_goods_sold"]["total"] > 0, "the pond P&L shows no cost for its harvest"


@pytest.mark.django_db
def test_relief_never_exceeds_the_biological_inventory_on_hand(api_client, farm):
    """You cannot relieve more cost than the pond ever accumulated - 1581 must not go negative."""
    cid, h, pond = farm["cid"], farm["headers"], farm["pond"]
    # Sell far more weight than the pond's cost supports.
    sale = _make_sale(cid, pond, weight="100000", amount="500000.00")
    assert _finalize(api_client, h, sale.id).status_code in (200, 201)

    assert gl_balance(cid, "1581") >= Decimal("0.00"), (
        "biological inventory went negative: more cost was relieved than the pond ever held"
    )
    assert_ledger_sound(cid)


@pytest.mark.django_db
def test_finalizing_twice_does_not_double_count_the_harvest(api_client, farm):
    """A retried finalize must not book the revenue or the cost a second time."""
    cid, h, pond = farm["cid"], farm["headers"], farm["pond"]
    sale = _make_sale(cid, pond)

    first = _finalize(api_client, h, sale.id)
    assert first.status_code in (200, 201), first.content.decode()
    rev_once = gl_balance(cid, "4240")
    cogs_once = gl_balance(cid, "5240")
    bio_once = gl_balance(cid, "1581")

    second = _finalize(api_client, h, sale.id)
    assert second.status_code in (200, 201), second.content.decode()

    assert gl_balance(cid, "4240") == rev_once, "revenue booked twice"
    assert gl_balance(cid, "5240") == cogs_once, "cost of fish sold booked twice"
    assert gl_balance(cid, "1581") == bio_once, "biological inventory relieved twice"
    assert Invoice.objects.filter(company_id=cid, invoice_number=f"INV-AQ-{sale.id}").count() == 1
    assert_ledger_sound(cid)


@pytest.mark.django_db
def test_a_non_biological_sale_books_revenue_without_touching_the_fish(api_client, farm):
    """Selling empty sacks is income, but it does not consume any biological inventory."""
    cid, h, pond = farm["cid"], farm["headers"], farm["pond"]
    bio_before = gl_balance(cid, "1581")
    sale = _make_sale(cid, pond, amount="2500.00", income_type="empty_feed_sack_sale")

    r = _finalize(api_client, h, sale.id)
    assert r.status_code in (200, 201), r.content.decode()

    assert gl_balance(cid, "1581") == bio_before, "a scrap sale relieved biological inventory"
    assert gl_balance(cid, "5240") == Decimal("0.00"), "a scrap sale booked cost of fish sold"
    assert_ledger_sound(cid)


@pytest.mark.django_db
def test_harvest_leaves_the_statements_balanced(api_client, farm):
    cid, h, pond = farm["cid"], farm["headers"], farm["pond"]
    sale = _make_sale(cid, pond)
    assert _finalize(api_client, h, sale.id).status_code in (200, 201)

    tb = report_trial_balance(cid, PERIOD_START, PERIOD_END)
    assert tb["debits_equal_credits"] is True
    bs = report_balance_sheet(cid, PERIOD_START, PERIOD_END)
    assert bs["auto_plug_amount"] == 0, f"balance sheet needed a plug of {bs['auto_plug_amount']}"

    inc = report_income_statement(cid, PERIOD_START, PERIOD_END)
    assert abs(bs["net_income_cumulative"] - inc["net_income"]) <= CENT


@pytest.mark.django_db
def test_on_account_harvest_goes_to_receivables_not_cash(api_client, farm):
    """A credit harvest sale must sit in A/R against a named buyer."""
    from api.models import Customer

    cid, h, pond = farm["cid"], farm["headers"], farm["pond"]
    buyer = Customer.objects.create(
        company_id=cid, display_name="Arot Buyer", customer_number="C-AROT", is_active=True
    )
    sale = _make_sale(cid, pond)

    r = _finalize(api_client, h, sale.id, record_as="on_account", customer_id=buyer.id)
    assert r.status_code in (200, 201), r.content.decode()

    assert gl_balance(cid, "1100") == Decimal("180000.00"), "credit harvest did not raise A/R"
    buyer.refresh_from_db()
    assert buyer.current_balance == Decimal("180000.00"), "the buyer's subledger was not charged"
    assert_ledger_sound(cid)


@pytest.mark.django_db
def test_on_account_harvest_refuses_the_walk_in_customer(api_client, farm):
    """Walk-in has no A/R subledger, so a credit harvest against it would strand the receivable."""
    from api.models import Customer

    cid, h, pond = farm["cid"], farm["headers"], farm["pond"]
    walk = Customer.objects.create(
        company_id=cid, display_name="Walk-in", customer_number="WALK-AQ", is_active=True
    )
    sale = _make_sale(cid, pond)

    r = _finalize(api_client, h, sale.id, record_as="on_account", customer_id=walk.id)
    assert r.status_code == 400
    assert "walk-in" in json.loads(r.content.decode()).get("detail", "").lower()


# ------------------------------------------------------------------ undoing a harvest


@pytest.mark.django_db
def test_deleting_a_finalized_harvest_returns_the_books_to_where_they_were(api_client, farm):
    """Reversing a sale must give the fish back to 1581 and take the revenue off the P&L."""
    cid, h, pond = farm["cid"], farm["headers"], farm["pond"]
    bio_before = gl_balance(cid, "1581")
    rev_before = gl_balance(cid, "4240")
    cogs_before = gl_balance(cid, "5240")

    sale = _make_sale(cid, pond)
    assert _finalize(api_client, h, sale.id).status_code in (200, 201)
    assert gl_balance(cid, "1581") < bio_before

    r = api_client.delete(f"/api/aquaculture/sales/{sale.id}/", **h)
    assert r.status_code in (200, 204), r.content.decode()

    assert gl_balance(cid, "1581") == bio_before, "the fish were not returned to inventory"
    assert gl_balance(cid, "4240") == rev_before, "harvest revenue survived the reversal"
    assert gl_balance(cid, "5240") == cogs_before, "cost of fish sold survived the reversal"
    assert not JournalEntry.objects.filter(
        company_id=cid, entry_number=f"AUTO-AQ-SALE-{sale.id}-BIO"
    ).exists()
    assert not Invoice.objects.filter(company_id=cid, invoice_number=f"INV-AQ-{sale.id}").exists()
    assert_ledger_sound(cid)


@pytest.mark.django_db
def test_repair_moves_a_legacy_harvest_out_of_the_mortality_account(api_client, farm):
    """
    Harvests booked before 5240 existed sit in 6726, so the P&L reads as if the fish died rather
    than sold. Re-syncing the sale must move that cost into cost of goods sold.
    """
    from api.services.aquaculture_sale_bio_relief_service import (
        sync_aquaculture_fish_sale_bio_relief,
    )

    cid, h, pond = farm["cid"], farm["headers"], farm["pond"]
    sale = _make_sale(cid, pond)
    assert _finalize(api_client, h, sale.id).status_code in (200, 201)

    # Recreate the legacy shape: the same relief sitting on the mortality line.
    je = JournalEntry.objects.get(company_id=cid, entry_number=f"AUTO-AQ-SALE-{sale.id}-BIO")
    mortality = ChartOfAccount.objects.get(company_id=cid, account_code="6726")
    legacy_line = je.lines.filter(debit__gt=0).first()
    relief = legacy_line.debit
    legacy_line.account = mortality
    legacy_line.save(update_fields=["account"])

    assert gl_balance(cid, "6726") == relief
    assert gl_balance(cid, "5240") == Decimal("0.00")

    sale.refresh_from_db()
    result = sync_aquaculture_fish_sale_bio_relief(cid, sale)
    assert result["posted"] is True, result

    assert gl_balance(cid, "6726") == Decimal("0.00"), "the legacy mortality charge was not cleared"
    assert gl_balance(cid, "5240") == relief, "the harvest cost did not move to COGS"
    assert_ledger_sound(cid)


@pytest.mark.django_db
def test_repair_command_moves_legacy_harvest_relief_to_cost_of_sales(api_client, farm):
    """The management command that fixes books already carrying harvest cost as mortality."""
    from io import StringIO

    from django.core.management import call_command

    cid, h, pond = farm["cid"], farm["headers"], farm["pond"]
    sale = _make_sale(cid, pond)
    assert _finalize(api_client, h, sale.id).status_code in (200, 201)

    je = JournalEntry.objects.get(company_id=cid, entry_number=f"AUTO-AQ-SALE-{sale.id}-BIO")
    mortality = ChartOfAccount.objects.get(company_id=cid, account_code="6726")
    line = je.lines.filter(debit__gt=0).first()
    relief = line.debit
    line.account = mortality
    line.save(update_fields=["account"])
    assert gl_balance(cid, "6726") == relief

    dry = StringIO()
    call_command("repair_harvest_cost_of_sales", company_id=cid, dry_run=True, stdout=dry)
    assert "would move" in dry.getvalue().lower()
    assert gl_balance(cid, "6726") == relief, "dry run must not change the books"

    out = StringIO()
    call_command("repair_harvest_cost_of_sales", company_id=cid, stdout=out)
    assert gl_balance(cid, "6726") == Decimal("0.00")
    assert gl_balance(cid, "5240") == relief
    assert_ledger_sound(cid)

    # Running it again finds nothing left to do.
    again = StringIO()
    call_command("repair_harvest_cost_of_sales", company_id=cid, stdout=again)
    assert "nothing to repair" in again.getvalue().lower()
