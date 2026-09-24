"""Regression tests for calculation gaps found against the accounting rules."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

pytestmark = pytest.mark.django_db


def test_mirrored_transfer_kg_is_counted_once(company_tenant):
    from api.models import (
        AquacultureFishPondTransfer,
        AquacultureFishPondTransferLine,
        AquacultureFishSale,
        AquaculturePond,
        Customer,
        Invoice,
    )
    from api.services.internal_trade_elimination import _internal_kg_bought_by_pond

    cid = company_tenant.id
    buyer = AquaculturePond.objects.create(company_id=cid, name="Buyer", is_active=True)
    seller = AquaculturePond.objects.create(company_id=cid, name="Seller", is_active=True)
    cust = Customer.objects.create(
        company_id=cid, display_name="Buyer pond", customer_number="P-BUY", is_active=True,
        internal_pond=buyer,
    )
    transfer = AquacultureFishPondTransfer.objects.create(
        company_id=cid, from_pond=seller, transfer_date=date(2026, 3, 1), fish_species="tilapia",
    )
    line = AquacultureFishPondTransferLine.objects.create(
        transfer=transfer, to_pond=buyer, weight_kg=Decimal("1000"), fish_count=1000, sale_amount=Decimal("40000"),
    )
    inv = Invoice.objects.create(
        company_id=cid, customer=cust, invoice_number="INV-IPT-1",
        invoice_date=date(2026, 3, 1), status="paid", subtotal=Decimal("40000"), total=Decimal("40000"),
    )
    AquacultureFishSale.objects.create(
        company_id=cid, pond=seller, sale_date=date(2026, 3, 1), income_type="fingerling_sale",
        fish_species="tilapia", weight_kg=Decimal("1000"), fish_count=1000, total_amount=Decimal("40000"),
        invoice=inv, source_fish_pond_transfer_line=line,
    )
    bought = _internal_kg_bought_by_pond(cid, date(2026, 12, 31))
    assert bought[buyer.id] == Decimal("1000")


def test_void_invoice_does_not_consume_uninvoiced_balance(company_tenant):
    from api.models import Customer, Invoice
    from api.services.payment_allocation import customer_uninvoiced_receivable

    cust = Customer.objects.create(
        company_id=company_tenant.id, display_name="Open AR", customer_number="C-OPEN",
        is_active=True, current_balance=Decimal("5000"), opening_balance=Decimal("5000"),
    )
    Invoice.objects.create(
        company_id=company_tenant.id, customer=cust, invoice_number="INV-VOID-1",
        invoice_date=date(2026, 2, 1), status="void", subtotal=Decimal("5000"), total=Decimal("5000"),
    )
    assert customer_uninvoiced_receivable(company_tenant.id, cust) == Decimal("5000.00")


def test_dip_report_uses_cost_not_selling_price(company_tenant):
    from api.models import Item, Station, Tank, TankDip
    from api.services.reporting import report_tank_dip_variance

    cid = company_tenant.id
    station = Station.objects.create(company_id=cid, station_name="Dip", is_active=True)
    product = Item.objects.create(
        company_id=cid, name="Diesel", unit_price=Decimal("130"), cost=Decimal("0"), unit="L",
    )
    tank = Tank.objects.create(
        company_id=cid, station=station, product=product, tank_name="T1", capacity=Decimal("10000"),
    )
    TankDip.objects.create(
        company_id=cid, tank=tank, dip_date=date(2026, 4, 1),
        volume=Decimal("1100"), book_stock_before=Decimal("1000"),
    )
    report = report_tank_dip_variance(cid, date(2026, 4, 1), date(2026, 4, 30))
    assert report["dips"][0]["valuation_basis"] == "none"
    assert Decimal(str(report["dips"][0]["variance_value"])) == Decimal("0")


def test_uninvoiced_harvest_stays_in_stock(company_tenant):
    from api.models import AquacultureFishSale, AquaculturePond, Bill, BillLine, Item, Vendor
    from api.services.aquaculture_stock_service import compute_fish_stock_position_rows

    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="Hold", pond_role="grow_out", is_active=True)
    vendor = Vendor.objects.create(company_id=cid, company_name="Fry")
    item = Item.objects.create(company_id=cid, name="Fry", pos_category="fish", unit="kg", unit_price=Decimal("1"))
    bill = Bill.objects.create(
        company_id=cid, vendor=vendor, bill_number="B-HOLD", bill_date=date(2026, 5, 1),
        status="posted", stock_receipt_applied=True, total=Decimal("100"),
    )
    BillLine.objects.create(
        bill=bill, item=item, quantity=Decimal("1"), amount=Decimal("100"),
        aquaculture_pond=pond, aquaculture_fish_count=100, aquaculture_fish_weight_kg=Decimal("200"),
        aquaculture_fish_species="tilapia",
    )
    AquacultureFishSale.objects.create(
        company_id=cid, pond=pond, sale_date=date(2026, 5, 15), income_type="fish_harvest_sale",
        fish_species="tilapia", weight_kg=Decimal("50"), fish_count=25, total_amount=Decimal("500"),
    )
    rows = compute_fish_stock_position_rows(cid, pond_id=pond.id)
    assert rows
    assert Decimal(str(rows[0]["implied_net_weight_kg"])) == Decimal("200")
