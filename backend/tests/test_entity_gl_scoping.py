"""Entity dimension tagging for per-station / per-pond financial reports."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest
from django.utils import timezone

from api.exceptions import GlPostingError
from api.models import (
    AquaculturePond,
    Bill,
    BillLine,
    ChartOfAccount,
    Customer,
    Invoice,
    InvoiceLine,
    Item,
    JournalEntry,
    JournalEntryLine,
    PayrollRun,
    Station,
    Vendor,
)
from api.services.entity_gl_scoping import (
    audit_entity_gl_scoping,
    manual_je_entity_scoping_warnings,
    validate_bill_entity_tags_for_gl,
    validate_invoice_entity_tags_for_gl,
    validate_payroll_entity_tags_for_gl,
)
from api.services.gl_posting import post_payroll_salary, sync_posted_vendor_bill, sync_invoice_gl
from api.services.reporting import report_income_statement

pytestmark = pytest.mark.django_db


def test_journal_post_rejects_unscoped_pl_line(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    """Posting blocks when income/COGS/expense lines lack station or pond."""
    cid = company_tenant_with_gl.id
    expense = ChartOfAccount.objects.get(company_id=cid, account_code="6900")
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")
    je = JournalEntry.objects.create(
        company_id=cid,
        entry_number="JE-BLOCK-SCOPE",
        entry_date=date(2026, 11, 8),
        is_posted=False,
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=expense, debit=Decimal("40"), credit=Decimal("0")
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=cash, debit=Decimal("0"), credit=Decimal("40")
    )

    r = api_client.post(
        f"/api/journal-entries/{je.id}/post/",
        data=json.dumps({}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400, r.content.decode()
    body = json.loads(r.content.decode())
    assert body.get("code") == "entity_scoping_required"
    je.refresh_from_db()
    assert je.is_posted is False


def test_journal_post_applies_header_station_to_unscoped_pl(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    """Default site on the entry is copied to untagged P&L lines at post time."""
    cid = company_tenant_with_gl.id
    st = Station.objects.create(company_id=cid, station_name="Post Default Site", is_active=True)
    expense = ChartOfAccount.objects.get(company_id=cid, account_code="6900")
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")
    je = JournalEntry.objects.create(
        company_id=cid,
        entry_number="JE-HEADER-STATION",
        entry_date=date(2026, 11, 9),
        station_id=st.id,
        is_posted=False,
    )
    exp_line = JournalEntryLine.objects.create(
        journal_entry=je, account=expense, debit=Decimal("75"), credit=Decimal("0")
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=cash, debit=Decimal("0"), credit=Decimal("75")
    )

    r = api_client.post(
        f"/api/journal-entries/{je.id}/post/",
        data=json.dumps({}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    exp_line.refresh_from_db()
    assert exp_line.station_id == st.id
    je.refresh_from_db()
    assert je.is_posted is True


def test_manual_je_with_pond_tag_appears_on_pond_pl_only(company_tenant_with_gl):
    """Manual journal lines tagged to a pond belong on that pond's P&L, not on station P&L."""
    cid = company_tenant_with_gl.id
    st = Station.objects.create(company_id=cid, station_name="Shop Hub", is_active=True)
    pond = AquaculturePond.objects.create(company_id=cid, name="Tagged Pond", is_active=True)
    expense = ChartOfAccount.objects.get(company_id=cid, account_code="6900")
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")

    je = JournalEntry.objects.create(
        company_id=cid,
        entry_number="JE-POND-MANUAL",
        entry_date=date(2026, 11, 5),
        station_id=st.id,
        is_posted=True,
        posted_at=timezone.now(),
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=expense,
        station_id=st.id,
        aquaculture_pond_id=pond.id,
        debit=Decimal("120"),
        credit=Decimal("0"),
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=cash,
        station_id=st.id,
        aquaculture_pond_id=pond.id,
        debit=Decimal("0"),
        credit=Decimal("120"),
    )

    start, end = date(2026, 11, 1), date(2026, 11, 30)
    pl_st = report_income_statement(cid, start, end, station_id=st.id)
    pl_pond = report_income_statement(cid, start, end, pond_id=pond.id)

    assert Decimal(str(pl_st["expenses"]["total"])) == Decimal("0")
    assert Decimal(str(pl_pond["expenses"]["total"])) == Decimal("120.00")


