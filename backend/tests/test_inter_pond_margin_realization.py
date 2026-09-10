"""Inter-pond fish trade: routed to the internal pair, and eliminated only while unsold.

Two defects, one story (A0-2 in `docs/ACCOUNTING_AUDIT_BACKLOG.md`):

* A pond selling to another pond posted to ordinary harvest revenue (4240), which the
  consolidation elimination never looks at — so the income statement reported "No inter-pond
  trade in this period" while 100% of the internal margin sat in group profit.
* The elimination, once it did apply, was permanent. When the buying pond later sold the fish
  to a real customer that profit was genuinely earned, but consolidated income never got it
  back and the 1585 contra kept writing down inventory that had already gone.
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureFishSale,
    AquaculturePond,
    Company,
    JournalEntryLine,
    Vendor,
)

pytestmark = pytest.mark.django_db

PERIOD_START = date(2026, 1, 1)
PERIOD_END = date(2026, 12, 31)


def gl_balance(company_id: int, code: str) -> Decimal:
    rows = JournalEntryLine.objects.filter(
        journal_entry__company_id=company_id,
        journal_entry__is_posted=True,
        account__account_code=code,
    )
    return sum((r.debit - r.credit for r in rows), Decimal("0"))


@pytest.fixture
def two_ponds(api_client, auth_super_headers, company_master):
    """A stocked seller pond and a buyer pond that owns an internal POS customer."""
    from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
    from api.services.aquaculture_pond_pos_customer import provision_missing_pond_pos_customers
    from tests.test_api_production_audit import _audit_master_headers, _audit_seed_min_gl_accounts

    cid = company_master.id
    _audit_seed_min_gl_accounts(company_master)
    Company.objects.filter(pk=cid).update(aquaculture_enabled=True, aquaculture_licensed=True)
    ensure_aquaculture_chart_accounts(cid)
    h = _audit_master_headers(auth_super_headers, company_master)

    seller = AquaculturePond.objects.create(
        company_id=cid, name="Seller Pond", pond_role="nursing", is_active=True
    )
    buyer = AquaculturePond.objects.create(
        company_id=cid, name="Buyer Pond", pond_role="grow_out", is_active=True
    )
    provision_missing_pond_pos_customers(company_id=cid)
    buyer.refresh_from_db()
    assert buyer.pos_customer_id, "the buying pond needs an internal POS customer to trade"

    vendor = Vendor.objects.create(company_id=cid, company_name="Hatchery Inputs Ltd")
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
                        "unit_cost": "30000.00",
                        "aquaculture_pond_id": seller.id,
                        "aquaculture_expense_category": "fry_stocking",
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    return {"cid": cid, "headers": h, "seller": seller, "buyer": buyer}


def _receive_into_buyer(ctx, *, weight="1000", amount="50000.00"):
    """The buying pond's side of the trade: the purchase bill that puts the fish in its pond.

    The documented flow is "the selling pond raises a sale and the receiving pond records the
    matching purchase bill" (aquaculture_fish_transfer_policy), so both legs have to exist for
    the group to still hold the biomass.
    """
    from api.models import Bill, BillLine, Item, Vendor

    cid = ctx["cid"]
    fish_item = Item.objects.create(
        company_id=cid, name="Tilapia (internal)", unit="kg", pos_category="fish"
    )
    seller_vendor = Vendor.objects.create(company_id=cid, company_name="Seller Pond (internal)")
    bill = Bill.objects.create(
        company_id=cid,
        vendor=seller_vendor,
        bill_number="B-INTERNAL-1",
        bill_date=date(2026, 5, 1),
        status="open",
        stock_receipt_applied=True,
        total=Decimal(amount),
    )
    BillLine.objects.create(
        bill=bill,
        item=fish_item,
        quantity=Decimal("1"),
        amount=Decimal(amount),
        aquaculture_pond=ctx["buyer"],
        aquaculture_fish_count=5000,
        aquaculture_fish_weight_kg=Decimal(weight),
    )
    return bill


def _sell_to(api_client, ctx, customer_id, *, weight="1000", amount="50000.00"):
    sale = AquacultureFishSale.objects.create(
        company_id=ctx["cid"],
        pond=ctx["seller"],
        income_type="fish_harvest_sale",
        fish_species="tilapia",
        sale_date=date(2026, 5, 1),
        weight_kg=Decimal(weight),
        fish_count=5000,
        total_amount=Decimal(amount),
        buyer_name="Buyer Pond",
    )
    r = api_client.post(
        f"/api/aquaculture/sales/{sale.id}/finalize/",
        data=json.dumps({"record_as": "on_account", "customer_id": customer_id}),
        content_type="application/json",
        **ctx["headers"],
    )
    assert r.status_code in (200, 201), r.content.decode()
    return sale


def test_a_sale_to_another_pond_posts_to_the_internal_trade_pair(api_client, two_ponds):
    """Routing: 4245 / 5245, not ordinary harvest revenue 4240."""
    cid = two_ponds["cid"]
    _sell_to(api_client, two_ponds, two_ponds["buyer"].pos_customer_id)

    assert gl_balance(cid, "4245") == Decimal("-50000.00"), (
        "an inter-pond sale must credit internal revenue so consolidation can net it"
    )
    assert gl_balance(cid, "4240") == Decimal("0.00"), (
        "and must not land in ordinary harvest revenue, where elimination never looks"
    )
    assert gl_balance(cid, "5245") > Decimal("0"), "its cost belongs on the internal cost line"


def test_an_outside_sale_still_posts_to_ordinary_harvest_revenue(
    api_client, two_ponds, company_master
):
    """The routing must key on the counterparty, not on being an aquaculture sale."""
    from api.models import Customer

    cid = two_ponds["cid"]
    outside = Customer.objects.create(
        company_id=cid, customer_number="C-OUT", display_name="Kawran Bazar Arot", is_active=True
    )
    _sell_to(api_client, two_ponds, outside.id)

    assert gl_balance(cid, "4240") == Decimal("-50000.00")
    assert gl_balance(cid, "4245") == Decimal("0.00")


def test_the_income_statement_stops_denying_the_trade_exists(api_client, two_ponds):
    from api.services.reporting import report_income_statement

    cid = two_ponds["cid"]
    _sell_to(api_client, two_ponds, two_ponds["buyer"].pos_customer_id)

    inc = report_income_statement(cid, PERIOD_START, PERIOD_END)
    elim = inc["internal_eliminations"]
    assert elim["applied"] is True, (
        "the report used to print 'No inter-pond trade in this period' while the margin sat "
        "inside group profit"
    )
    assert elim["internal_revenue"] == "50000.00"


def test_margin_is_unrealised_while_the_buying_pond_still_holds_the_fish(api_client, two_ponds):
    from api.services.internal_trade_elimination import internal_trade_elimination

    cid = two_ponds["cid"]
    _sell_to(api_client, two_ponds, two_ponds["buyer"].pos_customer_id)
    _receive_into_buyer(two_ponds)

    elim = internal_trade_elimination(cid, start=None, end=PERIOD_END)
    assert elim["gross_margin"] > 0
    assert elim["unrealized_margin"] == elim["gross_margin"], "nothing sold on yet"
    assert elim["realized_margin"] == Decimal("0")


def test_margin_is_released_once_the_buying_pond_sells_the_fish_outside(
    api_client, two_ponds
):
    from api.models import Customer
    from api.services.internal_trade_elimination import internal_trade_elimination

    cid = two_ponds["cid"]
    _sell_to(api_client, two_ponds, two_ponds["buyer"].pos_customer_id)
    _receive_into_buyer(two_ponds)
    before = internal_trade_elimination(cid, start=None, end=PERIOD_END)
    assert before["realized_margin"] == Decimal("0")

    # The buying pond now sells the same fish on to a real customer.
    outside = Customer.objects.create(
        company_id=cid, customer_number="C-EXT", display_name="Wholesale Market", is_active=True
    )
    onward = AquacultureFishSale.objects.create(
        company_id=cid,
        pond=two_ponds["buyer"],
        income_type="fish_harvest_sale",
        fish_species="tilapia",
        sale_date=date(2026, 8, 1),
        weight_kg=Decimal("1000"),
        fish_count=5000,
        total_amount=Decimal("70000.00"),
        buyer_name="Wholesale Market",
    )
    r = api_client.post(
        f"/api/aquaculture/sales/{onward.id}/finalize/",
        data=json.dumps({"record_as": "on_account", "customer_id": outside.id}),
        content_type="application/json",
        **two_ponds["headers"],
    )
    assert r.status_code in (200, 201), r.content.decode()

    after = internal_trade_elimination(cid, start=None, end=PERIOD_END)
    assert after["gross_margin"] == before["gross_margin"], "the trade itself did not change"
    assert after["realized_margin"] > Decimal("0"), (
        "the fish have left the group, so the margin on them is genuinely earned"
    )
    assert after["unrealized_margin"] < before["unrealized_margin"]


def test_the_balance_sheet_still_balances_through_realization(api_client, two_ponds):
    """Assets fall by the unrealized part and equity by the same, or Σ-ADJ would fire."""
    from api.services.reporting import report_balance_sheet

    cid = two_ponds["cid"]
    _sell_to(api_client, two_ponds, two_ponds["buyer"].pos_customer_id)

    bs = report_balance_sheet(cid, PERIOD_START, PERIOD_END)
    assert bs["auto_plug_amount"] == "0.00", bs["accounting_note"]
    assert bs["is_balanced"] is True
