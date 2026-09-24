"""Open accounting jobs: transfers, credit notes, close, advances, bank match, landed cost."""
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


def test_unconverted_transfer_does_not_share_cost_until_sale(company_tenant):
    from api.models import AquacultureFishPondTransfer, AquacultureFishPondTransferLine, AquaculturePond
    from api.services.aquaculture_fish_transfer_as_sale import materialize_fish_sales_for_company
    from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict

    cid = company_tenant.id
    src = AquaculturePond.objects.create(company_id=cid, name="Nursing", pond_role="nursing", is_active=True)
    dst = AquaculturePond.objects.create(company_id=cid, name="Grow-out", is_active=True)
    transfer = AquacultureFishPondTransfer.objects.create(
        company_id=cid, from_pond=src, transfer_date=date(2026, 3, 1), fish_species="tilapia"
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=transfer, to_pond=dst, weight_kg=Decimal("100"), cost_amount=Decimal("5000.00"),
        sale_amount=Decimal("7000.00"),
    )
    before = compute_aquaculture_pl_summary_dict(
        cid, date(2026, 1, 1), date(2026, 12, 31), None, None, None, include_cycle_breakdown=False
    )
    grow = next(p for p in before["ponds"] if p["pond_id"] == dst.id)
    assert grow["fish_transfer_cost_in"] == "0.00"

    materialize_fish_sales_for_company(cid)
    after = compute_aquaculture_pl_summary_dict(
        cid, date(2026, 1, 1), date(2026, 12, 31), None, None, None, include_cycle_breakdown=False
    )
    grow = next(p for p in after["ponds"] if p["pond_id"] == dst.id)
    assert grow["fish_transfer_cost_in"] == "7000.00"


def test_credit_note_reverses_sale_stock_and_cost(company_tenant):
    from api.models import Customer, Invoice, InvoiceLine, Item, JournalEntry, JournalEntryLine
    from api.services.credit_note import post_credit_note, refund_credit_note
    from api.services.gl_posting import CODE_AR, CODE_CASH, CODE_COGS_SHOP, CODE_INV_SHOP, CODE_SHOP_REV

    cid = company_tenant.id
    ar = _acc(cid, CODE_AR, "AR", "asset", "accounts_receivable")
    rev = _acc(cid, CODE_SHOP_REV, "Shop sales", "income", "sales")
    cogs = _acc(cid, CODE_COGS_SHOP, "COGS", "cost_of_goods_sold", "cost_of_goods_sold")
    inv_acc = _acc(cid, CODE_INV_SHOP, "Shop inventory", "asset", "inventory")
    cash = _acc(cid, CODE_CASH, "Cash", "asset", "cash_on_hand")
    cust = Customer.objects.create(
        company_id=cid, display_name="Buyer", customer_number="C-1", current_balance=Decimal("0")
    )
    item = Item.objects.create(
        company_id=cid, name="Feed sack", item_type="inventory", cost=Decimal("40"),
        quantity_on_hand=Decimal("0"),
    )
    inv = Invoice.objects.create(
        company_id=cid, customer=cust, invoice_number="INV-1", invoice_date=date(2026, 4, 1),
        status="sent", subtotal=Decimal("100"), total=Decimal("100"), stock_relieved=True,
    )
    InvoiceLine.objects.create(
        invoice=inv, item=item, description="Feed", quantity=Decimal("2"),
        unit_price=Decimal("50"), amount=Decimal("100"),
        stock_relieved_quantity=Decimal("2"),
    )
    sale = JournalEntry.objects.create(
        company_id=cid, entry_number=f"AUTO-INV-{inv.id}-SALE", entry_date=inv.invoice_date,
        description="sale", is_posted=True,
    )
    JournalEntryLine.objects.create(journal_entry=sale, account=ar, debit=Decimal("100"), credit=0)
    JournalEntryLine.objects.create(journal_entry=sale, account=rev, debit=0, credit=Decimal("100"))
    cogs_je = JournalEntry.objects.create(
        company_id=cid, entry_number=f"AUTO-INV-{inv.id}-COGS", entry_date=inv.invoice_date,
        description="cogs", is_posted=True,
    )
    JournalEntryLine.objects.create(journal_entry=cogs_je, account=cogs, debit=Decimal("80"), credit=0)
    JournalEntryLine.objects.create(journal_entry=cogs_je, account=inv_acc, debit=0, credit=Decimal("80"))

    note = post_credit_note(cid, inv.id, amount=Decimal("100"), credit_date=date(2026, 4, 2))
    lines = list(note.journal_entry.lines.all())
    debits = sum(ln.debit for ln in lines)
    credits = sum(ln.credit for ln in lines)
    assert debits == credits == Decimal("180.00")
    assert sum(ln.debit for ln in lines if ln.account_id == rev.id) == Decimal("100.00")
    assert sum(ln.debit for ln in lines if ln.account_id == inv_acc.id) == Decimal("80.00")
    item.refresh_from_db()
    assert item.quantity_on_hand == Decimal("2")
    cust.refresh_from_db()
    assert cust.current_balance == Decimal("-100.00")

    refund_credit_note(cid, note.id, amount=Decimal("100"), refund_date=date(2026, 4, 3))
    note.refresh_from_db()
    assert note.refunded_amount == Decimal("100.00")
    refund_lines = list(note.refund_journal_entry.lines.all())
    assert sum(ln.credit for ln in refund_lines if ln.account_id == cash.id) == Decimal("100.00")
    cust.refresh_from_db()
    assert cust.current_balance == Decimal("0.00")


