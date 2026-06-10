"""Sales by Products: cash vs credit product totals with cost and profit."""
from datetime import date
from decimal import Decimal

import pytest

from api.models import Customer, Invoice, InvoiceLine, Item
from api.services.reporting import report_sales_by_products


@pytest.mark.django_db
def test_sales_by_products_splits_cash_and_credit_with_profit(company_tenant):
    product = Item.objects.create(
        company_id=company_tenant.id,
        name="Feed sack",
        unit_price=Decimal("500"),
        cost=Decimal("300"),
        quantity_on_hand=Decimal("100"),
    )
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
    cash_inv = Invoice.objects.create(
        company_id=company_tenant.id,
        customer=cash_cust,
        invoice_number="INV-CASH-1",
        invoice_date="2026-05-10",
        status="paid",
        subtotal=Decimal("1000"),
        tax_total=Decimal("0"),
        total=Decimal("1000"),
        payment_method="cash",
    )
    InvoiceLine.objects.create(
        invoice=cash_inv,
        item=product,
        quantity=Decimal("2"),
        unit_price=Decimal("500"),
        amount=Decimal("1000"),
    )
    credit_inv = Invoice.objects.create(
        company_id=company_tenant.id,
        customer=credit_cust,
        invoice_number="INV-CR-1",
        invoice_date="2026-05-12",
        status="sent",
        subtotal=Decimal("500"),
        tax_total=Decimal("0"),
        total=Decimal("500"),
        payment_method="on_account",
    )
    InvoiceLine.objects.create(
        invoice=credit_inv,
        item=product,
        quantity=Decimal("1"),
        unit_price=Decimal("500"),
        amount=Decimal("500"),
    )

    payload = report_sales_by_products(
        company_tenant.id,
        start=date(2026, 5, 1),
        end=date(2026, 5, 31),
    )

    assert payload["report_id"] == "sales-by-products"
    assert payload["summary"]["cash_line_count"] == 1
    assert payload["summary"]["credit_line_count"] == 1
    assert Decimal(str(payload["summary"]["cash_revenue"])) == Decimal("1000")
    assert Decimal(str(payload["summary"]["credit_revenue"])) == Decimal("500")
    assert Decimal(str(payload["summary"]["grand_revenue"])) == Decimal("1500")
    assert Decimal(str(payload["summary"]["grand_quantity"])) == Decimal("3")
    assert Decimal(str(payload["summary"]["grand_total_cost"])) == Decimal("900")
    assert Decimal(str(payload["summary"]["grand_profit"])) == Decimal("600")

    assert len(payload["cash_products"]) == 1
    assert payload["cash_products"][0]["name"] == "Feed sack"
    assert Decimal(str(payload["cash_products"][0]["quantity"])) == Decimal("2")
    assert Decimal(str(payload["cash_products"][0]["profit"])) == Decimal("400")

    assert len(payload["credit_products"]) == 1
    assert Decimal(str(payload["credit_products"][0]["quantity"])) == Decimal("1")
    assert Decimal(str(payload["credit_products"][0]["profit"])) == Decimal("200")
