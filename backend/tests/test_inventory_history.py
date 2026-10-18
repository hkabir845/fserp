from datetime import date
from decimal import Decimal

import pytest
from api.models import Bill, BillLine, Customer, Item, Invoice, InvoiceLine, Vendor, Station, InventoryTransfer, InventoryTransferLine
from api.services.reporting import report_inventory_sku_valuation

pytestmark = pytest.mark.django_db


def test_historical_cost_replays_receipts_and_sales_without_current_cost(company_tenant):
    cid = company_tenant.id
    item = Item.objects.create(company_id=cid, name="Historical SKU", pos_category="shop",
        opening_stock_quantity=10, opening_stock_unit_cost=10, opening_balance_date=date(2026, 1, 1),
        quantity_on_hand=999, cost=999)
    customer = Customer.objects.create(company_id=cid, display_name="Buyer")
    invoice = Invoice.objects.create(company_id=cid, customer=customer, invoice_number="H-INV",
        invoice_date=date(2026, 1, 10), status="sent", stock_relieved=True, total=100)
    InvoiceLine.objects.create(invoice=invoice, item=item, quantity=5, amount=100, stock_relieved_quantity=5, stock_cost_amount=50)
    vendor = Vendor.objects.create(company_id=cid, company_name="Supplier")
    bill = Bill.objects.create(company_id=cid, vendor=vendor, bill_number="H-BILL",
        bill_date=date(2026, 2, 1), status="open", stock_receipt_applied=True, total=300)
    BillLine.objects.create(bill=bill, item=item, quantity=10, unit_price=30, amount=300)
    january = report_inventory_sku_valuation(cid, date(2026, 1, 1), date(2026, 1, 31), valuation_basis="historical")
    assert Decimal(january["summary"]["total_qty_on_hand"]) == Decimal("5")
    assert january["summary"]["total_cost_value"] == "50.00"
    assert january["valuation_as_of_date"] == "2026-01-31"
    february = report_inventory_sku_valuation(cid, date(2026, 1, 1), date(2026, 2, 28), valuation_basis="historical")
    assert Decimal(february["summary"]["total_qty_on_hand"]) == Decimal("15")
    assert february["summary"]["total_cost_value"] == "350.00"
    assert february["history_is_complete"] is True


def test_missing_opening_date_is_flagged_without_using_live_stock(company_tenant):
    Item.objects.create(company_id=company_tenant.id, name="Undated opening", opening_stock_quantity=20,
        opening_stock_unit_cost=5, quantity_on_hand=20, cost=5)
    result = report_inventory_sku_valuation(company_tenant.id, date(2026, 1, 1), date(2026, 1, 31), valuation_basis="historical")
    assert Decimal(result["summary"]["total_qty_on_hand"]) == Decimal("0")
    assert result["history_is_complete"] is False
    assert result["rows"][0]["history_warnings"]


def test_site_transfer_preserves_company_cost(company_tenant):
    cid = company_tenant.id
    a = Station.objects.create(company_id=cid, station_name="A")
    b = Station.objects.create(company_id=cid, station_name="B")
    item = Item.objects.create(company_id=cid, name="Transfer SKU", opening_balance_date=date(2026, 1, 1))
    vendor = Vendor.objects.create(company_id=cid, company_name="Supplier")
    bill = Bill.objects.create(company_id=cid, vendor=vendor, bill_number="X-BILL", receipt_station=a,
        bill_date=date(2026, 1, 1), status="open", stock_receipt_applied=True, total=100)
    BillLine.objects.create(bill=bill, item=item, quantity=10, amount=100)
    transfer = InventoryTransfer.objects.create(company_id=cid, from_station=a, to_station=b,
        transfer_date=date(2026, 1, 2), status="posted")
    InventoryTransferLine.objects.create(transfer=transfer, item=item, quantity=4)
    result = report_inventory_sku_valuation(cid, date(2026, 1, 1), date(2026, 1, 31), b.id, valuation_basis="historical")
    assert Decimal(result["summary"]["total_qty_on_hand"]) == Decimal("4")
    assert result["summary"]["total_cost_value"] == "40.00"


def test_invalid_basis_rejected(api_client, auth_admin_headers):
    response = api_client.get("/api/reports/inventory-sku-valuation/", {"valuation_basis": "made-up"}, **auth_admin_headers)
    assert response.status_code == 400


