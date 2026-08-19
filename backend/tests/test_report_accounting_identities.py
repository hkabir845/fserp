"""
Accounting identities the reporting layer must satisfy, exercised against real posted activity.

Module-by-module audit of api.services.reporting. Each test drives the real report functions over
a company with genuine transactions (fuel POS, credit invoice, vendor bill, payment, inventory
write-off) and asserts the identities a set of books is judged on, rather than inspecting the
aggregation code by eye.

The balance sheet carries an automatic tie-out row (Sigma-ADJ) that forces `is_balanced` true, so
asserting `is_balanced` alone proves nothing. The real assertion is `auto_plug_amount == 0`: on
clean books nothing should need plugging.
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.services.reporting import (
    report_ap_aging,
    report_entities_financial_summary,
    report_ar_aging,
    report_balance_sheet,
    report_cash_flow,
    report_customer_balances,
    report_income_statement,
    report_trial_balance,
    report_vendor_balances,
)

PERIOD_START = date(2026, 1, 1)
PERIOD_END = date(2026, 12, 31)

CENT = 0.02  # reports return floats; allow a rounding cent when comparing

AGING_BUCKETS = ("current", "days_1_30", "days_31_60", "days_61_90", "days_over_90")


def _bucket_sum(row: dict) -> float:
    return sum(row[k] for k in AGING_BUCKETS)


@pytest.fixture
def books(api_client, auth_super_headers, company_master):
    """A company with fuel, credit-sale, purchase and write-off activity all posted to the GL."""
    from api.models import Item, Vendor
    from api.services.station_stock import set_station_stock
    from tests.test_api_production_audit import (
        _audit_fuel_nozzle,
        _audit_master_headers,
        _audit_seed_min_gl_accounts,
    )

    cid = company_master.id
    _audit_seed_min_gl_accounts(company_master)
    nozzle = _audit_fuel_nozzle(company_master)
    station = nozzle.tank.station
    h = _audit_master_headers(auth_super_headers, company_master)

    # 1. Fuel sale at the pump (cash).
    r = api_client.post(
        "/api/cashier/sale/",
        data=json.dumps({"nozzle_id": nozzle.id, "quantity": "40"}),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()

    # 2. Credit sale to a customer, with an amount that does not split evenly.
    shop_item = Item.objects.create(
        company_id=cid,
        name="Books Shop SKU",
        item_type="inventory",
        unit="piece",
        pos_category="shop",
        unit_price=Decimal("33.33"),
        cost=Decimal("12.50"),
    )
    set_station_stock(cid, station.id, shop_item.id, Decimal("100"))
    api_client.post("/api/customers/add-dummy/", **h)
    # Not [0]: the POS sale above created the Walk-in customer, which has no A/R subledger.
    cust = next(
        c
        for c in json.loads(api_client.get("/api/customers/", **h).content)
        if (c["display_name"] or "").strip().lower() != "walk-in"
    )
    inv = api_client.post(
        "/api/invoices/",
        data=json.dumps(
            {
                "customer_id": cust["id"],
                "station_id": station.id,
                "invoice_date": "2026-03-05",
                "status": "sent",
                "lines": [
                    {"item_id": shop_item.id, "quantity": "3", "unit_price": "33.33"},
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert inv.status_code in (200, 201), inv.content.decode()

    # 3. Vendor bill on credit.
    vendor = Vendor.objects.create(company_id=cid, company_name="Books Supplier")
    bill = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-03-09",
                "status": "open",
                "receipt_station_id": station.id,
                "lines": [{"description": "Shop overheads", "quantity": "1", "unit_cost": "1250.75"}],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert bill.status_code == 201, bill.content.decode()

    return {
        "cid": cid,
        "headers": h,
        "station": station,
        "customer_id": cust["id"],
        "vendor": vendor,
        "invoice": json.loads(inv.content.decode()),
        "bill": json.loads(bill.content.decode()),
    }


# ------------------------------------------------------- module 1: core statements


@pytest.mark.django_db
def test_trial_balance_debits_equal_credits(books):
    tb = report_trial_balance(books["cid"], PERIOD_START, PERIOD_END)
    assert tb["debits_equal_credits"] is True
    assert abs(tb["debit_credit_difference"]) <= CENT
    assert tb["total_debit"] > 0
    assert abs(tb["total_debit"] - tb["total_credit"]) <= CENT


@pytest.mark.django_db
def test_trial_balance_has_no_orphan_account_rows(books):
    """A '?<id>' row means journal lines point at a missing or other-company chart row."""
    tb = report_trial_balance(books["cid"], PERIOD_START, PERIOD_END)
    orphans = [a for a in tb["accounts"] if str(a["account_code"]).startswith("?")]
    assert not orphans, f"journal lines on unknown chart rows: {orphans}"


@pytest.mark.django_db
def test_balance_sheet_balances_without_an_automatic_plug(books):
    bs = report_balance_sheet(books["cid"], PERIOD_START, PERIOD_END)
    assert bs["auto_plug_amount"] == 0, (
        "balance sheet needed a tie-out plug of "
        f"{bs['auto_plug_amount']}; assets {bs['assets']['total']} vs "
        f"liabilities+equity {bs['total_liabilities_and_equity']}"
    )
    assert bs["is_balanced"] is True
    assert abs(bs["assets_minus_liabilities_equity"]) <= CENT


@pytest.mark.django_db
def test_balance_sheet_accounting_equation_holds(books):
    bs = report_balance_sheet(books["cid"], PERIOD_START, PERIOD_END)
    assets = bs["assets"]["total"]
    liabilities = bs["liabilities"]["total"]
    equity = bs["equity"]["total"]
    assert abs(assets - (liabilities + equity)) <= CENT


@pytest.mark.django_db
def test_income_statement_totals_are_internally_consistent(books):
    inc = report_income_statement(books["cid"], PERIOD_START, PERIOD_END)
    income = inc["income"]["total"]
    cogs = inc["cost_of_goods_sold"]["total"]
    expenses = inc["expenses"]["total"]
    assert abs(inc["gross_profit"] - (income - cogs)) <= CENT
    assert abs(inc["net_income"] - (income - cogs - expenses)) <= CENT


@pytest.mark.django_db
def test_income_statement_period_matches_cumulative_movement(books):
    """A mismatch means P&L activity is dated outside the period or sitting in opening balances."""
    inc = report_income_statement(books["cid"], PERIOD_START, PERIOD_END)
    assert inc["period_matches_cumulative_change"] is True, (
        f"period net {inc['net_income']} vs cumulative change "
        f"{inc['cumulative_net_income_change']}"
    )


@pytest.mark.django_db
def test_goods_sold_always_carry_a_cost(books):
    """Revenue from inventory items with no COGS overstates profit."""
    inc = report_income_statement(books["cid"], PERIOD_START, PERIOD_END)
    assert inc["income"]["total"] > 0
    assert inc["cost_of_goods_sold"]["total"] > 0, (
        "inventory was sold but no COGS reached the P&L"
    )


@pytest.mark.django_db
def test_balance_sheet_net_income_ties_to_the_income_statement(books):
    """
    Cumulative unclosed P&L on the balance sheet must equal the income statement for a period
    covering all activity - otherwise equity and profit tell different stories.
    """
    bs = report_balance_sheet(books["cid"], PERIOD_START, PERIOD_END)
    inc = report_income_statement(books["cid"], PERIOD_START, PERIOD_END)
    assert abs(bs["net_income_cumulative"] - inc["net_income"]) <= CENT


@pytest.mark.django_db
def test_trial_balance_reconciles_to_the_balance_sheet_and_income_statement(books):
    """
    Every posted line lands in exactly one statement. With no chart opening balances, the net of
    all trial-balance movement must be zero, and the P&L slice of it must equal net income.
    """
    cid = books["cid"]
    tb = report_trial_balance(cid, PERIOD_START, PERIOD_END)
    inc = report_income_statement(cid, PERIOD_START, PERIOD_END)

    pl_types = {"income", "cost_of_goods_sold", "expense"}
    pl_movement = sum(
        a["credit"] - a["debit"] for a in tb["accounts"] if a["account_type"] in pl_types
    )
    assert abs(pl_movement - inc["net_income"]) <= CENT, (
        f"trial-balance P&L movement {pl_movement} vs income statement {inc['net_income']}"
    )


# ------------------------------------------------------- module 2: subledgers and aging


@pytest.mark.django_db
def test_ar_aging_buckets_sum_to_the_total_outstanding(books):
    ar = report_ar_aging(books["cid"], PERIOD_START, PERIOD_END)
    rows = ar.get("customers", [])
    assert rows, "the credit invoice should be aged somewhere"
    for row in rows:
        assert abs(_bucket_sum(row) - row["total"]) <= CENT, row
    assert abs(_bucket_sum(ar["totals"]) - ar["totals"]["total"]) <= CENT
    assert abs(sum(r["total"] for r in rows) - ar["totals"]["total"]) <= CENT


@pytest.mark.django_db
def test_ap_aging_buckets_sum_to_the_total_outstanding(books):
    ap = report_ap_aging(books["cid"], PERIOD_START, PERIOD_END)
    rows = ap.get("vendors", [])
    assert rows, "the open vendor bill should be aged somewhere"
    for row in rows:
        assert abs(_bucket_sum(row) - row["total"]) <= CENT, row
    assert abs(_bucket_sum(ap["totals"]) - ap["totals"]["total"]) <= CENT
    assert abs(sum(r["total"] for r in rows) - ap["totals"]["total"]) <= CENT


@pytest.mark.django_db
def test_ar_aging_total_matches_the_customer_balances_report(books):
    """Two views of the same receivable must agree."""
    cid = books["cid"]
    ar = report_ar_aging(cid, PERIOD_START, PERIOD_END)
    balances = report_customer_balances(cid, PERIOD_START, PERIOD_END)
    aging_total = sum(r["total"] for r in ar.get("customers", []))
    ledger_total = sum(r["balance"] for r in balances.get("customers", []))
    assert abs(aging_total - ledger_total) <= CENT, (
        f"AR aging {aging_total} vs customer balances {ledger_total}"
    )


@pytest.mark.django_db
def test_ap_aging_total_matches_the_vendor_balances_report(books):
    cid = books["cid"]
    ap = report_ap_aging(cid, PERIOD_START, PERIOD_END)
    balances = report_vendor_balances(cid, PERIOD_START, PERIOD_END)
    aging_total = sum(r["total"] for r in ap.get("vendors", []))
    ledger_total = sum(r["balance"] for r in balances.get("vendors", []))
    assert abs(aging_total - ledger_total) <= CENT, (
        f"AP aging {aging_total} vs vendor balances {ledger_total}"
    )


# ------------------------------------------------------- module 3: cash flow


@pytest.mark.django_db
def test_cash_flow_ending_cash_matches_the_balance_sheet(books):
    """Cash on the cash-flow statement and cash on the balance sheet are the same money."""
    cid = books["cid"]
    cf = report_cash_flow(cid, PERIOD_START, PERIOD_END)
    bs = report_balance_sheet(cid, PERIOD_START, PERIOD_END)

    bs_cash = sum(
        a["balance"]
        for a in bs["assets"]["accounts"]
        if str(a["account_code"]) in ("1010", "1020", "1030", "1040", "1050")
    )
    ending = cf["cash_summary"]["ending_cash"]
    assert abs(ending - bs_cash) <= CENT, (
        f"cash flow ending {ending} vs balance sheet cash {bs_cash}"
    )


@pytest.mark.django_db
def test_cash_flow_movement_reconciles_opening_to_closing(books):
    cs = report_cash_flow(books["cid"], PERIOD_START, PERIOD_END)["cash_summary"]
    assert abs((cs["beginning_cash"] + cs["net_change_in_cash"]) - cs["ending_cash"]) <= CENT
    assert abs((cs["total_deposits"] - cs["total_withdrawals"]) - cs["net_change_in_cash"]) <= CENT


@pytest.mark.django_db
def test_cash_flow_sees_cash_on_hand_not_only_bank_typed_accounts(books):
    """
    The standard chart types 1010/1030 as `asset` with a cash/checking sub-type, not as
    account_type "bank_account". Matching on the type alone made the whole cash summary zero.
    """
    cf = report_cash_flow(books["cid"], PERIOD_START, PERIOD_END)
    codes = {str(r["account_code"]) for r in cf["bank_accounts"]}
    assert "1010" in codes, f"cash on hand missing from the cash flow statement: {codes}"
    assert cf["cash_summary"]["ending_cash"] > 0
    assert cf["cash_summary"]["total_deposits"] > 0


@pytest.mark.django_db
def test_receivable_invoice_cannot_be_raised_against_walk_in(
    api_client, auth_super_headers, company_master
):
    """
    Walk-in has no A/R subledger, so a credit invoice against it would debit 1100 while the
    customer balances report showed nothing - an A/R control account that cannot be reconciled.
    The POS already refuses on-account sales to Walk-in; invoices must too.
    """
    from api.models import Customer, Item
    from tests.test_api_production_audit import _audit_master_headers, _audit_seed_min_gl_accounts

    cid = company_master.id
    _audit_seed_min_gl_accounts(company_master)
    h = _audit_master_headers(auth_super_headers, company_master)
    walk = Customer.objects.create(
        company_id=cid, display_name="Walk-in", customer_number="WALK-AR", is_active=True
    )
    item = Item.objects.create(company_id=cid, name="Walk AR SKU", unit_price=Decimal("10"))

    def post(status):
        return api_client.post(
            "/api/invoices/",
            data=json.dumps(
                {
                    "customer_id": walk.id,
                    "invoice_date": "2026-04-01",
                    "status": status,
                    "lines": [{"item_id": item.id, "quantity": "1", "unit_price": "10"}],
                }
            ),
            content_type="application/json",
            **h,
        )

    r = post("sent")
    assert r.status_code == 400, r.content.decode()
    assert "walk-in" in json.loads(r.content.decode())["detail"].lower()

    # A cash sale to Walk-in is still perfectly normal.
    assert post("paid").status_code in (200, 201)


# ------------------------------------------------------- module 4: entity / segment splits


@pytest.mark.django_db
def test_every_posted_line_lands_in_exactly_one_entity_segment(books):
    """
    Station, pond and head-office scopes must partition the ledger: mutually exclusive (no line
    counted twice) and exhaustive (no line dropped). Otherwise segment P&L cannot be trusted.
    """
    from api.models import JournalEntryLine
    from api.services.reporting import _je_lines_base, _je_lines_pond, _je_lines_unscoped_dims
    from api.models import AquaculturePond, Station

    cid = books["cid"]
    all_ids = set(
        JournalEntryLine.objects.filter(
            journal_entry__company_id=cid, journal_entry__is_posted=True
        ).values_list("id", flat=True)
    )

    seen: dict[int, list[str]] = {}
    for st in Station.objects.filter(company_id=cid, is_active=True):
        for lid in _je_lines_base(cid, st.id).values_list("id", flat=True):
            seen.setdefault(lid, []).append(f"station:{st.id}")
    for pond in AquaculturePond.objects.filter(company_id=cid, is_active=True):
        for lid in _je_lines_pond(cid, pond.id).values_list("id", flat=True):
            seen.setdefault(lid, []).append(f"pond:{pond.id}")
    for lid in _je_lines_unscoped_dims(cid).values_list("id", flat=True):
        seen.setdefault(lid, []).append("head-office")

    duplicated = {lid: where for lid, where in seen.items() if len(where) > 1}
    assert not duplicated, f"journal lines counted in more than one segment: {duplicated}"

    missing = all_ids - set(seen)
    assert not missing, f"journal lines in no segment at all: {sorted(missing)}"


@pytest.mark.django_db
def test_entity_segment_net_income_sums_to_the_company_total(books):
    bundle = report_entities_financial_summary(books["cid"], PERIOD_START, PERIOD_END)
    parts = bundle["by_station"] + bundle["by_pond"] + [bundle["unscoped"]]
    segment_net = sum(r["net_income"] for r in parts)
    company_net = bundle["company_total"]["net_income"]
    assert abs(segment_net - company_net) <= CENT, (
        f"segments net to {segment_net} but the company total is {company_net}"
    )


@pytest.mark.django_db
def test_entity_segment_income_and_expense_sum_to_the_company_total(books):
    bundle = report_entities_financial_summary(books["cid"], PERIOD_START, PERIOD_END)
    parts = bundle["by_station"] + bundle["by_pond"] + [bundle["unscoped"]]
    for key in ("income", "cost_of_goods_sold", "expenses"):
        segment = sum(r[key] for r in parts)
        company = bundle["company_total"][key]
        assert abs(segment - company) <= CENT, (
            f"{key}: segments {segment} vs company {company}"
        )


@pytest.mark.django_db
def test_legacy_header_only_site_lines_belong_to_one_segment(company_tenant_with_gl):
    """
    A journal whose site sits on the header rather than the lines is the legacy shape that
    `_je_lines_base` deliberately inherits into the station scope. Head office must therefore
    exclude it, or the same line lands in two segments and the splits overshoot the company.
    """
    from api.models import ChartOfAccount, JournalEntry, JournalEntryLine, Station
    from api.services.reporting import _je_lines_base, _je_lines_unscoped_dims

    cid = company_tenant_with_gl.id
    st = Station.objects.create(company_id=cid, station_name="Legacy Site", is_active=True)
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")
    equity = ChartOfAccount.objects.get(company_id=cid, account_code="3200")
    je = JournalEntry.objects.create(
        company_id=cid,
        entry_number="LEGACY-SITE-1",
        entry_date=date(2026, 5, 1),
        station_id=st.id,
        is_posted=True,
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=cash, debit=Decimal("100"), credit=Decimal("0"), station_id=None
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=equity, debit=Decimal("0"), credit=Decimal("100"), station_id=None
    )

    in_station = set(_je_lines_base(cid, st.id).values_list("id", flat=True))
    in_head_office = set(_je_lines_unscoped_dims(cid).values_list("id", flat=True))
    assert len(in_station) == 2, "the station scope should inherit the header site"
    assert not (in_station & in_head_office), "line counted in both station and head office"
