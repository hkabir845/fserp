"""
Ledger-wide invariants that must hold no matter which module wrote the journal.

These are the rules an accounting system is judged on: every posted entry balances, no line
carries a debit and a credit at once, money is two decimal places rounded half away from zero,
and splitting an amount never loses or invents a paisa.
"""
from __future__ import annotations

import json
from decimal import Decimal

import pytest
from django.db.models import Sum

from api.models import JournalEntry, JournalEntryLine
from api.utils.decimal_fields import fit_decimal
from api.utils.rounding import allocate, money, money_str, qty


# --------------------------------------------------------------------------- rounding


def test_money_rounds_half_away_from_zero_not_bankers():
    """Decimal's default (half-even) would give 0.00 / 1.00 / 2.68 / -0.00 here."""
    assert money("0.005") == Decimal("0.01")
    assert money("1.005") == Decimal("1.01")
    assert money("2.675") == Decimal("2.68")
    assert money("-0.005") == Decimal("-0.01")
    assert money("-1.015") == Decimal("-1.02")


def test_money_always_has_two_decimals_in_json():
    assert money_str(5) == "5.00"
    assert money_str(Decimal("5.1")) == "5.10"
    assert money_str("0") == "0.00"
    assert money_str(None) == "0.00"


def test_money_tolerates_junk_without_raising():
    assert money(None) == Decimal("0.00")
    assert money("") == Decimal("0.00")
    assert money("not a number") == Decimal("0.00")


def test_quantities_are_two_decimals_half_up():
    assert qty("12.345") == Decimal("12.35")
    assert qty("166.6667") == Decimal("166.67")


def test_fit_decimal_rounds_half_up_and_clamps():
    assert fit_decimal(Decimal("1.005"), 14, 2) == Decimal("1.01")
    # Clamped to the largest value the column can hold rather than raising on overflow.
    assert fit_decimal(Decimal("99999999999999"), 8, 2) == Decimal("999999.99")


# --------------------------------------------------------------------------- allocation


@pytest.mark.parametrize(
    "total,weights",
    [
        ("100.00", ["1", "1", "1"]),
        ("0.01", ["1", "1"]),
        ("1000.00", ["3", "5", "7", "11"]),
        ("-75.00", ["2", "1"]),
        ("33.33", ["1", "0", "2"]),
    ],
)
def test_allocate_parts_sum_exactly_to_the_total(total, weights):
    parts = allocate(Decimal(total), [Decimal(w) for w in weights])
    assert len(parts) == len(weights)
    assert sum(parts) == Decimal(total)
    assert all(p == money(p) for p in parts)


def test_allocate_with_no_weight_keeps_the_money():
    parts = allocate(Decimal("50.00"), [Decimal("0"), Decimal("0")])
    assert sum(parts) == Decimal("50.00")


# --------------------------------------------------------------------------- the ledger


def assert_ledger_is_sound(company_id: int) -> int:
    """Every posted entry balances and no line is both a debit and a credit."""
    entries = list(
        JournalEntry.objects.filter(company_id=company_id, is_posted=True).prefetch_related("lines")
    )
    for je in entries:
        lines = list(je.lines.all())
        assert lines, f"{je.entry_number} was posted with no lines"
        debit = sum((ln.debit or Decimal("0")) for ln in lines)
        credit = sum((ln.credit or Decimal("0")) for ln in lines)
        assert debit == credit, (
            f"{je.entry_number} is out of balance: debit {debit} vs credit {credit}"
        )
        assert debit > 0, f"{je.entry_number} posted a zero-value entry"
        for ln in lines:
            d = ln.debit or Decimal("0")
            c = ln.credit or Decimal("0")
            assert d >= 0 and c >= 0, f"{je.entry_number} has a negative amount"
            assert not (d > 0 and c > 0), (
                f"{je.entry_number} line {ln.id} carries a debit and a credit"
            )
            assert d == money(d) and c == money(c), (
                f"{je.entry_number} line {ln.id} is not stored at 2 decimal places"
            )
    return len(entries)