def test_historical_rows_round_individually_and_keep_fractional_quantities(company_tenant):
    cid = company_tenant.id
    for name in ("Fractional A", "Fractional B"):
        Item.objects.create(company_id=cid, name=name, opening_balance_date=date(2026, 1, 1),
            opening_stock_quantity=Decimal("0.3333"), opening_stock_unit_cost=Decimal("0.01"))
    result = report_inventory_sku_valuation(cid, date(2026, 1, 1), date(2026, 1, 31), valuation_basis="historical")
    assert result["summary"]["total_qty_on_hand"] == "0.6666"
    assert result["rows"][0]["quantity_on_hand"] == "0.3333"
    assert sum(Decimal(row["extended_cost_value"]) for row in result["rows"]) == Decimal(result["summary"]["total_cost_value"])


def test_historical_receipt_excludes_input_tax_and_includes_landed_charges(company_tenant):
    cid = company_tenant.id
    item = Item.objects.create(company_id=cid, name="Landed SKU", opening_balance_date=date(2026, 1, 1))
    vendor = Vendor.objects.create(company_id=cid, company_name="Import supplier")
    bill = Bill.objects.create(company_id=cid, vendor=vendor, bill_number="LAND-HISTORY",
        bill_date=date(2026, 1, 5), status="open", stock_receipt_applied=True,
        total=130, subtotal=100, tax_total=10, is_landed_cost=True, freight_total=20)
    BillLine.objects.create(bill=bill, item=item, quantity=10, amount=100)
    result = report_inventory_sku_valuation(cid, date(2026, 1, 1), date(2026, 1, 31), valuation_basis="historical")
    assert result["summary"]["total_cost_value"] == "120.00"
    assert result["rows"][0]["unit_cost"] == "12.000000"


def test_historical_shop_to_pond_transfer_keeps_company_inventory(company_tenant):
    from api.models import AquaculturePond, PondWarehouseStockReceipt, PondWarehouseStockReceiptLine
    cid = company_tenant.id
    station = Station.objects.create(company_id=cid, station_name="Feed warehouse")
    pond = AquaculturePond.objects.create(company_id=cid, name="Grow pond")
    item = Item.objects.create(company_id=cid, name="Pond feed", opening_balance_date=date(2026, 1, 1))
    vendor = Vendor.objects.create(company_id=cid, company_name="Feed supplier")
    bill = Bill.objects.create(company_id=cid, vendor=vendor, bill_number="POND-RECEIPT", receipt_station=station,
        bill_date=date(2026, 1, 2), status="open", stock_receipt_applied=True, total=100)
    BillLine.objects.create(bill=bill, item=item, quantity=10, amount=100)
    receipt = PondWarehouseStockReceipt.objects.create(company_id=cid, from_station=station, pond=pond, transfer_date=date(2026, 1, 3))
    PondWarehouseStockReceiptLine.objects.create(receipt=receipt, item=item, quantity=3)
    site = report_inventory_sku_valuation(cid, date(2026, 1, 1), date(2026, 1, 31), station.id, valuation_basis="historical")
    company = report_inventory_sku_valuation(cid, date(2026, 1, 1), date(2026, 1, 31), valuation_basis="historical")
    assert Decimal(site["summary"]["total_qty_on_hand"]) == 7
    assert Decimal(company["summary"]["total_qty_on_hand"]) == 10
    assert Decimal(company["summary"]["total_cost_value"]) == 100


def test_zero_opening_does_not_require_an_artificial_date(company_tenant):
    Item.objects.create(company_id=company_tenant.id, name="Unused SKU", quantity_on_hand=0, cost=0)
    result = report_inventory_sku_valuation(company_tenant.id, date(2026, 1, 1), date(2026, 1, 31), valuation_basis="historical")
    assert result["history_is_complete"] is True
    assert Decimal(result["summary"]["total_cost_value"]) == 0


def test_current_stock_mismatch_is_disclosed_without_replacing_history(company_tenant):
    from django.utils import timezone
    from api.services.inventory_history import historical_inventory_positions
    today = timezone.localdate()
    item = Item.objects.create(company_id=company_tenant.id, name="Unexplained live stock",
        quantity_on_hand=12, cost=99)
    result = historical_inventory_positions(company_tenant.id, [item], today)[item.id]
    assert result["quantity"] == 0
    assert result["value"] == 0
    assert result["is_complete"] is False
    assert any("does not match current physical stock" in message for message in result["warnings"])


