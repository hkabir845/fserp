"""Wave C control gaps: numbering, party visibility, disbursement retries, chart integrity.

See `docs/ACCOUNTING_AUDIT_BACKLOG.md` (A1-4, A1-6, A1-8, A1-14).
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


# ------------------------------------------------- A1-6: a document number is never reissued


def test_a_deleted_invoice_number_is_never_reissued(company_tenant):
    """A tax-invoice series must be monotonic: reusing INV-2 makes two documents
    indistinguishable in the audit trail for ever."""
    from api.models import Customer, Invoice
    from api.services.reference_code import next_available_code, next_sequential_code

    cid = company_tenant.id
    cust = Customer.objects.create(
        company_id=cid, customer_number="C-SEQ", display_name="Series Co", is_active=True
    )
    for n in (1, 2, 3):
        Invoice.objects.create(
            company_id=cid,
            customer=cust,
            invoice_number=f"INV-{n}",
            invoice_date=date(2026, 5, 1),
            status="draft",
            total=Decimal("10"),
        )
    Invoice.objects.filter(company_id=cid, invoice_number="INV-2").delete()

    assert next_sequential_code(cid, Invoice, "invoice_number", "INV") == "INV-4"
    # The gap-filling allocator is still available, and still wrong for this job.
    assert next_available_code(cid, Invoice, "invoice_number", "INV") == "INV-2"


def test_the_sequential_allocator_starts_at_one_on_an_empty_series(company_tenant):
    from api.models import Invoice
    from api.services.reference_code import next_sequential_code

    assert next_sequential_code(company_tenant.id, Invoice, "invoice_number", "INV") == "INV-1"


def test_odd_shaped_existing_codes_do_not_break_the_allocator(company_tenant):
    """Codes like INV-7~DUP2 (left by the journal de-duplication migration) must be ignored,
    not crash the integer cast."""
    from api.models import Customer, Invoice
    from api.services.reference_code import next_sequential_code

    cid = company_tenant.id
    cust = Customer.objects.create(
        company_id=cid, customer_number="C-ODD", display_name="Odd Co", is_active=True
    )
    for num in ("INV-7", "INV-7~DUP2", "INV-DRAFT", ""):
        Invoice.objects.create(
            company_id=cid,
            customer=cust,
            invoice_number=num,
            invoice_date=date(2026, 5, 1),
            status="draft",
            total=Decimal("10"),
        )
    assert next_sequential_code(cid, Invoice, "invoice_number", "INV") == "INV-8"


# ------------------------- A1-14: a deactivated party still owing money stays on the reports


def test_a_deactivated_customer_with_an_open_invoice_stays_in_the_subledger(company_tenant):
    """Dropping them left GL 1100 disagreeing with the customer list, with no traceable cause."""
    from api.models import Customer, Invoice
    from api.services.reporting import report_ar_aging

    cid = company_tenant.id
    cust = Customer.objects.create(
        company_id=cid, customer_number="C-OFF", display_name="Closed Account", is_active=True
    )
    Invoice.objects.create(
        company_id=cid,
        customer=cust,
        invoice_number="INV-OFF-1",
        invoice_date=date(2026, 5, 1),
        due_date=date(2026, 5, 31),
        status="sent",
        subtotal=Decimal("2500"),
        total=Decimal("2500"),
    )
    cust.is_active = False
    cust.save(update_fields=["is_active"])

    aging = report_ar_aging(cid, date(2026, 1, 1), date(2026, 12, 31))
    names = [r["display_name"] for r in aging["customers"]]
    assert any("Closed Account" in n for n in names), (
        "a customer who still owes money cannot vanish from A/R aging just because they were "
        "deactivated — the invoice is still in the ledger"
    )


def test_a_deactivated_customer_who_owes_nothing_is_still_omitted(company_tenant):
    from api.models import Customer
    from api.services.reporting import report_ar_aging

    cid = company_tenant.id
    Customer.objects.create(
        company_id=cid,
        customer_number="C-QUIET",
        display_name="Dormant Account",
        is_active=False,
    )
    aging = report_ar_aging(cid, date(2026, 1, 1), date(2026, 12, 31))
    names = [r["display_name"] for r in aging["customers"]]
    assert not any("Dormant" in n for n in names)


# --------------------------------- A1-4: a retried disbursement must not pay the vendor twice


def test_a_retried_vendor_payment_does_not_pay_twice(
    api_client, auth_super_headers, company_tenant
):
    from api.models import Payment, Vendor

    cid = company_tenant.id
    _acc(cid, "1010", "Cash", "asset", "cash_on_hand")
    _acc(cid, "2000", "Accounts Payable", "liability", "accounts_payable")

    vendor = Vendor.objects.create(
        company_id=cid, vendor_number="V-IDEM", display_name="Feed Mill", is_active=True
    )
    headers = dict(auth_super_headers)
    headers["HTTP_X_SELECTED_COMPANY_ID"] = str(cid)
    headers["HTTP_IDEMPOTENCY_KEY"] = "retry-me-once"

    payload = {"vendor_id": vendor.id, "amount": "5000", "payment_date": "2026-05-01"}
    first = api_client.post(
        "/api/payments/made/",
        data=payload,
        content_type="application/json",
        **headers,
    )
    assert first.status_code == 201, first.content.decode()

    second = api_client.post(
        "/api/payments/made/",
        data=payload,
        content_type="application/json",
        **headers,
    )
    assert second.status_code == 200, second.content.decode()
    assert second.json()["id"] == first.json()["id"], "the retry must return the first payment"
    assert Payment.objects.filter(company_id=cid, payment_type="made").count() == 1, (
        "a client timeout on a slow disbursement used to pay the vendor a second time"
    )


# --------------------------- A1-8: deleting a chart account cannot take journal lines with it


def test_a_chart_account_with_journal_lines_cannot_be_deleted_at_the_db_level(company_tenant):
    """The API already refuses; this is the same rule where the API cannot reach."""
    from django.db.models import ProtectedError

    from api.models import JournalEntry, JournalEntryLine

    cid = company_tenant.id
    cash = _acc(cid, "1010", "Cash", "asset", "cash_on_hand")
    cap = _acc(cid, "3000", "Owner Capital", "equity", "owners_equity")
    je = JournalEntry.objects.create(
        company_id=cid,
        entry_number="TEST-PROTECT",
        entry_date=date(2026, 5, 1),
        description="protect",
        is_posted=True,
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=cash, debit=Decimal("100"), credit=Decimal("0")
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=cap, debit=Decimal("0"), credit=Decimal("100")
    )

    with pytest.raises(ProtectedError):
        cash.delete()
    assert JournalEntryLine.objects.filter(journal_entry=je).count() == 2, (
        "a cascade delete would have silently unbalanced this entry"
    )


# ------------------ A1-3: duplicate allocation rows for one document must not double-pay it


def test_two_allocation_rows_for_the_same_invoice_are_summed_not_checked_separately(
    api_client, auth_super_headers, company_tenant
):
    """Each row used to be validated against the same open balance, so 100 + 100 against a
    100 invoice both passed — and the second allocation insert then hit
    unique_together(payment, invoice) as an uncaught IntegrityError: a 500."""
    from api.models import Customer, Invoice, Payment

    cid = company_tenant.id
    _acc(cid, "1010", "Cash", "asset", "cash_on_hand")
    _acc(cid, "1100", "Accounts Receivable", "asset", "accounts_receivable")

    cust = Customer.objects.create(
        company_id=cid, customer_number="C-DUP", display_name="House Account", is_active=True
    )
    inv = Invoice.objects.create(
        company_id=cid,
        customer=cust,
        invoice_number="INV-DUP-1",
        invoice_date=date(2026, 5, 1),
        status="sent",
        subtotal=Decimal("100"),
        total=Decimal("100"),
    )
    headers = dict(auth_super_headers)
    headers["HTTP_X_SELECTED_COMPANY_ID"] = str(cid)

    r = api_client.post(
        "/api/payments/received/",
        data={
            "customer_id": cust.id,
            "amount": "200",
            "payment_date": "2026-05-02",
            "invoice_allocations": [
                {"invoice_id": inv.id, "allocated_amount": "100"},
                {"invoice_id": inv.id, "allocated_amount": "100"},
            ],
        },
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 400, r.content.decode()
    assert "exceeds balance" in r.content.decode()
    assert not Payment.objects.filter(company_id=cid).exists()


def test_split_allocation_rows_that_do_fit_are_still_accepted(
    api_client, auth_super_headers, company_tenant
):
    """Aggregating must not break a legitimate split across two rows of the same invoice."""
    from api.models import Customer, Invoice, PaymentInvoiceAllocation

    cid = company_tenant.id
    _acc(cid, "1010", "Cash", "asset", "cash_on_hand")
    _acc(cid, "1100", "Accounts Receivable", "asset", "accounts_receivable")

    cust = Customer.objects.create(
        company_id=cid, customer_number="C-SPLIT", display_name="House Account", is_active=True
    )
    inv = Invoice.objects.create(
        company_id=cid,
        customer=cust,
        invoice_number="INV-SPLIT-1",
        invoice_date=date(2026, 5, 1),
        status="sent",
        subtotal=Decimal("100"),
        total=Decimal("100"),
    )
    headers = dict(auth_super_headers)
    headers["HTTP_X_SELECTED_COMPANY_ID"] = str(cid)

    r = api_client.post(
        "/api/payments/received/",
        data={
            "customer_id": cust.id,
            "amount": "100",
            "payment_date": "2026-05-02",
            "invoice_allocations": [
                {"invoice_id": inv.id, "allocated_amount": "60"},
                {"invoice_id": inv.id, "allocated_amount": "40"},
            ],
        },
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 201, r.content.decode()
    allocs = PaymentInvoiceAllocation.objects.filter(invoice_id=inv.id)
    assert allocs.count() == 1, "the two rows collapse into one allocation for the invoice"
    assert allocs.first().amount == Decimal("100.00")
