"""Daily summary: fuel forecourt vs aquaculture shop hub business lines."""
from datetime import date
from decimal import Decimal

import pytest

from api.models import Customer, Invoice, Item, Station
from api.services.reporting import report_daily_summary


@pytest.mark.django_db
def test_daily_summary_splits_fuel_and_aquaculture_lines(company_tenant):
    fuel_st = Station.objects.create(
        company_id=company_tenant.id,
        station_name="Main Station",
        operates_fuel_retail=True,
        is_active=True,
    )
    Station.objects.create(
        company_id=company_tenant.id,
        station_name="Premium Agro",
        operates_fuel_retail=False,
        is_active=True,
    )
    customer = Customer.objects.create(
        company_id=company_tenant.id,
        display_name="Daily summary buyer",
        customer_number="DS-01",
    )
    diesel = Item.objects.create(
        company_id=company_tenant.id,
        name="Diesel",
        pos_category="fuel",
        unit="L",
        cost=Decimal("0"),
        unit_price=Decimal("100"),
    )
    feed = Item.objects.create(
        company_id=company_tenant.id,
        name="Fish Feed 32%",
        pos_category="feed",
        unit="kg",
        cost=Decimal("0"),
        unit_price=Decimal("50"),
    )

    inv_fuel = Invoice.objects.create(
        company_id=company_tenant.id,
        customer=customer,
        station=fuel_st,
        invoice_number="INV-DS-FUEL",
        invoice_date=date(2026, 5, 10),
        status="paid",
        subtotal=Decimal("1000"),
        tax_total=Decimal("0"),
        total=Decimal("1000"),
        payment_method="cash",
    )
    inv_fuel.lines.create(item=diesel, quantity=Decimal("10"), amount=Decimal("1000"))

    agro_st = Station.objects.get(station_name="Premium Agro")
    inv_shop = Invoice.objects.create(
        company_id=company_tenant.id,
        customer=customer,
        station=agro_st,
        invoice_number="INV-DS-AGRO",
        invoice_date=date(2026, 5, 10),
        status="paid",
        subtotal=Decimal("200"),
        tax_total=Decimal("0"),
        total=Decimal("200"),
        payment_method="cash",
    )
    inv_shop.lines.create(item=feed, quantity=Decimal("4"), amount=Decimal("200"))

    payload = report_daily_summary(
        company_tenant.id,
        date(2026, 5, 1),
        date(2026, 5, 31),
        business_segment="all",
    )

    assert payload["report_id"] == "daily-summary"
    lines = payload.get("business_lines") or []
    assert len(lines) == 2
    fuel_line = next(l for l in lines if l["line"] == "fuel")
    shop_line = next(l for l in lines if l["line"] == "shop")
    assert Decimal(str(fuel_line["sales"]["total_amount"])) == Decimal("1000")
    assert Decimal(str(shop_line["sales"]["total_amount"])) == Decimal("200")
    assert "Feed" in str(shop_line.get("by_pos_category") or "")

    fuel_only = report_daily_summary(
        company_tenant.id,
        date(2026, 5, 1),
        date(2026, 5, 31),
        business_segment="fuel",
    )
    assert len(fuel_only.get("business_lines") or []) == 1
    assert fuel_only["business_lines"][0]["line"] == "fuel"
