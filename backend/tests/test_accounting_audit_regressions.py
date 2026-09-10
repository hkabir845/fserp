"""Regressions for accounting defects found in the September 2026 books audit.

Each test pins one rule that was being broken silently. They are grouped by the module that
was wrong, not by feature, because the failures all shared a shape: a document, a subledger or
a report moved without the ledger moving with it.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

pytestmark = pytest.mark.django_db


def _station(company_id, label="Main Site"):
    from api.models import Station

    return Station.objects.create(
        company_id=company_id, station_name=label, is_active=True
    )


def _acc(company_id, code, name, typ, sub=""):
    from api.models import ChartOfAccount

    return ChartOfAccount.objects.get_or_create(
        company_id=company_id,
        account_code=code,
        defaults={
            "account_name": name,
            "account_type": typ,
            "account_sub_type": sub,
            "is_active": True,
        },
    )[0]


# --------------------------------------------------------------- output VAT is a liability


def test_invoice_tax_is_never_recognised_as_revenue(company_tenant):
    """Tax collected on a sale is owed to the authority, not earned.

    The VAT account used to be looked up with a plain read: when it was missing the tax line
    was dropped and the journal's balancing pass added the whole tax amount to a revenue
    account. Revenue was overstated and no liability was ever recorded.
    """
    from api.models import Customer, Invoice, InvoiceLine, JournalEntryLine
    from api.services.gl_posting import CODE_VAT, sync_invoice_gl

    cid = company_tenant.id
    _acc(cid, "1010", "Cash", "asset", "cash_on_hand")
    _acc(cid, "4200", "Shop Sales", "income", "sales_of_product_income")
    # Deliberately do NOT create 2100 — this is the case that used to mispost.

    site = _station(cid, "VAT Site")
    cust = Customer.objects.create(
        company_id=cid, customer_number="C-VAT", display_name="Walk-in", is_active=True
    )
    inv = Invoice.objects.create(
        company_id=cid,
        customer=cust,
        station=site,
        invoice_number="INV-VAT-1",
        invoice_date=date(2026, 5, 1),
        status="paid",
        subtotal=Decimal("1000.00"),
        tax_total=Decimal("150.00"),
        total=Decimal("1150.00"),
        payment_method="cash",
    )
    InvoiceLine.objects.create(
        invoice=inv,
        description="Shop goods",
        quantity=Decimal("1"),
        unit_price=Decimal("1000.00"),
        amount=Decimal("1000.00"),
    )
    sync_invoice_gl(cid, inv, payment_method="cash")

    lines = JournalEntryLine.objects.filter(
        journal_entry__company_id=cid, journal_entry__entry_number=f"AUTO-INV-{inv.id}-SALE"
    ).select_related("account")
    by_code = {l.account.account_code: l for l in lines}

    assert CODE_VAT in by_code, "the tax must reach a VAT payable account, not vanish"
    assert by_code[CODE_VAT].credit == Decimal("150.00")
    assert by_code[CODE_VAT].account.account_type == "liability"
    # Revenue is the net of tax, not the gross.
    assert by_code["4200"].credit == Decimal("1000.00")


# ------------------------------------------------------- a voided sale is not a receivable


def test_void_invoice_is_not_open_receivable(company_tenant):
    from api.models import Customer, Invoice
    from api.services.payment_allocation import invoice_open_amount

    cid = company_tenant.id
    cust = Customer.objects.create(
        company_id=cid, customer_number="C-VOID", display_name="Ledger Co", is_active=True
    )
    inv = Invoice.objects.create(
        company_id=cid,
        customer=cust,
        invoice_number="INV-VOID-1",
        invoice_date=date(2026, 5, 1),
        status="void",
        subtotal=Decimal("500.00"),
        total=Decimal("500.00"),
    )
    assert invoice_open_amount(inv, cid) == Decimal("0")


def test_void_documents_are_excluded_from_party_subledgers(company_tenant):
    """The A/R and A/P subledgers used to exclude only drafts, so a voided document — whose
    journal had correctly been removed — still showed as owed. The subledger then disagreed
    with the control account by the void amount."""
    from api.models import Customer, Invoice
    from api.services.contact_ledgers import customer_ar_balance

    cid = company_tenant.id
    cust = Customer.objects.create(
        company_id=cid, customer_number="C-VOID-2", display_name="Void Co", is_active=True
    )
    Invoice.objects.create(
        company_id=cid,
        customer=cust,
        invoice_number="INV-VOID-2",
        invoice_date=date(2026, 5, 1),
        status="void",
        subtotal=Decimal("750.00"),
        total=Decimal("750.00"),
    )
    assert customer_ar_balance(cid, cust.id) == Decimal("0")


# --------------------------------------------- drill-downs must tie to the statements above


def test_account_statement_excludes_unposted_journals(company_tenant):
    """A drill-down that counted drafts could not be reconciled to the trial balance it was
    opened from."""
    from api.models import JournalEntry, JournalEntryLine
    from api.services.journal_statement import journal_net_movement

    cid = company_tenant.id
    cash = _acc(cid, "1010", "Cash", "asset", "cash_on_hand")
    cap = _acc(cid, "3000", "Owner Capital", "equity", "owners_equity")

    for number, posted in (("TEST-POSTED", True), ("TEST-DRAFT", False)):
        je = JournalEntry.objects.create(
            company_id=cid,
            entry_number=number,
            entry_date=date(2026, 5, 1),
            description=number,
            is_posted=posted,
        )
        JournalEntryLine.objects.create(
            journal_entry=je, account=cash, debit=Decimal("100"), credit=Decimal("0")
        )
        JournalEntryLine.objects.create(
            journal_entry=je, account=cap, debit=Decimal("0"), credit=Decimal("100")
        )

    assert journal_net_movement(cash.id) == Decimal("100"), (
        "only the posted entry may move the account balance"
    )


# ------------------------------------------------- inventory is capitalized exactly once


def test_editing_an_item_after_a_vendor_receipt_does_not_recapitalize_stock(company_tenant):
    """Stock received on a vendor bill is already Dr inventory / Cr A/P.

    Items are created with zero stock, so they never get an opening-balance journal. The
    opening-stock helper's only guard was "no opening journal yet", so the first later edit of
    the item — a rename, a price change — booked the whole received quantity a second time as
    Dr inventory / Cr Opening Balance Equity.
    """
    from api.models import Bill, BillLine, Item, JournalEntry, Vendor
    from api.views.item_views import _capitalize_opening_stock_on_update

    cid = company_tenant.id
    _acc(cid, "1220", "Inventory — Shop", "asset", "inventory")
    _acc(cid, "3200", "Opening Balance Equity", "equity", "owners_equity")

    item = Item.objects.create(
        company_id=cid,
        name="Engine Oil 1L",
        unit="pcs",
        unit_price=Decimal("300"),
        cost=Decimal("200"),
        quantity_on_hand=Decimal("50"),
    )
    vendor = Vendor.objects.create(
        company_id=cid, vendor_number="V-1", display_name="Oil Supplier", is_active=True
    )
    bill = Bill.objects.create(
        company_id=cid,
        vendor=vendor,
        bill_number="BILL-OIL-1",
        bill_date=date(2026, 4, 1),
        status="open",
        subtotal=Decimal("10000"),
        total=Decimal("10000"),
        stock_receipt_applied=True,
    )
    BillLine.objects.create(
        bill=bill,
        item=item,
        description="Engine Oil 1L",
        quantity=Decimal("50"),
        unit_price=Decimal("200"),
        amount=Decimal("10000"),
    )

    _capitalize_opening_stock_on_update(cid, item)

    item.refresh_from_db()
    assert item.opening_balance_journal_id is None, (
        "stock that arrived on a vendor bill is already in the ledger; capitalizing it again "
        "overstates the inventory asset and equity by the full stock value"
    )
    assert not JournalEntry.objects.filter(
        company_id=cid, entry_number=f"AUTO-ITEM-OB-{item.id}"
    ).exists()


def test_opening_stock_still_capitalizes_for_an_item_with_no_receipt_history(company_tenant):
    """The guard must not block the case it was written for: genuine go-live opening stock."""
    from api.models import Item, JournalEntry
    from api.views.item_views import _capitalize_opening_stock_on_update

    cid = company_tenant.id
    _acc(cid, "1220", "Inventory — Shop", "asset", "inventory")
    _acc(cid, "3200", "Opening Balance Equity", "equity", "owners_equity")

    item = Item.objects.create(
        company_id=cid,
        name="Wiper Blade",
        unit="pcs",
        unit_price=Decimal("500"),
        cost=Decimal("300"),
        quantity_on_hand=Decimal("20"),
    )
    _capitalize_opening_stock_on_update(cid, item)

    item.refresh_from_db()
    assert item.opening_balance_journal_id is not None
    assert JournalEntry.objects.filter(
        company_id=cid, entry_number=f"AUTO-ITEM-OB-{item.id}"
    ).exists()


# ---------------------------------------------------- interest is expensed exactly once


def test_paying_accrued_loan_interest_clears_the_accrual_not_the_expense(company_tenant):
    """Accruing interest already recognised the expense.

    The repayment used to debit the interest expense account a second time, so interest was
    expensed twice and the accrued-interest liability grew forever without ever being settled.
    """
    from api.models import (
        Loan,
        LoanCounterparty,
        LoanInterestAccrual,
        LoanRepayment,
        JournalEntryLine,
    )
    from api.services.loan_posting import post_loan_interest_accrual, post_loan_repayment

    cid = company_tenant.id
    bank = _acc(cid, "1030", "Bank", "asset", "bank")
    principal = _acc(cid, "2400", "Loan Payable", "liability", "long_term_liability")
    interest = _acc(cid, "6800", "Interest Expense", "expense", "other_business_expenses")
    accrued = _acc(cid, "2410", "Accrued Interest Payable", "liability", "other_current_liability")

    site = _station(cid, "Loan Site")
    cp = LoanCounterparty.objects.create(
        company_id=cid, name="Test Bank", role_type="lender", is_active=True
    )
    loan = Loan.objects.create(
        company_id=cid,
        counterparty=cp,
        station=site,
        loan_no="LN-ACCR-1",
        direction=Loan.DIRECTION_BORROWED,
        sanction_amount=Decimal("100000"),
        outstanding_principal=Decimal("100000"),
        settlement_account=bank,
        principal_account=principal,
        interest_account=interest,
        interest_accrual_account=accrued,
        status="active",
    )

    accrual = LoanInterestAccrual.objects.create(
        loan=loan, accrual_date=date(2026, 5, 31), amount=Decimal("1000.00"), memo="May interest"
    )
    assert post_loan_interest_accrual(cid, accrual) is True

    repayment = LoanRepayment.objects.create(
        loan=loan,
        repayment_date=date(2026, 6, 5),
        amount=Decimal("6000.00"),
        principal_amount=Decimal("5000.00"),
        interest_amount=Decimal("1000.00"),
    )
    assert post_loan_repayment(cid, repayment) is True

    def net_debit(acc):
        rows = JournalEntryLine.objects.filter(
            journal_entry__company_id=cid, account=acc
        )
        return sum((r.debit - r.credit for r in rows), Decimal("0"))

    assert net_debit(interest) == Decimal("1000.00"), (
        "1,000 of interest was accrued and 1,000 was paid: the expense is 1,000, not 2,000"
    )
    assert net_debit(accrued) == Decimal("0.00"), (
        "paying the interest must clear the accrued liability it created"
    )


def test_loan_interest_without_a_prior_accrual_is_still_an_expense(company_tenant):
    """Cash-basis loans never accrue; their repayment interest must still hit P&L."""
    from api.models import Loan, LoanCounterparty, LoanRepayment, JournalEntryLine
    from api.services.loan_posting import post_loan_repayment

    cid = company_tenant.id
    bank = _acc(cid, "1030", "Bank", "asset", "bank")
    principal = _acc(cid, "2400", "Loan Payable", "liability", "long_term_liability")
    interest = _acc(cid, "6800", "Interest Expense", "expense", "other_business_expenses")
    accrued = _acc(cid, "2410", "Accrued Interest Payable", "liability", "other_current_liability")

    site = _station(cid, "Cash Loan Site")
    cp = LoanCounterparty.objects.create(
        company_id=cid, name="Cash Basis Bank", role_type="lender", is_active=True
    )
    loan = Loan.objects.create(
        company_id=cid,
        counterparty=cp,
        station=site,
        loan_no="LN-CASH-1",
        direction=Loan.DIRECTION_BORROWED,
        sanction_amount=Decimal("50000"),
        outstanding_principal=Decimal("50000"),
        settlement_account=bank,
        principal_account=principal,
        interest_account=interest,
        interest_accrual_account=accrued,
        status="active",
    )
    repayment = LoanRepayment.objects.create(
        loan=loan,
        repayment_date=date(2026, 6, 5),
        amount=Decimal("3000.00"),
        principal_amount=Decimal("2500.00"),
        interest_amount=Decimal("500.00"),
    )
    assert post_loan_repayment(cid, repayment) is True

    rows = JournalEntryLine.objects.filter(journal_entry__company_id=cid, account=interest)
    assert sum((r.debit - r.credit for r in rows), Decimal("0")) == Decimal("500.00")


# ------------------------------------------- an asset cannot depreciate past salvage value


def test_manual_depreciation_cannot_exceed_remaining_depreciable_value(
    api_client, auth_super_headers, company_tenant
):
    from api.models import FixedAsset

    cid = company_tenant.id
    asset_acc = _acc(cid, "1500", "Equipment", "asset", "machinery_and_equipment")
    accum_acc = _acc(cid, "1550", "Accumulated Depreciation", "asset", "accumulated_depreciation")
    dep_acc = _acc(cid, "6500", "Depreciation Expense", "expense", "other_business_expenses")

    asset = FixedAsset.objects.create(
        company_id=cid,
        station=_station(cid, "Asset Site"),
        name="Generator",
        asset_account=asset_acc,
        accumulated_depreciation_account=accum_acc,
        depreciation_expense_account=dep_acc,
        acquisition_date=date(2026, 1, 1),
        acquisition_cost=Decimal("120000"),
        salvage_value=Decimal("20000"),
        useful_life_months=60,
        depreciation_method="straight_line",
        status=FixedAsset.STATUS_ACTIVE,
    )
    headers = dict(auth_super_headers)
    headers["HTTP_X_SELECTED_COMPANY_ID"] = str(cid)

    r = api_client.post(
        f"/api/fixed-assets/{asset.id}/depreciate/",
        data={"amount": "500000", "run_date": "2026-06-30"},
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 400, r.content.decode()
    asset.refresh_from_db()
    assert asset.accumulated_depreciation == Decimal("0")