def test_conflicting_opening_does_not_replace_the_receipt_register(company_tenant):
    cid = company_tenant.id
    item = Item.objects.create(company_id=cid, name="Cutover SKU", opening_balance_date=date(2026, 2, 1),
        opening_stock_quantity=10, opening_stock_unit_cost=20)
    vendor = Vendor.objects.create(company_id=cid, company_name="Before cutover supplier")
    old = Bill.objects.create(company_id=cid, vendor=vendor, bill_number="BEFORE-CUTOVER", bill_date=date(2026, 1, 1),
        status="open", stock_receipt_applied=True, total=500)
    BillLine.objects.create(bill=old, item=item, quantity=50, amount=500)
    january = report_inventory_sku_valuation(cid, date(2026, 1, 1), date(2026, 1, 31), valuation_basis="historical")
    february = report_inventory_sku_valuation(cid, date(2026, 2, 1), date(2026, 2, 28), valuation_basis="historical")
    assert Decimal(january["summary"]["total_qty_on_hand"]) == 50
    assert Decimal(february["summary"]["total_qty_on_hand"]) == 50
    assert Decimal(february["summary"]["total_cost_value"]) == 500
    assert february["history_is_complete"] is False
    assert any("opening conflicts" in message for message in february["rows"][0]["history_warnings"])


def test_opening_without_earlier_receipts_remains_the_balance(company_tenant):
    cid = company_tenant.id
    Item.objects.create(company_id=cid, name="Go-live SKU", opening_balance_date=date(2026, 2, 1),
        opening_stock_quantity=10, opening_stock_unit_cost=20)
    february = report_inventory_sku_valuation(cid, date(2026, 2, 1), date(2026, 2, 28), valuation_basis="historical")
    assert Decimal(february["summary"]["total_qty_on_hand"]) == 10
    assert Decimal(february["summary"]["total_cost_value"]) == 200


def test_matching_opening_is_a_cutover_and_is_not_added_twice(company_tenant):
    cid = company_tenant.id
    item = Item.objects.create(company_id=cid, name="Matched opening", opening_balance_date=date(2026, 2, 1),
        opening_stock_quantity=10, opening_stock_unit_cost=20)
    vendor = Vendor.objects.create(company_id=cid, company_name="Matched supplier")
    old = Bill.objects.create(company_id=cid, vendor=vendor, bill_number="MATCHED-OPENING", bill_date=date(2026, 1, 1),
        status="open", stock_receipt_applied=True, total=100)
    BillLine.objects.create(bill=old, item=item, quantity=10, amount=100)
    february = report_inventory_sku_valuation(cid, date(2026, 2, 1), date(2026, 2, 28), valuation_basis="historical")
    assert Decimal(february["summary"]["total_qty_on_hand"]) == 10
    assert Decimal(february["summary"]["total_cost_value"]) == 200


def test_tank_dip_measured_volume_replaces_earlier_history(company_tenant):
    from api.models import Tank, TankDip
    from api.services.inventory_history import historical_inventory_positions
    cid = company_tenant.id
    station = Station.objects.create(company_id=cid, station_name="Dip station")
    item = Item.objects.create(company_id=cid, name="Dipped diesel", pos_category="fuel", unit="liter", quantity_on_hand=300)
    tank = Tank.objects.create(company_id=cid, station=station, product=item, tank_name="Main", capacity=10000, current_stock=300)
    vendor = Vendor.objects.create(company_id=cid, company_name="Fuel supplier")
    old = Bill.objects.create(company_id=cid, vendor=vendor, bill_number="BEFORE-DIP", bill_date=date(2026, 1, 1),
        status="open", stock_receipt_applied=True, total=1000)
    BillLine.objects.create(bill=old, item=item, quantity=1000, amount=1000)
    TankDip.objects.create(company_id=cid, tank=tank, dip_date=date(2026, 8, 25), volume=0, book_stock_before=100)
    later = Bill.objects.create(company_id=cid, vendor=vendor, bill_number="AFTER-DIP", bill_date=date(2026, 8, 26),
        status="open", stock_receipt_applied=True, total=500)
    BillLine.objects.create(bill=later, item=item, quantity=500, amount=500)
    buyer = Customer.objects.create(company_id=cid, display_name="Dip buyer")
    invoice = Invoice.objects.create(company_id=cid, customer=buyer, station=station, invoice_number="AFTER-DIP-SALE",
        invoice_date=date(2026, 8, 27), status="sent", total=200, stock_relieved=True)
    InvoiceLine.objects.create(invoice=invoice, item=item, quantity=200, amount=200, stock_relieved_quantity=200)
    result = historical_inventory_positions(cid, [item], date(2026, 9, 1))[item.id]
    assert result["quantity"] == 300
    assert result["value"] == 300
    assert all("negative inventory" not in message for message in result["warnings"])


