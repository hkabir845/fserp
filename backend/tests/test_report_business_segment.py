"""Business segment filter: Fuel Station vs Aquaculture (Premium Agro) on Sales / Purchase reports."""
from datetime import date
from decimal import Decimal

import pytest

from api.models import Bill, Customer, Invoice, Station, Vendor
from api.services.reporting import report_purchase_report, report_sales_report


@pytest.mark.django_db
def test_sales_report_business_segment_fuel_vs_aquaculture(company_tenant):
    fuel_st = Station.objects.create(
        company_id=company_tenant.id,
        station_name="Main Forecourt",
        operates_fuel_retail=True,
        is_active=True,
    )
    agro_st = Station.objects.create(
        company_id=company_tenant.id,
        station_name="Premium Agro",
        operates_fuel_retail=False,
        is_active=True,
    )
    walkin = Customer.objects.create(
        company_id=company_tenant.id,
        display_name="Walk-in",
        current_balance=Decimal("0"),
    )
    pond_cust = Customer.objects.create(
        company_id=company_tenant.id,
        display_name="Aquaculture — North Pond",
        current_balance=Decimal("0"),
    )

    Invoice.objects.create(
        company_id=company_tenant.id,
        customer=walkin,
        station=fuel_st,
        invoice_number="INV-FUEL-1",
        invoice_date=date(2026, 5, 10),
        status="paid",
        subtotal=Decimal("500"),
        tax_total=Decimal("0"),
        total=Decimal("500"),
        payment_method="cash",
    )
    Invoice.objects.create(
        company_id=company_tenant.id,
        customer=pond_cust,
        station=agro_st,
        invoice_number="INV-AGRO-1",
        invoice_date=date(2026, 5, 11),
        status="sent",
        subtotal=Decimal("120"),
        tax_total=Decimal("0"),
        total=Decimal("120"),
        payment_method="on_account",
    )

    fuel_payload = report_sales_report(
        company_tenant.id,
        date(2026, 5, 1),
        date(2026, 5, 31),
        business_segment="fuel",
    )
    assert fuel_payload["business_segment"] == "fuel"
    assert Decimal(str(fuel_payload["summary"]["grand_total"])) == Decimal("500")
    assert len(fuel_payload["cash_customers"]) == 1

    agro_payload = report_sales_report(
        company_tenant.id,
        date(2026, 5, 1),
        date(2026, 5, 31),
        business_segment="aquaculture",
    )
    assert agro_payload["business_segment"] == "aquaculture"
    assert agro_payload["business_segment_label"] == "Aquaculture (Premium Agro)"
    assert Decimal(str(agro_payload["summary"]["grand_total"])) == Decimal("120")
    assert len(agro_payload["credit_customers"]) == 1


@pytest.mark.django_db
def test_purchase_report_business_segment_fuel_vs_aquaculture(company_tenant):
    fuel_st = Station.objects.create(
        company_id=company_tenant.id,
        station_name="Main Forecourt",
        operates_fuel_retail=True,
        is_active=True,
    )
    agro_st = Station.objects.create(
        company_id=company_tenant.id,
        station_name="Premium Agro",
        operates_fuel_retail=False,
        is_active=True,
    )
    vendor = Vendor.objects.create(
        company_id=company_tenant.id,
        company_name="Feed Supplier",
        display_name="Feed Supplier",
    )

    Bill.objects.create(
        company_id=company_tenant.id,
        vendor=vendor,
        receipt_station=fuel_st,
        bill_number="B-FUEL",
        bill_date=date(2026, 5, 8),
        status="open",
        subtotal=Decimal("200"),
        tax_total=Decimal("0"),
        total=Decimal("200"),
    )
    Bill.objects.create(
        company_id=company_tenant.id,
        vendor=vendor,
        receipt_station=agro_st,
        bill_number="B-AGRO",
        bill_date=date(2026, 5, 9),
        status="open",
        subtotal=Decimal("80"),
        tax_total=Decimal("0"),
        total=Decimal("80"),
    )

    fuel_payload = report_purchase_report(
        company_tenant.id,
        date(2026, 5, 1),
        date(2026, 5, 31),
        business_segment="fuel",
    )
    assert Decimal(str(fuel_payload["summary"]["credit_purchase_total"])) == Decimal("200")

    agro_payload = report_purchase_report(
        company_tenant.id,
        date(2026, 5, 1),
        date(2026, 5, 31),
        business_segment="aquaculture",
    )
    assert Decimal(str(agro_payload["summary"]["credit_purchase_total"])) == Decimal("80")