def test_year_end_close_moves_profit_and_drops_typed_opening(company_tenant):
    from api.models import JournalEntry, JournalEntryLine
    from api.services.fiscal_year_close import close_fiscal_year
    from api.services.reporting import report_balance_sheet

    cid = company_tenant.id
    income = _acc(cid, "4100", "Sales", "income", "sales")
    expense = _acc(cid, "6900", "Office", "expense", "office_general_administrative_expenses")
    cash = _acc(cid, "1010", "Cash", "asset", "cash_on_hand")
    retained = _acc(cid, "3100", "Retained Earnings", "equity", "retained_earnings")
    retained.opening_balance = Decimal("600.00")
    retained.save(update_fields=["opening_balance"])

    je = JournalEntry.objects.create(
        company_id=cid, entry_number="YEAR-TRADE", entry_date=date(2026, 6, 1),
        description="trade", is_posted=True,
    )
    JournalEntryLine.objects.create(journal_entry=je, account=cash, debit=Decimal("1000"), credit=0)
    JournalEntryLine.objects.create(journal_entry=je, account=income, debit=0, credit=Decimal("1000"))
    je2 = JournalEntry.objects.create(
        company_id=cid, entry_number="YEAR-EXP", entry_date=date(2026, 6, 2),
        description="exp", is_posted=True,
    )
    JournalEntryLine.objects.create(journal_entry=je2, account=expense, debit=Decimal("400"), credit=0)
    JournalEntryLine.objects.create(journal_entry=je2, account=cash, debit=0, credit=Decimal("400"))

    before = report_balance_sheet(cid, date(2026, 1, 1), date(2026, 12, 31))
    assert before["net_income_cumulative"] == "600.00"
    assert before["auto_plug_is_material"] is True

    closed = close_fiscal_year(cid, 2026)
    assert closed.net_income == Decimal("600.00")
    assert closed.opening_absorbed == Decimal("600.00")
    retained.refresh_from_db()
    assert retained.opening_balance == Decimal("0")
    after = report_balance_sheet(cid, date(2026, 1, 1), date(2026, 12, 31))
    assert after["net_income_cumulative"] == "0.00"
    assert after["auto_plug_is_material"] is False
    assert after["equity"]["total"] == "600.00"
    assert after["assets"]["total"] == "600.00"