def test_dip_preserves_cost_and_does_not_depend_on_current_quantity(company_tenant):
    from api.models import Tank, TankDip
    from api.services.inventory_history import historical_inventory_positions
    cid = company_tenant.id
    station = Station.objects.create(company_id=cid, station_name="Stable dip")
    item = Item.objects.create(company_id=cid, name="Stable fuel", pos_category="fuel",
        opening_stock_quantity=100, opening_stock_unit_cost=10,
        opening_balance_date=date(2026, 1, 1), quantity_on_hand=80, cost=999)
    tank = Tank.objects.create(company_id=cid, station=station, product=item,
        tank_name="Stable tank", capacity=1000, current_stock=80)
    TankDip.objects.create(company_id=cid, tank=tank, dip_date=date(2026, 1, 2),
        volume=80, book_stock_before=100)
    before = historical_inventory_positions(cid, [item], date(2026, 1, 31))[item.id]
    item.quantity_on_hand = 700
    item.cost = 2000
    after = historical_inventory_positions(cid, [item], date(2026, 1, 31))[item.id]
    assert before == after
    assert before["quantity"] == 80
    assert before["value"] == 800


def test_positive_dip_without_cost_is_incomplete(company_tenant):
    from api.models import Tank, TankDip
    from api.services.inventory_history import historical_inventory_positions
    cid = company_tenant.id
    station = Station.objects.create(company_id=cid, station_name="Unknown dip cost")
    item = Item.objects.create(company_id=cid, name="Unknown fuel", pos_category="fuel", cost=500)
    tank = Tank.objects.create(company_id=cid, station=station, product=item,
        tank_name="Unknown tank", capacity=1000)
    TankDip.objects.create(company_id=cid, tank=tank, dip_date=date(2026, 1, 2), volume=80, book_stock_before=0)
    result = historical_inventory_positions(cid, [item], date(2026, 1, 31))[item.id]
    assert result["quantity"] == 80
    assert result["value"] == 0
    assert result["is_complete"] is False
    assert any("no historical cost basis" in message for message in result["warnings"])


def test_dip_in_one_of_two_tanks_does_not_replace_company_stock(company_tenant):
    from api.models import Tank, TankDip
    from api.services.inventory_history import historical_inventory_positions
    cid = company_tenant.id
    station = Station.objects.create(company_id=cid, station_name="Two tanks")
    item = Item.objects.create(company_id=cid, name="Shared fuel", pos_category="fuel",
        opening_stock_quantity=200, opening_stock_unit_cost=10, opening_balance_date=date(2026, 1, 1))
    first = Tank.objects.create(company_id=cid, station=station, product=item, tank_name="First", capacity=1000)
    Tank.objects.create(company_id=cid, station=station, product=item, tank_name="Second", capacity=1000)
    TankDip.objects.create(company_id=cid, tank=first, dip_date=date(2026, 1, 2), volume=80, book_stock_before=100)
    result = historical_inventory_positions(cid, [item], date(2026, 1, 31))[item.id]
    assert result["quantity"] == 180
    assert result["value"] == 1800


def test_empty_sack_creation_and_sale_reconstruct_quantity(company_tenant):
    from api.models import AquacultureExpense, AquacultureFishSale, AquaculturePond
    from api.services.aquaculture_empty_sack_service import EMPTY_SACK_ITEM_NUMBER
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="Sack pond")
    item = Item.objects.create(company_id=cid, name="Empty sacks", item_number=EMPTY_SACK_ITEM_NUMBER,
        item_type="inventory", pos_category="scrap", unit="sack", cost=0, quantity_on_hand=3)
    AquacultureExpense.objects.create(company_id=cid, pond=pond, expense_category="feed_consumed",
        expense_date=date(2026, 1, 1), amount=0, empty_sack_count=5)
    AquacultureFishSale.objects.create(company_id=cid, pond=pond, income_type="empty_feed_sack_sale",
        sale_date=date(2026, 1, 2), weight_kg=2, total_amount=0)
    result = report_inventory_sku_valuation(cid, date(2026, 1, 1), date(2026, 1, 31), valuation_basis="historical")
    assert Decimal(result["summary"]["total_qty_on_hand"]) == 3
    assert Decimal(result["summary"]["total_cost_value"]) == 0


