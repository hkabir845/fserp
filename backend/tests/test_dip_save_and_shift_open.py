"""Dip save keeps later wet-stock movements. Shift open stores a meter snapshot only."""
from datetime import date
from decimal import Decimal

import pytest

pytestmark = pytest.mark.django_db


def _headers(auth_super_headers, company_id: int) -> dict:
    return dict(auth_super_headers, HTTP_X_SELECTED_COMPANY_ID=str(company_id))


def _forecourt(company):
    from api.models import Dispenser, Island, Item, Meter, Nozzle, Station, Tank

    station = Station.objects.create(company=company, station_name="Dip Bay")
    product = Item.objects.create(
        company=company,
        name="Dip Diesel",
        unit_price=Decimal("100.00"),
        cost=Decimal("90.00"),
        quantity_on_hand=Decimal("10000"),
    )
    tank = Tank.objects.create(
        company=company,
        station=station,
        product=product,
        tank_name="T-dip",
        capacity=Decimal("50000"),
        current_stock=Decimal("10000"),
    )
    island = Island.objects.create(company=company, station=station, island_name="I1")
    dispenser = Dispenser.objects.create(company=company, island=island, dispenser_name="D1")
    meter = Meter.objects.create(
        company=company,
        dispenser=dispenser,
        meter_name="M1",
        current_reading=Decimal("1000.0000"),
    )
    nozzle = Nozzle.objects.create(company=company, meter=meter, tank=tank, product=product)
    return station, product, tank, meter, nozzle


def test_editing_latest_dip_keeps_later_sales_and_receipts(
    api_client, auth_super_headers, company_tenant
):
    from api.models import Bill, BillLine, Customer, Invoice, InvoiceLine, Vendor

    cid = company_tenant.id
    _station, product, tank, _meter, nozzle = _forecourt(company_tenant)
    headers = _headers(auth_super_headers, cid)

    created = api_client.post(
        "/api/tank-dips/",
        {"tank_id": tank.id, "volume": "9800", "dip_date": date.today().isoformat()},
        content_type="application/json",
        **headers,
    )
    assert created.status_code == 201, created.content
    dip_id = created.json()["id"]
    tank.refresh_from_db()
    assert tank.current_stock == Decimal("9800")

    customer = Customer.objects.create(company_id=cid, display_name="Walk-in")
    invoice = Invoice.objects.create(
        company_id=cid,
        customer=customer,
        invoice_number="DIP-SALE-1",
        invoice_date=date.today(),
        status="sent",
        subtotal=Decimal("10000"),
        total=Decimal("10000"),
    )
    InvoiceLine.objects.create(
        invoice=invoice,
        item=product,
        nozzle=nozzle,
        quantity=Decimal("100"),
        unit_price=Decimal("100"),
        amount=Decimal("10000"),
    )
    vendor = Vendor.objects.create(company_id=cid, company_name="Fuel supplier")
    bill = Bill.objects.create(
        company_id=cid,
        vendor=vendor,
        bill_number="DIP-RCV-1",
        bill_date=date.today(),
        status="open",
        subtotal=Decimal("3600"),
        total=Decimal("3600"),
        stock_receipt_applied=True,
    )
    BillLine.objects.create(
        bill=bill,
        item=product,
        tank=tank,
        quantity=Decimal("40"),
        unit_price=Decimal("90"),
        amount=Decimal("3600"),
    )
    # The sale and receipt already moved the tank. Editing the dip must not rewind that.
    tank.current_stock = Decimal("9740")
    tank.save(update_fields=["current_stock"])

    edited = api_client.put(
        f"/api/tank-dips/{dip_id}/",
        {"volume": "9800", "notes": "recheck"},
        content_type="application/json",
        **headers,
    )
    assert edited.status_code == 200, edited.content
    tank.refresh_from_db()
    product.refresh_from_db()
    assert tank.current_stock == Decimal("9740")
    assert product.quantity_on_hand == Decimal("9740")

    edited = api_client.put(
        f"/api/tank-dips/{dip_id}/",
        {"volume": "9700"},
        content_type="application/json",
        **headers,
    )
    assert edited.status_code == 200, edited.content
    tank.refresh_from_db()
    # New stick, still minus the 100 L sold and plus the 40 L received after the dip.
    assert tank.current_stock == Decimal("9640")


def test_editing_an_older_dip_does_not_move_the_tank(
    api_client, auth_super_headers, company_tenant
):
    cid = company_tenant.id
    _station, _product, tank, _meter, _nozzle = _forecourt(company_tenant)
    headers = _headers(auth_super_headers, cid)
    first = api_client.post(
        "/api/tank-dips/",
        {"tank_id": tank.id, "volume": "9800", "dip_date": "2026-09-01"},
        content_type="application/json",
        **headers,
    )
    assert first.status_code == 201, first.content
    second = api_client.post(
        "/api/tank-dips/",
        {"tank_id": tank.id, "volume": "9600", "dip_date": "2026-09-02"},
        content_type="application/json",
        **headers,
    )
    assert second.status_code == 201, second.content
    tank.refresh_from_db()
    assert tank.current_stock == Decimal("9600")

    edited = api_client.put(
        f"/api/tank-dips/{first.json()['id']}/",
        {"volume": "1000"},
        content_type="application/json",
        **headers,
    )
    assert edited.status_code == 200, edited.content
    tank.refresh_from_db()
    assert tank.current_stock == Decimal("9600")


def test_opening_shift_does_not_rebase_the_live_meter(
    api_client, auth_super_headers, company_tenant
):
    cid = company_tenant.id
    station, _product, _tank, meter, _nozzle = _forecourt(company_tenant)
    headers = _headers(auth_super_headers, cid)

    opened = api_client.post(
        "/api/shifts/sessions/open/",
        {
            "station_id": station.id,
            "opening_cash_float": "0",
            "opening_meters": [{"meter_id": meter.id, "reading": "50"}],
        },
        content_type="application/json",
        **headers,
    )
    assert opened.status_code == 201, opened.content
    body = opened.json()
    meter.refresh_from_db()
    assert meter.current_reading == Decimal("1000.0000")
    assert body["opening_meters"][0]["reading"] == "50"
    assert body["opening_meters"][0]["previous_reading"] == "1000.0000"

    closed = api_client.post(
        f"/api/shifts/sessions/{body['id']}/close/",
        {"closing_meters": [{"meter_id": meter.id, "reading": "9999"}]},
        content_type="application/json",
        **headers,
    )
    assert closed.status_code == 200, closed.content
    meter.refresh_from_db()
    assert meter.current_reading == Decimal("1000.0000")
    assert closed.json()["closing_meters"][0]["reading"] == "9999"
