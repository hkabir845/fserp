"""Sales Report: cash vs credit customer totals in a date range."""
from datetime import date
from decimal import Decimal

import pytest

from api.models import Customer, Invoice
from api.services.reporting import report_sales_report


@pytest.mark.django_db
def test_sales_report_splits_cash_and_credit_customers(company_tenant):
    cash_cust = Customer.objects.create(
        company_id=company_tenant.id,
        display_name="Cash buyer",
        customer_number="CASH-01",
        current_balance=Decimal("0"),
    )
    credit_cust = Customer.objects.create(
        company_id=company_tenant.id,
        display_name="Credit buyer",
        customer_number="CR-01",
        current_balance=Decimal("0"),
    )
    Invoice.objects.create(
        company_id=company_tenant.id,
        customer=cash_cust,
        invoice_number="INV-CASH-1",
        invoice_date="2026-05-10",
        status="paid",
        subtotal=Decimal("100"),
        tax_total=Decimal("0"),
        total=Decimal("100"),
        payment_method="cash",
    )
    Invoice.objects.create(
        company_id=company_tenant.id,
        customer=credit_cust,
        invoice_number="INV-CR-1",
        invoice_date="2026-05-12",
        status="sent",
        subtotal=Decimal("250"),
        tax_total=Decimal("0"),
        total=Decimal("250"),
        payment_method="on_account",
    )
    Invoice.objects.create(
        company_id=company_tenant.id,
        customer=credit_cust,
        invoice_number="INV-CR-2",
        invoice_date="2026-05-15",
        status="sent",
        subtotal=Decimal("50"),
        tax_total=Decimal("0"),
        total=Decimal("50"),
        payment_method="on_account",
    )
    # Outside range — excluded
    Invoice.objects.create(
        company_id=company_tenant.id,
        customer=cash_cust,
        invoice_number="INV-OLD",
        invoice_date="2026-04-01",
        status="paid",
        subtotal=Decimal("999"),
        tax_total=Decimal("0"),
        total=Decimal("999"),
        payment_method="cash",
    )
    # Draft — excluded
    Invoice.objects.create(
        company_id=company_tenant.id,
        customer=cash_cust,
        invoice_number="INV-DRAFT",
        invoice_date="2026-05-11",
        status="draft",
        subtotal=Decimal("10"),
        tax_total=Decimal("0"),
        total=Decimal("10"),
        payment_method="cash",
    )

    payload = report_sales_report(
        company_tenant.id,
        start=date(2026, 5, 1),
        end=date(2026, 5, 31),
    )

    assert payload["report_id"] == "sales-report"
    assert payload["summary"]["cash_invoice_count"] == 1
    assert payload["summary"]["credit_invoice_count"] == 2
    assert Decimal(str(payload["summary"]["cash_sales_total"])) == Decimal("100")
    assert Decimal(str(payload["summary"]["credit_sales_total"])) == Decimal("300")
    assert Decimal(str(payload["summary"]["grand_total"])) == Decimal("400")

    assert len(payload["cash_customers"]) == 1
    assert payload["cash_customers"][0]["display_name"] == "Cash buyer"
    assert payload["cash_customers"][0]["invoice_count"] == 1

    assert len(payload["credit_customers"]) == 1
    assert payload["credit_customers"][0]["display_name"] == "Credit buyer"
    assert payload["credit_customers"][0]["invoice_count"] == 2
    assert Decimal(str(payload["credit_customers"][0]["total"])) == Decimal("300")
