"""Customer A/R balance: paid cash POS vs open credit invoices."""
from decimal import Decimal

import pytest

from api.models import Customer, Invoice
from api.services.contact_ledgers import build_customer_ledger
from api.services.payment_allocation import (
    compute_customer_balance_due,
    invoice_balance_due,
    invoice_open_amount,
)


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