@pytest.mark.django_db
def test_pos_fuel_sale_leaves_a_balanced_ledger(api_client, auth_super_headers, company_master):
    from tests.test_api_production_audit import (
        _audit_fuel_nozzle,
        _audit_master_headers,
        _audit_seed_min_gl_accounts,
    )

    _audit_seed_min_gl_accounts(company_master)
    nozzle = _audit_fuel_nozzle(company_master)
    h = _audit_master_headers(auth_super_headers, company_master)

    r = api_client.post(
        "/api/cashier/sale/",
        data=json.dumps({"nozzle_id": nozzle.id, "quantity": "2.5"}),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    assert assert_ledger_is_sound(company_master.id) >= 1


@pytest.mark.django_db
def test_credit_invoice_and_vendor_bill_leave_a_balanced_ledger(
    api_client, auth_super_headers, company_master
):
    from api.models import Item, Vendor
    from tests.test_api_production_audit import _audit_master_headers, _audit_seed_min_gl_accounts

    cid = company_master.id
    _audit_seed_min_gl_accounts(company_master)
    h = _audit_master_headers(auth_super_headers, company_master)

    item = Item.objects.create(
        company_id=cid, name="Invariant Widget", unit_price=Decimal("33.33"), cost=Decimal("10")
    )
    api_client.post("/api/customers/add-dummy/", **h)
    cust = json.loads(api_client.get("/api/customers/", **h).content)[0]

    # An amount that does not divide evenly across three lines - the classic rounding trap.
    inv = api_client.post(
        "/api/invoices/",
        data=json.dumps(
            {
                "customer_id": cust["id"],
                "invoice_date": "2026-02-10",
                "status": "sent",
                "lines": [
                    {"item_id": item.id, "quantity": "1", "unit_price": "33.33"},
                    {"item_id": item.id, "quantity": "1", "unit_price": "33.33"},
                    {"item_id": item.id, "quantity": "1", "unit_price": "33.34"},
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert inv.status_code in (200, 201), inv.content.decode()

    vendor = Vendor.objects.create(company_id=cid, company_name="Invariant Supplies")
    bill = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor.id,
                "bill_date": "2026-02-11",
                "status": "open",
                "lines": [
                    {"description": "Odd split A", "quantity": "1", "unit_cost": "10.005"},
                    {"description": "Odd split B", "quantity": "3", "unit_cost": "3.333"},
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert bill.status_code == 201, bill.content.decode()

    assert assert_ledger_is_sound(cid) >= 2


@pytest.mark.django_db
def test_invoice_status_outside_the_lifecycle_is_rejected(
    api_client, auth_super_headers, company_master
):
    """A document must never be storable in a state the ledger cannot post."""
    from api.models import Item
    from tests.test_api_production_audit import _audit_master_headers, _audit_seed_min_gl_accounts

    cid = company_master.id
    _audit_seed_min_gl_accounts(company_master)
    h = _audit_master_headers(auth_super_headers, company_master)
    item = Item.objects.create(company_id=cid, name="Status Widget", unit_price=Decimal("10"))
    api_client.post("/api/customers/add-dummy/", **h)
    cust = json.loads(api_client.get("/api/customers/", **h).content)[0]

    r = api_client.post(
        "/api/invoices/",
        data=json.dumps(
            {
                "customer_id": cust["id"],
                "invoice_date": "2026-02-10",
                "status": "posted",  # not a lifecycle status
                "lines": [{"item_id": item.id, "quantity": "1", "unit_price": "10"}],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 400
    assert "not a valid status" in json.loads(r.content.decode())["detail"]


@pytest.mark.django_db
def test_manual_journal_accepts_a_complete_row_and_balances(
    api_client, auth_super_headers, company_master
):
    from api.models import ChartOfAccount
    from tests.test_api_production_audit import _audit_master_headers, _audit_seed_min_gl_accounts

    cid = company_master.id
    _audit_seed_min_gl_accounts(company_master)
    h = _audit_master_headers(auth_super_headers, company_master)
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")
    equity = ChartOfAccount.objects.get(company_id=cid, account_code="3200")

    r = api_client.post(
        "/api/journal-entries/",
        data=json.dumps(
            {
                "entry_date": "2026-02-12",
                "description": "owner funds the till",
                "lines": [
                    {
                        "debit_account_id": cash.id,
                        "credit_account_id": equity.id,
                        "amount": "500.00",
                    }
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code in (200, 201), r.content.decode()
    je_id = json.loads(r.content.decode())["id"]
    agg = JournalEntryLine.objects.filter(journal_entry_id=je_id).aggregate(
        d=Sum("debit"), c=Sum("credit")
    )
    assert agg["d"] == agg["c"] == Decimal("500.00")
