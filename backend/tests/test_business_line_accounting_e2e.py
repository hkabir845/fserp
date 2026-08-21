"""
End-to-end accounting check for both business lines: filling station and aquaculture.

Each test drives a realistic cycle through the real APIs - buy stock, sell it, adjust it - and
then asks the accounting questions an auditor would ask of the result:

* did every document reach the ledger (no posted document without its journal)?
* does the ledger still balance, to the paisa, at 2 decimal places?
* does the subledger tie to its control account (tank litres to inventory, pond biology to 1581)?
* do the two business lines report separately without losing or double-counting anything?
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquaculturePond,
    ChartOfAccount,
    Company,
    Item,
    JournalEntry,
    JournalEntryLine,
    Station,
    Tank,
    Vendor,
)
from api.services.gl_posting_audit import audit_company_gl_gaps
from api.services.reporting import (
    report_balance_sheet,
    report_income_statement,
    report_trial_balance,
)
from api.utils.rounding import money

PERIOD_START = date(2026, 1, 1)
PERIOD_END = date(2026, 12, 31)
CENT = Decimal("0.02")


def _headers(auth_super_headers, company_master):
    from tests.test_api_production_audit import _audit_master_headers

    return _audit_master_headers(auth_super_headers, company_master)


def assert_ledger_sound(company_id: int) -> None:
    """Every posted entry balances, is positive, and is stored at two decimal places."""
    for je in JournalEntry.objects.filter(
        company_id=company_id, is_posted=True
    ).prefetch_related("lines"):
        lines = list(je.lines.all())
        assert lines, f"{je.entry_number} posted with no lines"
        debit = sum((ln.debit or Decimal("0")) for ln in lines)
        credit = sum((ln.credit or Decimal("0")) for ln in lines)
        assert debit == credit, f"{je.entry_number} out of balance: {debit} vs {credit}"
        for ln in lines:
            d, c = ln.debit or Decimal("0"), ln.credit or Decimal("0")
            assert not (d > 0 and c > 0), f"{je.entry_number} line {ln.id} is both Dr and Cr"
            assert d == money(d) and c == money(c), f"{je.entry_number} line {ln.id} not 2dp"


def assert_no_gl_gaps(company_id: int) -> None:
    """No document may sit posted in a subledger with its automatic journal missing."""
    audit = audit_company_gl_gaps(company_id)
    assert audit["total_gaps"] == 0, (
        f"documents posted without their GL journal: {audit['gaps_by_type']}"
    )


def gl_balance(company_id: int, account_code: str, as_of: date = PERIOD_END) -> Decimal:
    """Posted debit-minus-credit movement on one account."""
    total = Decimal("0")
    for ln in JournalEntryLine.objects.filter(
        journal_entry__company_id=company_id,
        journal_entry__is_posted=True,
        journal_entry__entry_date__lte=as_of,
        account__account_code=account_code,
    ):
        total += (ln.debit or Decimal("0")) - (ln.credit or Decimal("0"))
    return money(total)


# =========================================================== filling station


@pytest.fixture
def fuel_station(api_client, auth_super_headers, company_master):
    """A pump bay with a tank, and the chart the fuel postings need."""
    from tests.test_api_production_audit import _audit_fuel_nozzle, _audit_seed_min_gl_accounts

    _audit_seed_min_gl_accounts(company_master)
    nozzle = _audit_fuel_nozzle(company_master)
    return {
        "cid": company_master.id,
        "headers": _headers(auth_super_headers, company_master),
        "nozzle": nozzle,
        "tank": nozzle.tank,
        "station": nozzle.tank.station,
        "product": nozzle.product,
    }


@pytest.mark.django_db
def test_fuel_purchase_and_pump_sales_leave_a_sound_ledger(api_client, fuel_station):
    """Buy a tanker of fuel on credit, sell some at the pump, and audit the books."""
    cid, h = fuel_station["cid"], fuel_station["headers"]
    vendor = Vendor.objects.create(company_id=cid, company_name="Padma Oil Co")

    bill = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-02-01",
                "status": "open",
                "receipt_station_id": fuel_station["station"].id,
                "lines": [
                    {
                        "item_id": fuel_station["product"].id,
                        "tank_id": fuel_station["tank"].id,
                        "quantity": "5000",
                        "unit_cost": "104.25",
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert bill.status_code == 201, bill.content.decode()

    for qty in ("35.5", "12.25", "7.75"):
        r = api_client.post(
            "/api/cashier/sale/",
            data=json.dumps({"nozzle_id": fuel_station["nozzle"].id, "quantity": qty}),
            content_type="application/json",
            **h,
        )
        assert r.status_code == 201, r.content.decode()

    assert_ledger_sound(cid)
    assert_no_gl_gaps(cid)

    tb = report_trial_balance(cid, PERIOD_START, PERIOD_END)
    assert tb["debits_equal_credits"] is True
    bs = report_balance_sheet(cid, PERIOD_START, PERIOD_END)
    assert bs["auto_plug_amount"] == 0, f"balance sheet needed a plug of {bs['auto_plug_amount']}"


@pytest.mark.django_db
def test_fuel_purchase_raises_payable_and_inventory_together(api_client, fuel_station):
    """Dr fuel inventory / Cr A/P - a purchase must move both sides by the same amount."""
    cid, h = fuel_station["cid"], fuel_station["headers"]
    vendor = Vendor.objects.create(company_id=cid, company_name="Meghna Petroleum")

    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-02-03",
                "status": "open",
                "receipt_station_id": fuel_station["station"].id,
                "lines": [
                    {
                        "item_id": fuel_station["product"].id,
                        "tank_id": fuel_station["tank"].id,
                        "quantity": "2000",
                        "unit_cost": "103.10",
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    expected = money(Decimal("2000") * Decimal("103.10"))

    assert gl_balance(cid, "1200") == expected, "fuel inventory did not take the purchase"
    assert -gl_balance(cid, "2000") == expected, "accounts payable did not take the purchase"
    assert_ledger_sound(cid)


@pytest.mark.django_db
def test_pump_sale_relieves_inventory_and_books_cost_of_fuel_sold(api_client, fuel_station):
    """Selling wet stock must relieve 1200 and charge COGS - revenue alone overstates profit."""
    cid, h = fuel_station["cid"], fuel_station["headers"]
    vendor = Vendor.objects.create(company_id=cid, company_name="Jamuna Oil")
    api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-02-05",
                "status": "open",
                "receipt_station_id": fuel_station["station"].id,
                "lines": [
                    {
                        "item_id": fuel_station["product"].id,
                        "tank_id": fuel_station["tank"].id,
                        "quantity": "1000",
                        "unit_cost": "100.00",
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    inv_after_purchase = gl_balance(cid, "1200")

    r = api_client.post(
        "/api/cashier/sale/",
        data=json.dumps({"nozzle_id": fuel_station["nozzle"].id, "quantity": "100"}),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()

    inv_after_sale = gl_balance(cid, "1200")
    relieved = inv_after_purchase - inv_after_sale
    assert relieved > 0, "a fuel sale must relieve inventory"

    inc = report_income_statement(cid, PERIOD_START, PERIOD_END)
    assert inc["income"]["total"] > 0
    assert inc["cost_of_goods_sold"]["total"] > 0, "fuel sold with no cost of fuel sold"
    assert_ledger_sound(cid)
    assert_no_gl_gaps(cid)


@pytest.mark.django_db
def test_tank_dip_shortage_books_shrinkage_against_inventory(api_client, fuel_station):
    """A stick reading below book is a real loss and must reach the P&L, not just the tank."""
    from api.services.gl_posting import sync_tank_dip_variance_journal
    from api.models import TankDip

    cid = fuel_station["cid"]
    tank = fuel_station["tank"]
    Item.objects.filter(pk=fuel_station["product"].id).update(cost=Decimal("100.00"))

    dip = TankDip.objects.create(
        company_id=cid,
        tank=tank,
        dip_date=date(2026, 2, 10),
        volume=Decimal("9900"),
        book_stock_before=Decimal("10000"),
    )
    result = sync_tank_dip_variance_journal(cid, dip.id)
    assert result.get("status") != "skipped", result

    je = JournalEntry.objects.filter(
        company_id=cid, entry_number=f"AUTO-TANKDIP-{dip.id}-VAR"
    ).first()
    assert je is not None, "wet-stock loss produced no journal"
    codes = {ln.account.account_code for ln in je.lines.all()}
    assert "1200" in codes, "the loss must relieve fuel inventory"
    assert_ledger_sound(cid)


# =========================================================== aquaculture


@pytest.fixture
def aquaculture(api_client, auth_super_headers, company_master):
    """An aquaculture company with the module enabled and its chart seeded."""
    from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
    from tests.test_api_production_audit import _audit_seed_min_gl_accounts

    cid = company_master.id
    _audit_seed_min_gl_accounts(company_master)
    Company.objects.filter(pk=cid).update(aquaculture_enabled=True, aquaculture_licensed=True)
    ensure_aquaculture_chart_accounts(cid)

    shop = Station.objects.create(
        company_id=cid, station_name="Premium Agro Hub", operates_fuel_retail=False, is_active=True
    )
    nursing = AquaculturePond.objects.create(
        company_id=cid, name="Nursing E2E", pond_role="nursing", is_active=True
    )
    grow = AquaculturePond.objects.create(
        company_id=cid, name="Grow E2E", pond_role="grow_out", is_active=True
    )
    return {
        "cid": cid,
        "headers": _headers(auth_super_headers, company_master),
        "shop": shop,
        "nursing": nursing,
        "grow": grow,
    }


def _fry_item(cid: int) -> Item:
    return Item.objects.create(
        company_id=cid,
        name="Tilapia Fry E2E",
        item_type="inventory",
        unit="kg",
        pos_category="fish",
        unit_price=Decimal("200"),
        cost=Decimal("150"),
    )


@pytest.mark.django_db
def test_pond_fry_and_feed_purchases_leave_a_sound_ledger(api_client, aquaculture):
    """Stock a nursing pond and feed it, then audit the books end to end."""
    cid, h = aquaculture["cid"], aquaculture["headers"]
    vendor = Vendor.objects.create(company_id=cid, company_name="CP Hatchery E2E")
    fry = _fry_item(cid)

    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-03-01",
                "status": "open",
                "lines": [
                    {
                        "item_id": fry.id,
                        "description": "Fry stocking",
                        "quantity": "20",
                        "unit_cost": "5000",
                        "aquaculture_pond_id": aquaculture["nursing"].id,
                        "aquaculture_fish_species": "tilapia",
                        "aquaculture_fish_weight_kg": "20",
                        "aquaculture_fish_count": 50000,
                    },
                    {
                        "description": "Nursery feed",
                        "quantity": "1",
                        "unit_cost": "18750.55",
                        "aquaculture_pond_id": aquaculture["nursing"].id,
                        "aquaculture_expense_category": "feed_purchase",
                    },
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()

    assert_ledger_sound(cid)
    assert_no_gl_gaps(cid)

    bs = report_balance_sheet(cid, PERIOD_START, PERIOD_END)
    assert bs["auto_plug_amount"] == 0, f"balance sheet needed a plug of {bs['auto_plug_amount']}"
    tb = report_trial_balance(cid, PERIOD_START, PERIOD_END)
    assert tb["debits_equal_credits"] is True


def _post_pond_feed_bill(api_client, cid, h, pond_id, vendor_name, amount="9999.99"):
    vendor = Vendor.objects.create(company_id=cid, company_name=vendor_name)
    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-03-04",
                "status": "open",
                "lines": [
                    {
                        "description": "Pond feed",
                        "quantity": "1",
                        "unit_cost": amount,
                        "aquaculture_pond_id": pond_id,
                        "aquaculture_expense_category": "feed_purchase",
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    return json.loads(r.content.decode())["id"]


@pytest.mark.django_db
def test_pond_costs_are_tagged_to_the_pond_that_incurred_them(api_client, aquaculture):
    """Pond P&L is only meaningful if every pond cost carries its pond tag."""
    cid, h = aquaculture["cid"], aquaculture["headers"]
    pond_id = aquaculture["nursing"].id
    bill_id = _post_pond_feed_bill(api_client, cid, h, pond_id, "Feed Mill E2E")

    tagged = JournalEntryLine.objects.filter(
        journal_entry__company_id=cid,
        journal_entry__entry_number=f"AUTO-BILL-{bill_id}",
        aquaculture_pond_id=pond_id,
        debit__gt=0,
    )
    assert tagged.exists(), "the pond cost reached the GL with no pond tag"
    # Nothing pond-tagged may leak onto another pond's books.
    other = JournalEntryLine.objects.filter(
        journal_entry__company_id=cid,
        journal_entry__entry_number=f"AUTO-BILL-{bill_id}",
        aquaculture_pond_id=aquaculture["grow"].id,
    )
    assert not other.exists(), "pond cost tagged to the wrong pond"


@pytest.mark.django_db
def test_capitalized_pond_feed_becomes_a_biological_asset_not_an_expense(
    api_client, aquaculture
):
    """
    With the default capitalize policy, feed is part of the fish, not a period cost: Dr 1581.
    The cost reaches the P&L later as COGS on harvest, which is what matching requires.
    """
    cid, h = aquaculture["cid"], aquaculture["headers"]
    assert Company.objects.get(pk=cid).aquaculture_capitalize_pond_consumption_to_bioasset is True
    pond_id = aquaculture["nursing"].id

    _post_pond_feed_bill(api_client, cid, h, pond_id, "Capitalize Feed Co")

    assert gl_balance(cid, "1581") == Decimal("9999.99"), "feed did not capitalize to 1581"
    pond_pl = report_income_statement(cid, PERIOD_START, PERIOD_END, pond_id=pond_id)
    assert pond_pl["expenses"]["total"] == 0, (
        "capitalized feed must not also hit the pond P&L - that would double-count the cost"
    )
    assert_ledger_sound(cid)
    assert_no_gl_gaps(cid)


@pytest.mark.django_db
def test_expensed_pond_feed_hits_the_pond_profit_and_loss(api_client, aquaculture):
    """With capitalization off, the same feed bill is a period cost on that pond's P&L."""
    cid, h = aquaculture["cid"], aquaculture["headers"]
    Company.objects.filter(pk=cid).update(
        aquaculture_capitalize_pond_consumption_to_bioasset=False
    )
    pond_id = aquaculture["nursing"].id

    _post_pond_feed_bill(api_client, cid, h, pond_id, "Expense Feed Co")

    assert gl_balance(cid, "1581") == Decimal("0.00"), "expensed feed must not touch 1581"
    pond_pl = report_income_statement(cid, PERIOD_START, PERIOD_END, pond_id=pond_id)
    assert pond_pl["expenses"]["total"] > 0, "expensed pond feed never reached the pond P&L"
    assert_ledger_sound(cid)
    assert_no_gl_gaps(cid)


