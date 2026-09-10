"""Wave A regressions: a document must never move a subledger without moving the ledger.

Every test here pins one rule from `docs/ACCOUNTING_AUDIT_BACKLOG.md`.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

pytestmark = pytest.mark.django_db


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


# ------------------------------------------------- un-posting must unwind what posting did


def test_moving_a_posted_bill_back_to_draft_reverses_its_journal_and_ap(company_tenant):
    """Draft is excluded from the A/P subledger, so leaving the journal and the vendor bump in
    place made GL 2000 disagree with the vendor list by the bill total, with no error."""
    from api.models import Bill, JournalEntry, Station, Vendor
    from api.services.gl_posting import sync_posted_vendor_bill
    from api.views.bill_views import _bill_status_was_posted

    cid = company_tenant.id
    _acc(cid, "2000", "Accounts Payable", "liability", "accounts_payable")
    _acc(cid, "6900", "Office & Administrative", "expense", "office_general_administrative_expenses")

    site = Station.objects.create(company_id=cid, station_name="Bill Site", is_active=True)
    vendor = Vendor.objects.create(
        company_id=cid, vendor_number="V-UNPOST", display_name="Supplier", is_active=True
    )
    bill = Bill.objects.create(
        company_id=cid,
        vendor=vendor,
        receipt_station=site,
        bill_number="BILL-UNPOST-1",
        bill_date=date(2026, 5, 1),
        status="open",
        subtotal=Decimal("5000"),
        total=Decimal("5000"),
    )
    sync_posted_vendor_bill(cid, bill)
    assert JournalEntry.objects.filter(company_id=cid, entry_number=f"AUTO-BILL-{bill.id}").exists()
    bill.refresh_from_db()
    assert bill.vendor_ap_incremented is True

    assert _bill_status_was_posted("open") is True
    assert _bill_status_was_posted("draft") is False

    from api.services.gl_posting import cleanup_vendor_bill_posting_effects

    bill.status = "draft"
    bill.save(update_fields=["status"])
    cleanup_vendor_bill_posting_effects(cid, bill)

    bill.refresh_from_db()
    vendor.refresh_from_db()
    assert not JournalEntry.objects.filter(
        company_id=cid, entry_number=f"AUTO-BILL-{bill.id}"
    ).exists()
    assert bill.vendor_ap_incremented is False
    assert vendor.current_balance == Decimal("0")


def test_an_unrecognised_bill_status_is_rejected_not_downgraded_to_draft():
    """Coercing a typo to "draft" silently un-posted the bill in the subledger only."""
    from api.views.bill_views import _validated_bill_status

    st, err = _validated_bill_status("appruved", "open")
    assert st is None
    assert "not a valid bill status" in err

    st, err = _validated_bill_status("approved", "draft")
    assert (st, err) == ("open", None), "known aliases still map"

    st, err = _validated_bill_status("", "open")
    assert (st, err) == ("open", None), "blank keeps the current status"


def test_voiding_a_posted_invoice_removes_its_journals(
    api_client, auth_super_headers, company_tenant
):
    from api.models import Customer, Invoice, InvoiceLine, JournalEntry, Station

    cid = company_tenant.id
    _acc(cid, "1010", "Cash", "asset", "cash_on_hand")
    _acc(cid, "1100", "Accounts Receivable", "asset", "accounts_receivable")
    _acc(cid, "4200", "Shop Sales", "income", "sales_of_product_income")
    site = Station.objects.create(company_id=cid, station_name="Void Site", is_active=True)

    cust = Customer.objects.create(
        company_id=cid, customer_number="C-VD", display_name="House Account", is_active=True
    )
    inv = Invoice.objects.create(
        company_id=cid,
        customer=cust,
        station=site,
        invoice_number="INV-VD-1",
        invoice_date=date(2026, 5, 1),
        status="sent",
        subtotal=Decimal("1000"),
        total=Decimal("1000"),
    )
    InvoiceLine.objects.create(
        invoice=inv,
        description="Goods",
        quantity=Decimal("1"),
        unit_price=Decimal("1000"),
        amount=Decimal("1000"),
    )
    from api.services.gl_posting import sync_invoice_gl

    sync_invoice_gl(cid, inv)
    assert JournalEntry.objects.filter(company_id=cid, entry_number=f"AUTO-INV-{inv.id}-SALE").exists()
    cust.refresh_from_db()
    assert cust.current_balance == Decimal("1000")

    headers = dict(auth_super_headers)
    headers["HTTP_X_SELECTED_COMPANY_ID"] = str(cid)
    r = api_client.put(
        f"/api/invoices/{inv.id}/status/",
        data={"status": "void", "reason": "audit test void"},
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 200, r.content.decode()

    assert not JournalEntry.objects.filter(
        company_id=cid, entry_number=f"AUTO-INV-{inv.id}-SALE"
    ).exists(), "voiding an invoice must remove the revenue it recognised"
    cust.refresh_from_db()
    assert cust.current_balance == Decimal("0"), "and the A/R it created"


# ------------------------------------------------------- a closed period stays closed


def test_a_receipt_in_a_closed_period_cannot_be_reversed(company_tenant):
    from api.exceptions import GlPostingError
    from api.models import Customer, Payment
    from api.services.gl_posting import reverse_payment_received_posting

    cid = company_tenant.id
    company_tenant.books_locked_through = date(2026, 6, 30)
    company_tenant.save(update_fields=["books_locked_through"])

    cust = Customer.objects.create(
        company_id=cid, customer_number="C-LOCK", display_name="Locked Co", is_active=True
    )
    p = Payment.objects.create(
        company_id=cid,
        payment_type=Payment.PAYMENT_TYPE_RECEIVED,
        customer=cust,
        payment_date=date(2026, 5, 15),
        amount=Decimal("1000"),
    )
    with pytest.raises(GlPostingError):
        reverse_payment_received_posting(cid, p)


# ----------------------------------------- no subledger movement without a journal


def test_a_supplier_credit_that_cannot_post_does_not_reduce_ap(company_tenant, monkeypatch):
    """A/P used to fall even when the journal came back None, with no error shown."""
    from api.models import Vendor, VendorCredit
    from api.services import vendor_purchase_terms

    cid = company_tenant.id
    vendor = Vendor.objects.create(
        company_id=cid,
        vendor_number="V-CRED",
        display_name="Mill",
        is_active=True,
        current_balance=Decimal("10000"),
    )
    monkeypatch.setattr(
        vendor_purchase_terms, "_post_vendor_credit_journal", lambda *a, **k: None
    )
    credit, err = vendor_purchase_terms.create_vendor_credit(
        cid, vendor, {"amount": "2500", "credit_date": "2026-05-01"}
    )
    assert credit is None and err is not None and err.status_code == 400
    vendor.refresh_from_db()
    assert vendor.current_balance == Decimal("10000"), "no journal means no A/P movement"
    assert not VendorCredit.objects.filter(company_id=cid).exists(), (
        "and no credit row is left behind either"
    )


def test_a_supplier_credit_posts_its_journal_and_reduces_ap(company_tenant):
    """The happy path: the chart auto-provisions, so the credit always has a journal."""
    from api.models import JournalEntry, Vendor
    from api.services.vendor_purchase_terms import create_vendor_credit

    cid = company_tenant.id
    vendor = Vendor.objects.create(
        company_id=cid, vendor_number="V-CRED-OK", display_name="Mill", is_active=True
    )
    credit, err = create_vendor_credit(
        cid, vendor, {"amount": "2500", "credit_date": "2026-05-01"}
    )
    assert err is None, err.content.decode() if err else ""
    assert credit is not None

    je = JournalEntry.objects.get(company_id=cid, entry_number=f"AUTO-VCRED-{credit.id}")
    # Dr A/P 2,500 / Cr rebate income 2,500 — the credit reduces what we owe.
    assert sum((l.debit for l in je.lines.all()), Decimal("0")) == Decimal("2500")
    assert sum((l.credit for l in je.lines.all()), Decimal("0")) == Decimal("2500")

    vendor.refresh_from_db()
    # No bills, so the credit alone leaves the vendor in credit by its full amount.
    assert vendor.current_balance == Decimal("-2500.00")


def test_customer_opening_balance_posts_its_journal(
    api_client, auth_super_headers, company_tenant
):
    """An opening entered on the ordinary Customers screen used to post nothing at all."""
    from api.models import Customer, JournalEntry

    cid = company_tenant.id
    _acc(cid, "1100", "Accounts Receivable", "asset", "accounts_receivable")
    _acc(cid, "3200", "Opening Balance Equity", "equity", "owners_equity")

    headers = dict(auth_super_headers)
    headers["HTTP_X_SELECTED_COMPANY_ID"] = str(cid)
    r = api_client.post(
        "/api/customers/",
        data={
            "display_name": "Opening Co",
            "opening_balance": "4000.00",
            "opening_balance_date": "2026-01-01",
        },
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 201, r.content.decode()
    cust = Customer.objects.get(company_id=cid, display_name="Opening Co")
    je = JournalEntry.objects.filter(
        company_id=cid, entry_number=f"AUTO-CUST-OB-{cust.id}"
    ).first()
    assert je is not None, "an opening receivable must reach the ledger"
    assert sum((l.debit for l in je.lines.all()), Decimal("0")) == Decimal("4000.00")


def test_changing_a_customer_opening_balance_reposts_the_journal(company_tenant):
    """The journal used to keep the first figure forever once it existed."""
    from api.models import Customer, JournalEntry
    from api.services.party_opening_gl import apply_customer_opening_gl

    cid = company_tenant.id
    _acc(cid, "1100", "Accounts Receivable", "asset", "accounts_receivable")
    _acc(cid, "3200", "Opening Balance Equity", "equity", "owners_equity")

    cust = Customer.objects.create(
        company_id=cid,
        customer_number="C-OB",
        display_name="Restated Co",
        is_active=True,
        opening_balance=Decimal("1000.00"),
        opening_balance_date=date(2026, 1, 1),
    )
    assert apply_customer_opening_gl(cid, cust) is None

    cust.opening_balance = Decimal("2500.00")
    cust.save(update_fields=["opening_balance"])
    assert apply_customer_opening_gl(cid, cust) is None

    je = JournalEntry.objects.get(company_id=cid, entry_number=f"AUTO-CUST-OB-{cust.id}")
    assert sum((l.debit for l in je.lines.all()), Decimal("0")) == Decimal("2500.00")


# --------------------------------------- stock movements are valued at cost, never retail


def test_wet_stock_variance_is_not_valued_at_the_selling_price(company_tenant):
    """A dip gain valued at retail capitalises unearned margin into the inventory asset."""
    from api.models import Item, Station, Tank, TankDip
    from api.services.gl_posting import tank_dip_variance_gl_status

    cid = company_tenant.id
    _acc(cid, "1200", "Inventory — Fuel", "asset", "inventory")
    _acc(cid, "5100", "Cost of Fuel Sold", "cost_of_goods_sold", "cost_of_goods_sold")

    diesel = Item.objects.create(
        company_id=cid,
        name="Diesel",
        unit="L",
        unit_price=Decimal("110"),  # selling price
        cost=Decimal("0"),  # no purchase cost recorded
        category="fuel",
    )
    site = Station.objects.create(company_id=cid, station_name="Fuel Site", is_active=True)
    tank = Tank.objects.create(
        company_id=cid,
        station=site,
        tank_name="T1",
        product=diesel,
        capacity=Decimal("10000"),
    )
    dip = TankDip.objects.create(
        company_id=cid,
        tank=tank,
        dip_date=date(2026, 5, 1),
        volume=Decimal("5100"),
        book_stock_before=Decimal("5000"),
    )
    status = tank_dip_variance_gl_status(cid, dip)
    assert status["posted"] is False
    assert status["skip_reason"] == "item_cost_zero", (
        "with no cost recorded the variance must be skipped, not valued at the sale price"
    )
