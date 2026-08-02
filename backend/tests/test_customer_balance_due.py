"""Customer A/R balance must match customer ledger all-time closing."""
from decimal import Decimal

import pytest

from api.models import Customer, Invoice, Payment
from api.services.contact_ledgers import build_customer_ledger, customer_ar_balance
from api.services.payment_allocation import (
    compute_customer_balance_due,
    invoice_balance_due,
    invoice_open_amount,
)


def _assert_balance_matches_ledger(company_id: int, customer_id: int) -> Decimal:
    due = compute_customer_balance_due(company_id, customer_id)
    ar = customer_ar_balance(company_id, customer_id)
    payload = build_customer_ledger(company_id, customer_id)
    closing = Decimal(payload["closing_balance_all_time"])
    profile = Decimal(payload["stored_current_balance"])
    assert due == ar == closing == profile
    return due


@pytest.mark.django_db
def test_paid_cash_invoice_has_zero_open_amount(company_tenant):
    c = Customer.objects.create(
        company_id=company_tenant.id,
        display_name="Cash buyer",
        current_balance=Decimal("0"),
    )
    inv = Invoice.objects.create(
        company_id=company_tenant.id,
        customer=c,
        invoice_number="INV-TEST-PAID",
        invoice_date="2026-05-17",
        status="paid",
        subtotal=Decimal("800"),
        tax_total=Decimal("0"),
        total=Decimal("800"),
        payment_method="cash",
    )
    assert invoice_open_amount(inv, company_tenant.id) == Decimal("0")
    assert invoice_balance_due(inv, company_tenant.id) == Decimal("0")
    assert compute_customer_balance_due(company_tenant.id, c.id) == Decimal("0")
    _assert_balance_matches_ledger(company_tenant.id, c.id)


@pytest.mark.django_db
def test_sent_invoice_counts_in_customer_balance(company_tenant):
    c = Customer.objects.create(
        company_id=company_tenant.id,
        display_name="Credit buyer",
        opening_balance=Decimal("0"),
        current_balance=Decimal("0"),
    )
    inv = Invoice.objects.create(
        company_id=company_tenant.id,
        customer=c,
        invoice_number="INV-TEST-SENT",
        invoice_date="2026-05-17",
        status="sent",
        subtotal=Decimal("500"),
        tax_total=Decimal("0"),
        total=Decimal("500"),
        payment_method="on_account",
    )
    assert invoice_balance_due(inv, company_tenant.id) == Decimal("500")
    assert compute_customer_balance_due(company_tenant.id, c.id) == Decimal("500")
    _assert_balance_matches_ledger(company_tenant.id, c.id)


@pytest.mark.django_db
def test_customer_ledger_skips_paid_cash_pos_invoice(company_tenant):
    c = Customer.objects.create(
        company_id=company_tenant.id,
        display_name="Ledger cash",
        current_balance=Decimal("0"),
    )
    Invoice.objects.create(
        company_id=company_tenant.id,
        customer=c,
        invoice_number="INV-POS-CASH",
        invoice_date="2026-05-17",
        status="paid",
        subtotal=Decimal("800"),
        tax_total=Decimal("0"),
        total=Decimal("800"),
        payment_method="cash",
    )
    payload = build_customer_ledger(company_tenant.id, c.id)
    assert payload["closing_balance_all_time"] == "0"
    assert payload["transactions"] == []
    _assert_balance_matches_ledger(company_tenant.id, c.id)


@pytest.mark.django_db
def test_opening_balance_minus_on_account_payment_matches_ledger(company_tenant):
    """On-account receipts reduce A/R even without invoice allocations."""
    c = Customer.objects.create(
        company_id=company_tenant.id,
        display_name="Opening AR",
        opening_balance=Decimal("1000.00"),
        opening_balance_date="2026-01-01",
        current_balance=Decimal("1000.00"),
    )
    Payment.objects.create(
        company_id=company_tenant.id,
        customer=c,
        payment_type="received",
        amount=Decimal("400.00"),
        payment_date="2026-02-01",
        payment_method="cash",
        reference="ON-ACCT-1",
        memo="Opening collection",
    )
    assert _assert_balance_matches_ledger(company_tenant.id, c.id) == Decimal("600.00")


@pytest.mark.django_db
def test_overpayment_allows_customer_credit_balance(company_tenant):
    c = Customer.objects.create(
        company_id=company_tenant.id,
        display_name="Prepay",
        opening_balance=Decimal("0"),
        current_balance=Decimal("0"),
    )
    Invoice.objects.create(
        company_id=company_tenant.id,
        customer=c,
        invoice_number="INV-CREDIT",
        invoice_date="2026-05-01",
        status="sent",
        subtotal=Decimal("100"),
        tax_total=Decimal("0"),
        total=Decimal("100"),
        payment_method="on_account",
    )
    Payment.objects.create(
        company_id=company_tenant.id,
        customer=c,
        payment_type="received",
        amount=Decimal("150.00"),
        payment_date="2026-05-02",
        payment_method="cash",
        reference="PREPAY-1",
    )
    assert _assert_balance_matches_ledger(company_tenant.id, c.id) == Decimal("-50.00")