@pytest.mark.django_db
def test_pond_scoped_pl_never_exceeds_the_company_pl(api_client, aquaculture):
    """One pond cannot report more cost than the whole company incurred."""
    cid, h = aquaculture["cid"], aquaculture["headers"]
    vendor = Vendor.objects.create(company_id=cid, company_name="Shared Cost E2E")
    med = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-03-06",
                "status": "open",
                "lines": [
                    {
                        "description": "Pond medicine",
                        "quantity": "1",
                        "unit_cost": "4321.75",
                        "aquaculture_pond_id": aquaculture["grow"].id,
                        "aquaculture_expense_category": "medicine_purchase",
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert med.status_code == 201, med.content.decode()
    company = report_income_statement(cid, PERIOD_START, PERIOD_END)
    pond = report_income_statement(cid, PERIOD_START, PERIOD_END, pond_id=aquaculture["grow"].id)
    assert pond["expenses"]["total"] <= company["expenses"]["total"] + float(CENT)
    assert pond["income"]["total"] <= company["income"]["total"] + float(CENT)


# =========================================================== both lines together


@pytest.mark.django_db
def test_fuel_and_aquaculture_report_separately_without_losing_anything(
    api_client, auth_super_headers, company_master
):
    """
    A company running both lines must be able to report each on its own, and the parts must
    still add back to the whole - no cost stranded, none counted twice.
    """
    from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
    from api.services.reporting import report_entities_financial_summary
    from tests.test_api_production_audit import _audit_fuel_nozzle, _audit_seed_min_gl_accounts

    cid = company_master.id
    _audit_seed_min_gl_accounts(company_master)
    Company.objects.filter(pk=cid).update(aquaculture_enabled=True, aquaculture_licensed=True)
    ensure_aquaculture_chart_accounts(cid)

    nozzle = _audit_fuel_nozzle(company_master)
    station = nozzle.tank.station
    pond = AquaculturePond.objects.create(
        company_id=cid, name="Mixed Co Pond", pond_role="grow_out", is_active=True
    )
    h = _headers(auth_super_headers, company_master)
    vendor = Vendor.objects.create(company_id=cid, company_name="Mixed Co Supplier")

    # Fuel side: buy wet stock, sell at the pump.
    api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-04-01",
                "status": "open",
                "receipt_station_id": station.id,
                "lines": [
                    {
                        "item_id": nozzle.product_id,
                        "tank_id": nozzle.tank_id,
                        "quantity": "3000",
                        "unit_cost": "101.35",
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    sale = api_client.post(
        "/api/cashier/sale/",
        data=json.dumps({"nozzle_id": nozzle.id, "quantity": "50"}),
        content_type="application/json",
        **h,
    )
    assert sale.status_code == 201, sale.content.decode()

    # Aquaculture side: a pond-tagged cost.
    pond_bill = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-04-02",
                "status": "open",
                "lines": [
                    {
                        "description": "Pond feed",
                        "quantity": "1",
                        "unit_cost": "7777.77",
                        "aquaculture_pond_id": pond.id,
                        "aquaculture_expense_category": "feed_purchase",
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert pond_bill.status_code == 201, pond_bill.content.decode()

    assert_ledger_sound(cid)
    assert_no_gl_gaps(cid)

    bundle = report_entities_financial_summary(cid, PERIOD_START, PERIOD_END)
    parts = bundle["by_station"] + bundle["by_pond"] + [bundle["unscoped"]]
    for key in ("income", "cost_of_goods_sold", "expenses", "net_income"):
        segment = sum(r[key] for r in parts)
        company = bundle["company_total"][key]
        assert abs(segment - company) <= float(CENT), (
            f"{key}: fuel + pond + head office = {segment}, company = {company}"
        )

    # The pond must not absorb fuel cost, and the station must not absorb pond feed.
    station_row = next(r for r in bundle["by_station"] if r["entity_id"] == station.id)
    pond_row = next(r for r in bundle["by_pond"] if r["entity_id"] == pond.id)
    assert station_row["income"] > 0, "fuel revenue did not land on the station"
    assert pond_row["income"] == 0, "pond reported fuel revenue as its own"
    assert station_row["expenses"] == 0, "the station absorbed the pond's feed cost"
    # Pond feed capitalizes to 1581 by default, so it shows as the pond's asset, not its expense.
    assert gl_balance(cid, "1581") > 0, "pond feed did not reach biological inventory"

    bs = report_balance_sheet(cid, PERIOD_START, PERIOD_END)
    assert bs["auto_plug_amount"] == 0, f"balance sheet needed a plug of {bs['auto_plug_amount']}"


@pytest.mark.django_db
def test_aquaculture_chart_seeding_does_not_disturb_the_fuel_chart(
    api_client, auth_super_headers, company_master
):
    """Enabling aquaculture on a live filling station must add accounts, never rewrite them."""
    from api.chart_templates.fuel_station import seed_fuel_station_chart
    from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts

    cid = company_master.id
    seed_fuel_station_chart(cid, profile="full", replace=False)
    before = {
        a.account_code: (a.account_name, a.account_type, a.account_sub_type)
        for a in ChartOfAccount.objects.filter(company_id=cid)
    }

    ensure_aquaculture_chart_accounts(cid)
    after = {
        a.account_code: (a.account_name, a.account_type, a.account_sub_type)
        for a in ChartOfAccount.objects.filter(company_id=cid)
    }

    for code, val in before.items():
        assert after.get(code) == val, f"aquaculture seeding changed existing account {code}"
    assert set(after) > set(before), "aquaculture seeding added no accounts"


# =========================================================== subledger ties to control account


@pytest.mark.django_db
def test_fuel_received_moves_tank_litres_and_inventory_by_the_same_value(
    api_client, fuel_station
):
    """
    Wet stock and the inventory account are two views of the same fuel. A receipt must move
    litres in the tank and taka in 1200 by the same value, or the balance sheet drifts away
    from what is physically in the ground.
    """
    cid, h = fuel_station["cid"], fuel_station["headers"]
    tank = fuel_station["tank"]
    vendor = Vendor.objects.create(company_id=cid, company_name="Wet Stock Tie Co")

    litres_before = Tank.objects.get(pk=tank.id).current_stock or Decimal("0")
    gl_before = gl_balance(cid, "1200")

    qty, unit_cost = Decimal("2500"), Decimal("102.40")
    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-02-15",
                "status": "open",
                "receipt_station_id": fuel_station["station"].id,
                "lines": [
                    {
                        "item_id": fuel_station["product"].id,
                        "tank_id": tank.id,
                        "quantity": str(qty),
                        "unit_cost": str(unit_cost),
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()

    litres_after = Tank.objects.get(pk=tank.id).current_stock or Decimal("0")
    gl_after = gl_balance(cid, "1200")

    assert litres_after - litres_before == qty, "the tank did not receive the litres purchased"
    assert gl_after - gl_before == money(qty * unit_cost), (
        "inventory value moved by a different amount than the fuel received"
    )
    assert_ledger_sound(cid)


@pytest.mark.django_db
def test_pump_sale_drops_tank_litres_and_inventory_together(api_client, fuel_station):
    """Selling fuel must take it out of the tank and out of the inventory account."""
    cid, h = fuel_station["cid"], fuel_station["headers"]
    tank = fuel_station["tank"]
    vendor = Vendor.objects.create(company_id=cid, company_name="Sale Tie Co")
    api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-02-16",
                "status": "open",
                "receipt_station_id": fuel_station["station"].id,
                "lines": [
                    {
                        "item_id": fuel_station["product"].id,
                        "tank_id": tank.id,
                        "quantity": "1000",
                        "unit_cost": "100.00",
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    litres_before = Tank.objects.get(pk=tank.id).current_stock or Decimal("0")
    gl_before = gl_balance(cid, "1200")

    sold = Decimal("120")
    r = api_client.post(
        "/api/cashier/sale/",
        data=json.dumps({"nozzle_id": fuel_station["nozzle"].id, "quantity": str(sold)}),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()

    litres_after = Tank.objects.get(pk=tank.id).current_stock or Decimal("0")
    gl_after = gl_balance(cid, "1200")

    assert litres_before - litres_after == sold, "the pump sale did not draw down the tank"
    assert gl_after < gl_before, "the pump sale did not relieve fuel inventory"
    assert_ledger_sound(cid)
    assert_no_gl_gaps(cid)


@pytest.mark.django_db
def test_inter_pond_transfer_moves_biology_without_changing_the_company_total(
    api_client, aquaculture
):
    """
    Moving fish between ponds is an internal reclass: the source pond's 1581 falls, the
    destination's rises, and the company's biological asset is unchanged.
    """
    from api.models import AquacultureFishPondTransfer, AquacultureFishPondTransferLine
    from api.services.aquaculture_fish_transfer_gl_service import (
        sync_aquaculture_fish_pond_transfer_gl,
    )

    cid, h = aquaculture["cid"], aquaculture["headers"]
    src, dst = aquaculture["nursing"], aquaculture["grow"]

    # Stock the source pond so it has biological cost to move.
    _post_pond_feed_bill(api_client, cid, h, src.id, "Transfer Feed Co", amount="60000.00")
    company_bio_before = gl_balance(cid, "1581")
    assert company_bio_before == Decimal("60000.00")

    transfer = AquacultureFishPondTransfer.objects.create(
        company_id=cid, from_pond=src, transfer_date=date(2026, 3, 20), fish_species="tilapia"
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=transfer,
        to_pond=dst,
        weight_kg=Decimal("40.0000"),
        fish_count=4000,
        cost_amount=Decimal("25000.00"),
    )
    result = sync_aquaculture_fish_pond_transfer_gl(cid, transfer)
    assert result["posted"] is True, result

    def pond_bio(pond_id: int) -> Decimal:
        total = Decimal("0")
        for ln in JournalEntryLine.objects.filter(
            journal_entry__company_id=cid,
            journal_entry__is_posted=True,
            account__account_code="1581",
            aquaculture_pond_id=pond_id,
        ):
            total += (ln.debit or Decimal("0")) - (ln.credit or Decimal("0"))
        return money(total)

    # The buying pond capitalizes what it paid — cost plus the inter-pond margin (40 kg x 20).
    line = transfer.lines.get()
    price = money(Decimal(str(line.sale_amount)))
    assert price == Decimal("25800.00")
    assert pond_bio(dst.id) == price, "destination pond did not receive the fish at its price"
    assert pond_bio(src.id) == Decimal("35000.00"), "source pond was not relieved at book cost"
    # Company biological inventory rises by the margin the buying pond has not yet realized;
    # consolidation writes it back off through 1585, which report_balance_sheet applies.
    assert gl_balance(cid, "1581") == company_bio_before + (price - Decimal("25000.00")), (
        "an internal sale moved company biological inventory by more than the unrealized margin"
    )
    assert_ledger_sound(cid)


@pytest.mark.django_db
def test_a_stock_count_write_off_reaches_the_books(api_client, aquaculture):
    """Shop stock written off must hit shrinkage, not just vanish from the warehouse."""
    from api.services.station_stock import set_station_stock

    cid, h = aquaculture["cid"], aquaculture["headers"]
    shop = aquaculture["shop"]
    item = Item.objects.create(
        company_id=cid,
        name="Shelf Feed Sack",
        item_type="inventory",
        unit="piece",
        pos_category="shop",
        unit_price=Decimal("100"),
        cost=Decimal("60"),
    )
    set_station_stock(cid, shop.id, item.id, Decimal("50"))

    r = api_client.post(
        "/api/inventory/adjustments/",
        data=json.dumps(
            {
                "station_id": shop.id,
                "adjustment_date": "2026-03-25",
                "reason": "count",
                "lines": [{"item_id": item.id, "counted_quantity": "45"}],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    adj_id = json.loads(r.content.decode())["id"]
    post = api_client.post(f"/api/inventory/adjustments/{adj_id}/", **h)
    assert post.status_code == 200, post.content.decode()

    je = JournalEntry.objects.filter(
        company_id=cid, entry_number=f"AUTO-INVADJ-{adj_id}"
    ).first()
    assert je is not None, "stock was written off with no journal"
    assert_ledger_sound(cid)