def test_posted_sale_and_return_keep_original_cost_after_catalog_edit(company_tenant_with_gl):
    from api.services.gl_posting import post_invoice_cogs_journal, post_invoice_sale_journal
    from api.services.credit_note import post_credit_note
    cid = company_tenant_with_gl.id
    station = Station.objects.create(company_id=cid, station_name="Cost evidence shop")
    item = Item.objects.create(company_id=cid, name="Original cost SKU", pos_category="shop", cost=10,
        opening_stock_quantity=10, opening_stock_unit_cost=10, opening_balance_date=date(2026, 1, 1))
    buyer = Customer.objects.create(company_id=cid, display_name="Original cost buyer")
    invoice = Invoice.objects.create(company_id=cid, customer=buyer, station=station,
        invoice_number="ORIGINAL-COST", invoice_date=date(2026, 1, 5), status="sent", total=100, subtotal=100, stock_relieved=True)
    line = InvoiceLine.objects.create(invoice=invoice, item=item, quantity=5, amount=100,
        stock_relieved_quantity=5, stock_relieved_station_id=station.id)
    assert post_invoice_sale_journal(cid, invoice)
    assert post_invoice_cogs_journal(cid, invoice)
    line.refresh_from_db()
    assert line.stock_cost_amount == Decimal("50")
    Item.objects.filter(pk=item.pk).update(cost=999)
    note = post_credit_note(cid, invoice.id, amount=Decimal("40"), credit_date=date(2026, 2, 2))
    assert note.stock_movement_evidence[0]["quantity"] == "2.000"
    assert Decimal(note.stock_movement_evidence[0]["cost_amount"]) == 20
    report = report_inventory_sku_valuation(cid, date(2026, 1, 1), date(2026, 2, 28), valuation_basis="historical")
    assert Decimal(report["summary"]["total_qty_on_hand"]) == 7
    assert Decimal(report["summary"]["total_cost_value"]) == 70
    assert report["history_is_complete"] is True


def test_legacy_cost_backfill_uses_posted_journal_and_default_audit_is_read_only(company_tenant_with_gl):
    import io
    import json
    from django.core.management import call_command
    from api.services.gl_posting import post_invoice_cogs_journal
    cid = company_tenant_with_gl.id
    station = Station.objects.create(company_id=cid, station_name="Legacy evidence")
    item = Item.objects.create(company_id=cid, name="Legacy cost SKU", cost=10, pos_category="shop",
        opening_stock_quantity=10, opening_stock_unit_cost=10, opening_balance_date=date(2026, 1, 1))
    buyer = Customer.objects.create(company_id=cid, display_name="Legacy buyer")
    invoice = Invoice.objects.create(company_id=cid, customer=buyer, station=station, invoice_number="LEGACY-EVIDENCE",
        invoice_date=date(2026, 1, 5), status="sent", total=100, subtotal=100)
    line = InvoiceLine.objects.create(invoice=invoice, item=item, quantity=5, amount=100, stock_relieved_quantity=5)
    assert post_invoice_cogs_journal(cid, invoice)
    InvoiceLine.objects.filter(pk=line.pk).update(stock_cost_amount=None)
    Item.objects.filter(pk=item.pk).update(cost=999)
    dry = io.StringIO()
    call_command("audit_inventory_history", company_id=cid, as_of="2026-01-31", stdout=dry)
    assert json.loads(dry.getvalue())["provable_cost_snapshots"] == 1
    line.refresh_from_db()
    assert line.stock_cost_amount is None
    applied = io.StringIO()
    call_command("audit_inventory_history", company_id=cid, as_of="2026-01-31", backfill_cost_evidence=True, stdout=applied)
    line.refresh_from_db()
    assert line.stock_cost_amount == 50
    assert json.loads(applied.getvalue())["cost_snapshots_written"] == 1