def test_manual_je_unscoped_pl_line_triggers_warning(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    expense = ChartOfAccount.objects.get(company_id=cid, account_code="6900")
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")
    je = JournalEntry.objects.create(
        company_id=cid,
        entry_number="JE-UNSCOPED",
        entry_date=date(2026, 11, 6),
        is_posted=False,
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=expense, debit=Decimal("50"), credit=Decimal("0")
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=cash, debit=Decimal("0"), credit=Decimal("50")
    )
    warnings = manual_je_entity_scoping_warnings(je)
    assert len(warnings) >= 1
    assert "no station or pond tag" in warnings[0].lower()


def test_audit_entity_gl_scoping_counts_unscoped_pl(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    income = ChartOfAccount.objects.get(company_id=cid, account_code="4200")
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")
    je = JournalEntry.objects.create(
        company_id=cid,
        entry_number="AUDIT-UNSCOPED",
        entry_date=date(2026, 11, 7),
        is_posted=True,
        posted_at=timezone.now(),
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=income, debit=Decimal("0"), credit=Decimal("10")
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=cash, debit=Decimal("10"), credit=Decimal("0")
    )
    out = audit_entity_gl_scoping(cid)
    assert out["unscoped_pl_line_count"] >= 1


def test_bill_expense_post_blocks_without_receipt_station(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    vendor = Vendor.objects.create(
        company_id=cid, display_name="Office Vendor", vendor_number="V-SCOPE", is_active=True
    )
    bill = Bill.objects.create(
        company_id=cid,
        vendor=vendor,
        bill_number="BILL-NO-ST",
        bill_date=date(2026, 11, 10),
        status="open",
        total=Decimal("50"),
    )
    BillLine.objects.create(
        bill=bill,
        description="Consulting",
        quantity=Decimal("1"),
        unit_price=Decimal("50"),
        amount=Decimal("50"),
    )
    with pytest.raises(GlPostingError, match="receipt station or pond"):
        validate_bill_entity_tags_for_gl(cid, bill)
    with pytest.raises(GlPostingError):
        sync_posted_vendor_bill(cid, bill)


def test_bill_inventory_post_allows_without_receipt_station(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    inv_acc = ChartOfAccount.objects.get(company_id=cid, account_code="1220")
    item = Item.objects.create(
        company_id=cid,
        name="Shop part",
        item_type="inventory",
        unit="piece",
        inventory_account=inv_acc,
        is_active=True,
    )
    vendor = Vendor.objects.create(
        company_id=cid, display_name="Parts Vendor", vendor_number="V-INV", is_active=True
    )
    bill = Bill.objects.create(
        company_id=cid,
        vendor=vendor,
        bill_number="BILL-INV-OK",
        bill_date=date(2026, 11, 11),
        status="open",
        total=Decimal("30"),
    )
    BillLine.objects.create(
        bill=bill,
        item=item,
        description=item.name,
        quantity=Decimal("3"),
        unit_price=Decimal("10"),
        amount=Decimal("30"),
    )
    validate_bill_entity_tags_for_gl(cid, bill)
    assert sync_posted_vendor_bill(cid, bill) is True


def test_invoice_post_blocks_without_station_or_pond(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    cust = Customer.objects.create(
        company_id=cid, display_name="Retail", customer_number="C-NOST", is_active=True
    )
    inv_acc = ChartOfAccount.objects.get(company_id=cid, account_code="1220")
    cogs_acc = ChartOfAccount.objects.get(company_id=cid, account_code="5120")
    item = Item.objects.create(
        company_id=cid,
        name="Widget",
        item_type="inventory",
        unit="piece",
        cost=Decimal("5"),
        unit_price=Decimal("12"),
        inventory_account=inv_acc,
        cogs_account=cogs_acc,
        is_active=True,
    )
    inv = Invoice.objects.create(
        company_id=cid,
        customer=cust,
        invoice_number="INV-NO-ST",
        invoice_date=date(2026, 11, 12),
        status="paid",
        subtotal=Decimal("24"),
        total=Decimal("24"),
        payment_method="cash",
    )
    InvoiceLine.objects.create(
        invoice=inv,
        item=item,
        quantity=Decimal("2"),
        unit_price=Decimal("12"),
        amount=Decimal("24"),
    )
    with pytest.raises(GlPostingError, match="selling site"):
        validate_invoice_entity_tags_for_gl(cid, inv)
    with pytest.raises(GlPostingError):
        sync_invoice_gl(cid, inv)


def test_payroll_post_blocks_without_station_or_pond_split(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    pr = PayrollRun.objects.create(
        company_id=cid,
        payroll_number="PR-NO-SITE",
        pay_period_start=date(2026, 11, 1),
        pay_period_end=date(2026, 11, 30),
        payment_date=date(2026, 11, 30),
        total_gross=Decimal("1000"),
        total_deductions=Decimal("0"),
        total_net=Decimal("1000"),
        status="approved",
    )
    with pytest.raises(GlPostingError, match="payroll site"):
        validate_payroll_entity_tags_for_gl(
            cid, pr, split_by_pond=False, split_mixed_entities=False
        )
    _je, err = post_payroll_salary(cid, pr)
    assert _je is None
    assert err
    assert any(
        phrase in err.lower()
        for phrase in ("payroll site", "pond", "6400", "salaries")
    )