def test_staff_advance_and_recovery_hit_1150(company_tenant):
    from api.models import Employee, EmployeeLedgerEntry, JournalEntryLine
    from api.services.employee_ledger_gl import sync_manual_employee_ledger_journal
    from api.services.gl_posting import CODE_CASH, CODE_EMP_ADVANCE

    cid = company_tenant.id
    cash = _acc(cid, CODE_CASH, "Cash", "asset", "cash_on_hand")
    advance = _acc(cid, CODE_EMP_ADVANCE, "Employee advances", "asset", "other_current_asset")
    _acc(cid, "2200", "Salaries payable", "liability", "accounts_payable")
    emp = Employee.objects.create(company_id=cid, first_name="Rina", last_name="Khan")
    given = EmployeeLedgerEntry.objects.create(
        employee=emp, entry_date=date(2026, 5, 1), entry_type="advance",
        credit=Decimal("500.00"), memo="advance",
    )
    sync_manual_employee_ledger_journal(cid, given)
    recovered = EmployeeLedgerEntry.objects.create(
        employee=emp, entry_date=date(2026, 5, 20), entry_type="recovery",
        debit=Decimal("200.00"), memo="recovery",
    )
    sync_manual_employee_ledger_journal(cid, recovered)
    lines = JournalEntryLine.objects.filter(account=advance, journal_entry__is_posted=True)
    net = sum((ln.debit or 0) - (ln.credit or 0) for ln in lines)
    assert net == Decimal("300.00")
    assert JournalEntryLine.objects.filter(account=cash, journal_entry__entry_number=f"AUTO-EMP-LE-{given.id}", credit=Decimal("500")).exists()


def test_bank_statement_matches_the_cash_account(company_tenant):
    from api.models import JournalEntry, JournalEntryLine
    from api.services.bank_reconciliation import create_bank_statement, reconciliation_report
    from api.services.gl_posting import CODE_CASH

    cid = company_tenant.id
    cash = _acc(cid, CODE_CASH, "Cash", "asset", "cash_on_hand")
    income = _acc(cid, "4100", "Sales", "income", "sales")
    je = JournalEntry.objects.create(
        company_id=cid, entry_number="DEP-1", entry_date=date(2026, 7, 1),
        description="deposit", is_posted=True,
    )
    cash_line = JournalEntryLine.objects.create(
        journal_entry=je, account=cash, debit=Decimal("250"), credit=0, description="deposit"
    )
    JournalEntryLine.objects.create(journal_entry=je, account=income, debit=0, credit=Decimal("250"))
    stmt = create_bank_statement(
        cid, cash.id, date(2026, 7, 31), Decimal("250.00"),
        [{"line_date": date(2026, 7, 1), "description": "deposit", "amount": "250.00"}],
    )
    report = reconciliation_report(stmt)
    assert report["difference"] == "0.00"
    assert report["matched_count"] == 1
    assert report["unmatched_statement_lines"] == []
    assert cash_line.id == stmt.lines.get().matched_journal_line_id


def test_landed_cost_adds_freight_and_duty_to_inventory(company_tenant):
    from api.models import Bill, BillLine, Item, Vendor
    from api.services.gl_posting import CODE_AP, CODE_INV_SHOP, _bill_line_receipt_value, _build_bill_journal_lines

    cid = company_tenant.id
    _acc(cid, CODE_AP, "AP", "liability", "accounts_payable")
    inv_acc = _acc(cid, CODE_INV_SHOP, "Shop inventory", "asset", "inventory")
    _acc(cid, "6900", "Office", "expense", "office_general_administrative_expenses")
    vendor = Vendor.objects.create(
        company_id=cid, vendor_number="V-1", company_name="Importer", is_active=True
    )
    item = Item.objects.create(
        company_id=cid, name="Pump", item_type="inventory", cost=Decimal("10"),
        quantity_on_hand=Decimal("0"),
    )
    bill = Bill.objects.create(
        company_id=cid, vendor=vendor, bill_number="B-LC-1", bill_date=date(2026, 8, 1),
        status="open", subtotal=Decimal("100"), tax_total=Decimal("0"), total=Decimal("130"),
        is_landed_cost=True, freight_total=Decimal("20"), duty_total=Decimal("10"),
    )
    line = BillLine.objects.create(
        bill=bill, item=item, description="Pump", quantity=Decimal("2"),
        unit_price=Decimal("50"), amount=Decimal("100"),
    )
    built = _build_bill_journal_lines(cid, bill)
    assert built is not None
    je_lines, _meta = built
    inventory_debit = sum(row[1] for row in je_lines if row[0].id == inv_acc.id)
    assert inventory_debit == Decimal("130.00")
    assert _bill_line_receipt_value(bill, line) == Decimal("130.00")
