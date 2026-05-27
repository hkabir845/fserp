"""
Professional accounting & business-rule audit for reports (fills gaps beyond smoke tests).

- P&L ↔ trial balance reconciliation on posted GL
- Unposted journals / draft documents excluded from GL and operational reports
- Single book currency (no FX conversion layer)
- CSV export parity vs API JSON (key financial reports)
- Role-based report access (403 vs 200)
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest
from django.utils import timezone

from api.models import (
    Bill,
    ChartOfAccount,
    Customer,
    Invoice,
    JournalEntry,
    JournalEntryLine,
    Vendor,
)
from api.services.coa_constants import is_pl_credit_normal_type, pl_bucket_for_coa
from api.services.permission_service import can_access_report, resolve_user_permissions
from api.services.reporting import (
    _period_income_statement_totals,
    report_expense_detail,
    report_income_detail,
    report_income_statement,
    report_purchase_report,
    report_sales_report,
    report_trial_balance,
)
from tests.report_csv_parity import (
    build_expense_detail_csv,
    build_income_detail_csv,
    build_income_statement_csv,
    parse_csv_total_row,
    parse_income_statement_net_from_csv,
)

pytestmark = pytest.mark.django_db


def _tb_pl_amount(coa: ChartOfAccount, debit: Decimal, credit: Decimal) -> Decimal:
    if is_pl_credit_normal_type(coa.account_type):
        return credit - debit
    return debit - credit


def _sum_tb_by_pl_bucket(tb: dict, company_id: int) -> dict[str, Decimal]:
    totals = {"income": Decimal("0"), "cost_of_goods_sold": Decimal("0"), "expense": Decimal("0")}
    codes = {row["account_code"]: row for row in tb["accounts"]}
    for coa in ChartOfAccount.objects.filter(company_id=company_id):
        bucket = pl_bucket_for_coa(coa.account_type, coa.account_sub_type, coa.account_code)
        if bucket not in totals:
            continue
        row = codes.get(coa.account_code)
        if not row:
            continue
        amt = _tb_pl_amount(coa, Decimal(str(row["debit"])), Decimal(str(row["credit"])))
        totals[bucket] += amt
    return totals


def test_pl_reconciles_with_trial_balance_period_activity(company_tenant_with_gl):
    """P&L section totals must match trial-balance period debits/credits on P&L accounts."""
    start = date(2026, 6, 1)
    end = date(2026, 6, 30)
    cid = company_tenant_with_gl.id
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")
    income = ChartOfAccount.objects.get(company_id=cid, account_code="4200")
    cogs = ChartOfAccount.objects.get(company_id=cid, account_code="5120")
    expense = ChartOfAccount.objects.get(company_id=cid, account_code="6900")

    je = JournalEntry.objects.create(
        company_id=cid,
        entry_number="AUDIT-PL-TB-1",
        entry_date=date(2026, 6, 15),
        description="audit reconciliation",
        is_posted=True,
        posted_at=timezone.now(),
    )
    # Income 300 credit
    JournalEntryLine.objects.create(
        journal_entry=je, account=income, debit=Decimal("0"), credit=Decimal("300")
    )
    # COGS 80 debit
    JournalEntryLine.objects.create(
        journal_entry=je, account=cogs, debit=Decimal("80"), credit=Decimal("0")
    )
    # Expense 50 debit
    JournalEntryLine.objects.create(
        journal_entry=je, account=expense, debit=Decimal("50"), credit=Decimal("0")
    )
    # Cash balancing line (debits 80+50+170 = credits 300)
    JournalEntryLine.objects.create(
        journal_entry=je, account=cash, debit=Decimal("170"), credit=Decimal("0")
    )

    pl = report_income_statement(cid, start, end)
    tb = report_trial_balance(cid, start, end)
    internal = _period_income_statement_totals(cid, start, end)
    tb_buckets = _sum_tb_by_pl_bucket(tb, cid)

    assert tb["debits_equal_credits"] is True
    assert Decimal(str(pl["income"]["total"])) == tb_buckets["income"] == internal["income"]
    assert Decimal(str(pl["cost_of_goods_sold"]["total"])) == tb_buckets["cost_of_goods_sold"] == internal["cogs"]
    assert Decimal(str(pl["expenses"]["total"])) == tb_buckets["expense"] == internal["expenses"]
    assert Decimal(str(pl["gross_profit"])) == internal["gross_profit"]
    assert Decimal(str(pl["net_income"])) == internal["net_income"]
    assert pl["period_matches_cumulative_change"] is True


def test_unposted_journal_excluded_from_pl_and_income_detail(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    start = date(2026, 7, 1)
    end = date(2026, 7, 31)
    income = ChartOfAccount.objects.get(company_id=cid, account_code="4200")
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")

    draft = JournalEntry.objects.create(
        company_id=cid,
        entry_number="AUDIT-DRAFT-JE",
        entry_date=date(2026, 7, 10),
        description="draft only",
        is_posted=False,
    )
    JournalEntryLine.objects.create(
        journal_entry=draft, account=income, debit=Decimal("0"), credit=Decimal("999")
    )
    JournalEntryLine.objects.create(
        journal_entry=draft, account=cash, debit=Decimal("999"), credit=Decimal("0")
    )

    posted = JournalEntry.objects.create(
        company_id=cid,
        entry_number="AUDIT-POSTED-JE",
        entry_date=date(2026, 7, 11),
        description="posted",
        is_posted=True,
        posted_at=timezone.now(),
    )
    JournalEntryLine.objects.create(
        journal_entry=posted, account=income, debit=Decimal("0"), credit=Decimal("120")
    )
    JournalEntryLine.objects.create(
        journal_entry=posted, account=cash, debit=Decimal("120"), credit=Decimal("0")
    )

    pl = report_income_statement(cid, start, end)
    inc = report_income_detail(cid, start, end)
    assert Decimal(str(pl["income"]["total"])) == Decimal("120.00")
    assert Decimal(str(inc["income"]["total"])) == Decimal("120.00")


def test_draft_invoice_excluded_from_sales_and_pl(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    cust = Customer.objects.create(
        company_id=cid,
        display_name="Audit Cust",
        customer_number="AC-1",
        current_balance=Decimal("0"),
    )
    Invoice.objects.create(
        company_id=cid,
        customer=cust,
        invoice_number="INV-DRAFT-AUDIT",
        invoice_date=date(2026, 8, 5),
        status="draft",
        subtotal=Decimal("500"),
        tax_total=Decimal("0"),
        total=Decimal("500"),
        payment_method="cash",
    )
    Invoice.objects.create(
        company_id=cid,
        customer=cust,
        invoice_number="INV-SENT-AUDIT",
        invoice_date=date(2026, 8, 6),
        status="sent",
        subtotal=Decimal("75"),
        tax_total=Decimal("0"),
        total=Decimal("75"),
        payment_method="cash",
    )

    sales = report_sales_report(cid, date(2026, 8, 1), date(2026, 8, 31))
    assert Decimal(str(sales["summary"]["grand_total"])) == Decimal("75")
    assert sales["summary"]["cash_invoice_count"] == 1

    # No invoice GL for draft/sent without post — P&L stays 0
    pl = report_income_statement(cid, date(2026, 8, 1), date(2026, 8, 31))
    assert Decimal(str(pl["income"]["total"])) == Decimal("0")


def test_draft_bill_excluded_from_purchase_report(company_tenant):
    vendor = Vendor.objects.create(
        company_id=company_tenant.id,
        company_name="Audit Vendor",
        display_name="Audit Vendor",
        vendor_number="AV-1",
    )
    Bill.objects.create(
        company_id=company_tenant.id,
        vendor=vendor,
        bill_number="BILL-DRAFT-AUDIT",
        bill_date=date(2026, 8, 8),
        status="draft",
        subtotal=Decimal("400"),
        tax_total=Decimal("0"),
        total=Decimal("400"),
    )
    Bill.objects.create(
        company_id=company_tenant.id,
        vendor=vendor,
        bill_number="BILL-OPEN-AUDIT",
        bill_date=date(2026, 8, 9),
        status="open",
        subtotal=Decimal("60"),
        tax_total=Decimal("0"),
        total=Decimal("60"),
    )

    pr = report_purchase_report(company_tenant.id, date(2026, 8, 1), date(2026, 8, 31))
    assert Decimal(str(pr["summary"]["grand_total"])) == Decimal("60")


def test_single_book_currency_no_fx_fields_on_pl(company_tenant_with_gl):
    """Tenant books one currency; reports return plain amounts (no FX conversion)."""
    from api.models import Company

    Company.objects.filter(pk=company_tenant_with_gl.id).update(currency="BDT")
    pl = report_income_statement(
        company_tenant_with_gl.id, date(2026, 1, 1), date(2026, 1, 31)
    )
    assert pl["report_id"] == "income-statement"
    assert "fx" not in json.dumps(pl).lower()
    assert "exchange_rate" not in json.dumps(pl).lower()
    for section in ("income", "cost_of_goods_sold", "expenses"):
        for acc in pl[section]["accounts"]:
            assert isinstance(acc["balance"], (int, float))


def test_csv_export_matches_api_json_for_pl_reports(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    start = date(2026, 9, 1)
    end = date(2026, 9, 30)
    income = ChartOfAccount.objects.get(company_id=cid, account_code="4100")
    cogs = ChartOfAccount.objects.get(company_id=cid, account_code="5100")
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")
    je = JournalEntry.objects.create(
        company_id=cid,
        entry_number="AUDIT-CSV-1",
        entry_date=date(2026, 9, 12),
        is_posted=True,
        posted_at=timezone.now(),
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=income, debit=Decimal("0"), credit=Decimal("200")
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=cogs, debit=Decimal("40"), credit=Decimal("0")
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=cash, debit=Decimal("40"), credit=Decimal("200")
    )

    pl = report_income_statement(cid, start, end)
    exp = report_expense_detail(cid, start, end)
    inc = report_income_detail(cid, start, end)

    pl_csv = build_income_statement_csv(pl)
    assert parse_income_statement_net_from_csv(pl_csv) == Decimal(str(pl["net_income"]))
    assert "Cost of Goods Sold" in pl_csv

    exp_csv = build_expense_detail_csv(exp)
    assert parse_csv_total_row(exp_csv) == Decimal(str(exp["expenses"]["total"]))

    inc_csv = build_income_detail_csv(inc)
    assert parse_csv_total_row(inc_csv) == Decimal(str(inc["income"]["total"]))


def test_operator_role_denied_income_statement(
    api_client, company_tenant_with_gl, user_operator, auth_operator_headers
):
    h = {**auth_operator_headers, "HTTP_X_COMPANY_ID": str(company_tenant_with_gl.id)}
    r = api_client.get(
        "/api/reports/income-statement/",
        {"start_date": "2026-01-01", "end_date": "2026-01-31"},
        **h,
    )
    assert r.status_code == 403
    data = json.loads(r.content)
    assert data.get("report_id") == "income-statement"


def test_accountant_role_allowed_income_statement(
    api_client, company_tenant_with_gl, auth_accountant_headers
):
    h = {**auth_accountant_headers, "HTTP_X_COMPANY_ID": str(company_tenant_with_gl.id)}
    r = api_client.get(
        "/api/reports/income-statement/",
        {"start_date": "2026-01-01", "end_date": "2026-01-31"},
        **h,
    )
    assert r.status_code == 200
    assert json.loads(r.content).get("report_id") == "income-statement"


def test_inventory_clerk_denied_pl_allowed_inventory_report(
    api_client, company_tenant_with_gl, user_inventory_clerk, auth_inventory_clerk_headers
):
    h = {**auth_inventory_clerk_headers, "HTTP_X_COMPANY_ID": str(company_tenant_with_gl.id)}
    pl = api_client.get(
        "/api/reports/income-statement/",
        {"start_date": "2026-01-01", "end_date": "2026-01-31"},
        **h,
    )
    assert pl.status_code == 403

    inv = api_client.get(
        "/api/reports/inventory-sku-valuation/",
        {"start_date": "2026-01-01", "end_date": "2026-01-31"},
        **h,
    )
    assert inv.status_code == 200
    assert json.loads(inv.content).get("report_id") == "inventory-sku-valuation"


def test_can_access_report_matrix_documents_business_rules():
    """Permission matrix: POS-only vs reports module vs inventory SKU."""
    op = resolve_user_permissions(type("U", (), {"role": "operator", "custom_role": None})())
    acct = resolve_user_permissions(
        type("U", (), {"role": "accountant", "custom_role": None})()
    )
    inv = resolve_user_permissions(
        type("U", (), {"role": "inventory_clerk", "custom_role": None})()
    )
    assert can_access_report(op, "income-statement") is False
    assert can_access_report(acct, "income-statement") is True
    assert can_access_report(inv, "income-statement") is False
    assert can_access_report(inv, "inventory-sku-valuation") is True
