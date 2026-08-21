"""
The accounting period close: once ``Company.books_locked_through`` is set, GL activity dated
on or before it is final — nothing posts, edits, unposts or deletes into it — while reads keep
working, including the income statement's self-healing COGS backfill.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.exceptions import GlPostingError
from api.models import (
    Bill,
    ChartOfAccount,
    Company,
    Customer,
    Invoice,
    InvoiceLine,
    JournalEntry,
    JournalEntryLine,
    Station,
    Vendor,
)
from api.services.accounting_period_lock import (
    assert_period_open,
    books_lock_date,
    is_period_locked,
    period_lock_error,
)
from api.services.document_posting_lifecycle import (
    assert_bill_edit_allowed,
    assert_invoice_edit_allowed,
)
from api.services.gl_posting import (
    _create_posted_entry,
    backfill_invoice_cogs_journals,
    cleanup_invoice_posting_effects,
)

LOCK = date(2026, 6, 30)
CLOSED = date(2026, 5, 15)
OPEN = date(2026, 7, 15)


@pytest.fixture
def locked_company(company_tenant_with_gl):
    Company.objects.filter(pk=company_tenant_with_gl.id).update(books_locked_through=LOCK)
    company_tenant_with_gl.refresh_from_db()
    return company_tenant_with_gl


def test_lock_date_is_inclusive_and_optional(locked_company):
    cid = locked_company.id
    assert books_lock_date(cid) == LOCK
    assert is_period_locked(cid, CLOSED) is True
    assert is_period_locked(cid, LOCK) is True, "the closing date itself is closed"
    assert is_period_locked(cid, OPEN) is False
    assert is_period_locked(cid, None) is False
    assert period_lock_error(cid, OPEN) is None
    msg = period_lock_error(cid, CLOSED, action="post")
    assert "2026-06-30" in msg and "2026-05-15" in msg


@pytest.mark.django_db
def test_open_books_never_block(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    assert books_lock_date(cid) is None
    assert is_period_locked(cid, date(1999, 1, 1)) is False
    assert_period_open(cid, date(1999, 1, 1))  # must not raise


@pytest.mark.django_db
def test_no_journal_posts_into_a_closed_period(locked_company):
    cid = locked_company.id
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")
    income = ChartOfAccount.objects.get(company_id=cid, account_code="4200")
    lines = [(cash, Decimal("100.00"), Decimal("0"), "x"), (income, Decimal("0"), Decimal("100.00"), "x")]

    with pytest.raises(GlPostingError) as exc:
        _create_posted_entry(cid, CLOSED, "TEST-LOCKED", "in a closed period", lines)
    assert "books are locked through 2026-06-30" in exc.value.detail
    assert not JournalEntry.objects.filter(company_id=cid, entry_number="TEST-LOCKED").exists()

    je = _create_posted_entry(cid, OPEN, "TEST-OPEN", "in an open period", lines)
    assert je is not None and je.is_posted


@pytest.mark.django_db
def test_reposting_an_existing_journal_is_not_new_activity(locked_company):
    """Idempotent re-posts must stay idempotent — they add nothing to a closed period."""
    cid = locked_company.id
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")
    income = ChartOfAccount.objects.get(company_id=cid, account_code="4200")
    je = JournalEntry.objects.create(
        company_id=cid, entry_number="AUTO-ALREADY-THERE", entry_date=CLOSED,
        description="posted before the close", is_posted=True,
    )
    JournalEntryLine.objects.create(journal_entry=je, account=cash, debit=Decimal("5.00"), credit=Decimal("0"))
    JournalEntryLine.objects.create(journal_entry=je, account=income, debit=Decimal("0"), credit=Decimal("5.00"))

    again = _create_posted_entry(
        cid, CLOSED, "AUTO-ALREADY-THERE", "same entry again",
        [(cash, Decimal("5.00"), Decimal("0"), "x"), (income, Decimal("0"), Decimal("5.00"), "x")],
    )
    assert again is not None and again.id == je.id
    assert JournalEntry.objects.filter(company_id=cid, entry_number="AUTO-ALREADY-THERE").count() == 1


@pytest.mark.django_db
def test_documents_in_a_closed_period_cannot_be_edited_or_deleted(locked_company):
    cid = locked_company.id
    cust = Customer.objects.create(company_id=cid, display_name="Closed Co", customer_number="C-CL")
    station = Station.objects.create(company_id=cid, station_name="Site", is_active=True)
    inv = Invoice.objects.create(
        company_id=cid, customer=cust, station=station, invoice_number="INV-CLOSED",
        invoice_date=CLOSED, status="sent", subtotal=Decimal("100.00"), total=Decimal("100.00"),
    )
    ok, err = assert_invoice_edit_allowed(cid, inv)
    assert ok is False and "period is closed" in err

    ok_del, err_del = cleanup_invoice_posting_effects(cid, inv)
    assert ok_del is False and "period is closed" in err_del

    vendor = Vendor.objects.create(company_id=cid, company_name="V", display_name="V", vendor_number="V-CL")
    bill = Bill.objects.create(
        company_id=cid, vendor=vendor, bill_number="BILL-CLOSED", bill_date=CLOSED,
        status="open", subtotal=Decimal("50.00"), total=Decimal("50.00"),
    )
    ok_b, err_b = assert_bill_edit_allowed(bill)
    assert ok_b is False and "period is closed" in err_b


@pytest.mark.django_db
def test_documents_in_an_open_period_are_unaffected(locked_company):
    cid = locked_company.id
    cust = Customer.objects.create(company_id=cid, display_name="Open Co", customer_number="C-OP")
    inv = Invoice.objects.create(
        company_id=cid, customer=cust, invoice_number="INV-OPEN", invoice_date=OPEN,
        status="sent", subtotal=Decimal("100.00"), total=Decimal("100.00"),
    )
    ok, err = assert_invoice_edit_allowed(cid, inv)
    assert ok is True, err


@pytest.mark.django_db
def test_the_self_healing_cogs_backfill_skips_closed_periods_instead_of_failing(locked_company):
    """A report repairs postings while it renders; it must never fail or reopen a closed period."""
    cid = locked_company.id
    cust = Customer.objects.create(company_id=cid, display_name="Heal Co", customer_number="C-HEAL")
    station = Station.objects.create(company_id=cid, station_name="Heal Site", is_active=True)
    inv = Invoice.objects.create(
        company_id=cid, customer=cust, station=station, invoice_number="INV-HEAL",
        invoice_date=CLOSED, status="sent", subtotal=Decimal("100.00"), total=Decimal("100.00"),
    )
    InvoiceLine.objects.create(
        invoice=inv, description="thing", quantity=Decimal("1"),
        unit_price=Decimal("100.00"), amount=Decimal("100.00"),
    )
    stats = backfill_invoice_cogs_journals(cid, date(2026, 1, 1), LOCK)
    assert stats["skipped_period_locked"] >= 1
    assert stats["posted"] == 0
    assert not JournalEntry.objects.filter(
        company_id=cid, entry_number="AUTO-INV-%d-COGS" % inv.id
    ).exists()


@pytest.mark.django_db
def test_manual_journal_cannot_be_posted_or_unposted_in_a_closed_period(
    locked_company, api_client, auth_admin_headers
):
    cid = locked_company.id
    h = {**auth_admin_headers, "HTTP_X_COMPANY_ID": str(cid)}
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")
    income = ChartOfAccount.objects.get(company_id=cid, account_code="4200")
    draft = JournalEntry.objects.create(
        company_id=cid, entry_number="MANUAL-CLOSED", entry_date=CLOSED,
        description="manual", is_posted=False,
    )
    JournalEntryLine.objects.create(journal_entry=draft, account=cash, debit=Decimal("10.00"), credit=Decimal("0"))
    JournalEntryLine.objects.create(journal_entry=draft, account=income, debit=Decimal("0"), credit=Decimal("10.00"))

    r = api_client.post("/api/journal-entries/%d/post/" % draft.id, **h)
    assert r.status_code == 409, r.content.decode()
    assert b"period is closed" in r.content
    draft.refresh_from_db()
    assert draft.is_posted is False

    posted = JournalEntry.objects.create(
        company_id=cid, entry_number="MANUAL-CLOSED-2", entry_date=CLOSED,
        description="already posted", is_posted=True,
    )
    r2 = api_client.post(
        "/api/journal-entries/%d/unpost/" % posted.id, data="{}", content_type="application/json", **h
    )
    assert r2.status_code == 409, r2.content.decode()
    posted.refresh_from_db()
    assert posted.is_posted is True


@pytest.mark.django_db
def test_balance_sheet_reports_a_material_tie_out_instead_of_absorbing_it(company_tenant_with_gl):
    """
    The Σ-ADJ line keeps the columns footing, but it must never make a broken sheet read
    as balanced. A one-sided opening balance is the classic way this happens.
    """
    from api.services.reporting import report_balance_sheet

    cid = company_tenant_with_gl.id
    clean = report_balance_sheet(cid, date(2026, 1, 1), date(2026, 12, 31))
    assert clean["is_balanced"] is True
    assert clean["auto_plug_amount"] == 0.0

    ChartOfAccount.objects.filter(company_id=cid, account_code="1030").update(
        opening_balance=Decimal("5000.00"), opening_balance_date=date(2026, 1, 1)
    )
    broken = report_balance_sheet(cid, date(2026, 1, 1), date(2026, 12, 31))
    assert broken["auto_plug_amount"] == 5000.0
    assert broken["auto_plug_is_material"] is True
    assert broken["is_balanced"] is False, "a 5,000 residual is not rounding"
    assert "does NOT balance" in broken["accounting_note"]
    plug_line = [a for a in broken["equity"]["accounts"] if a.get("is_auto_plug")]
    assert plug_line and plug_line[0]["is_material"] is True


@pytest.mark.django_db
def test_a_rounding_residual_still_ties_out_quietly(company_tenant_with_gl):
    from api.services.reporting import report_balance_sheet

    cid = company_tenant_with_gl.id
    ChartOfAccount.objects.filter(company_id=cid, account_code="1030").update(
        opening_balance=Decimal("0.05"), opening_balance_date=date(2026, 1, 1)
    )
    out = report_balance_sheet(cid, date(2026, 1, 1), date(2026, 12, 31))
    assert out["auto_plug_amount"] == 0.05
    assert out["auto_plug_is_material"] is False
    assert out["is_balanced"] is True
    assert "does NOT balance" not in out["accounting_note"]
