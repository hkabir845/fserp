"""Regression coverage for the broader application review."""
from collections import defaultdict
from datetime import date
from decimal import Decimal

import pytest

from tests.test_invoice_stock_relief import _books
from tests.test_pos_sale_scope import _fuel_nozzle

pytestmark = pytest.mark.django_db


@pytest.fixture(scope="session")
def django_db_modify_db_settings():
    from django.conf import settings

    settings.DATABASES["default"].setdefault("TEST", {})["NAME"] = "test_fserp_followup_fixes"


@pytest.mark.parametrize("bad_line", [
    None, {}, {"item_id": 99999999, "quantity": "1"},
    {"quantity": "0"}, {"quantity": "bad"}, {"quantity": "NaN"},
    {"quantity": "Infinity"}, {"quantity": "1", "unit_price": "bad"},
    {"quantity": "1", "unit_price": "-1"},
    {"quantity": "1", "discount_percent": "NaN"},
])
def test_bad_shop_line_rejects_entire_sale(api_client, auth_super_headers, company_tenant, bad_line):
    from api.models import Invoice
    from api.services.station_stock import get_station_stock

    cid, site, item, _ = _books(company_tenant)
    if isinstance(bad_line, dict) and bad_line:
        bad_line = {"item_id": item.id, **bad_line}
    response = api_client.post(
        "/api/cashier/pos/",
        {"station_id": site.id, "items": [{"item_id": item.id, "quantity": "1"}, bad_line]},
        content_type="application/json",
        **dict(auth_super_headers, HTTP_X_SELECTED_COMPANY_ID=str(cid)),
    )
    assert response.status_code == 400, response.content
    assert not Invoice.objects.filter(company_id=cid).exists()
    assert get_station_stock(cid, site.id, item.id) == Decimal("10")


@pytest.mark.parametrize("quantity", [None, "0", "bad", "NaN", "Infinity"])
def test_bad_fuel_line_rejects_entire_sale(api_client, auth_super_headers, company_tenant, quantity):
    from api.models import Invoice

    cid, site, item, _ = _books(company_tenant)
    nozzle = _fuel_nozzle(company_tenant)
    response = api_client.post(
        "/api/cashier/pos/",
        {"station_id": site.id, "items": [{"item_id": item.id, "quantity": "1"}],
         "fuel_lines": [{"nozzle_id": nozzle.id, "quantity": quantity}]},
        content_type="application/json",
        **dict(auth_super_headers, HTTP_X_SELECTED_COMPANY_ID=str(cid)),
    )
    assert response.status_code == 400, response.content
    assert not Invoice.objects.filter(company_id=cid).exists()


def test_meter_rollover_sale_reversal(company_tenant, api_client, auth_super_headers):
    from api.models import Invoice
    from tests.conftest import seed_min_gl_accounts

    seed_min_gl_accounts(company_tenant)
    nozzle = _fuel_nozzle(company_tenant)
    meter = nozzle.meter
    meter.current_reading = Decimal("999")
    meter.max_reading = Decimal("999")
    meter.save()
    headers = dict(auth_super_headers, HTTP_X_SELECTED_COMPANY_ID=str(company_tenant.id))
    response = api_client.post(
        "/api/cashier/pos/",
        {"station_id": nozzle.tank.station_id, "fuel_lines": [{"nozzle_id": nozzle.id, "quantity": "3"}]},
        content_type="application/json", **headers,
    )
    assert response.status_code == 201, response.content
    meter.refresh_from_db()
    assert meter.current_reading == Decimal("2")
    inv = Invoice.objects.get(company_id=company_tenant.id)
    response = api_client.delete(f"/api/invoices/{inv.id}/", **headers)
    assert response.status_code == 204, response.content
    meter.refresh_from_db()
    assert meter.current_reading == Decimal("999")


def test_used_account_type_cannot_rewrite_history(api_client, auth_super_headers, company_tenant):
    from api.models import ChartOfAccount
    from api.services.gl_posting import sync_invoice_gl
    from tests.test_invoice_stock_relief import _invoice

    cid, site, item, customer = _books(company_tenant)
    sync_invoice_gl(cid, _invoice(cid, site, item, customer))
    account = ChartOfAccount.objects.get(company_id=cid, account_code="1100")
    response = api_client.put(
        f"/api/chart-of-accounts/{account.id}/", {"account_type": "income"},
        content_type="application/json",
        **dict(auth_super_headers, HTTP_X_SELECTED_COMPANY_ID=str(cid)),
    )
    assert response.status_code == 400, response.content
    account.refresh_from_db()
    assert account.account_type == "asset"


def test_accrued_interest_payment_reversal_is_exact(api_client, auth_super_headers, company_tenant):
    from api.models import Loan, LoanRepayment
    from api.services.loan_posting import reverse_loan_repayment, unsettled_accrued_interest
    from tests.test_accounting_audit_wave_c2 import test_paying_principal_to_zero_does_not_close_while_interest_is_unsettled

    test_paying_principal_to_zero_does_not_close_while_interest_is_unsettled(
        api_client, auth_super_headers, company_tenant
    )
    loan = Loan.objects.get(company_id=company_tenant.id)
    repayment = LoanRepayment.objects.get(loan=loan, interest_amount=Decimal("50"))
    assert reverse_loan_repayment(company_tenant.id, repayment, date(2026, 6, 6))
    repayment.refresh_from_db()
    balances = defaultdict(Decimal)
    for journal in (repayment.journal_entry, repayment.reversal_journal_entry):
        for line in journal.lines.all():
            balances[(line.account_id, line.station_id)] += line.debit - line.credit
    assert all(value == 0 for value in balances.values()), balances
    loan.refresh_from_db()
    assert unsettled_accrued_interest(loan) == Decimal("50")
    assert loan.status == "active"
    assert not reverse_loan_repayment(company_tenant.id, repayment, date(2026, 6, 6))


def test_sku_valuation_excludes_fish_and_unposted_sales(company_tenant):
    from api.models import Item
    from api.services.reporting import report_inventory_sku_valuation
    from api.services.books_audit import subledger_control_checks
    from tests.test_invoice_stock_relief import _invoice

    cid, site, item, customer = _books(company_tenant)
    Item.objects.create(company_id=cid, name="Live fish", pos_category="fish", unit="pcs",
                        quantity_on_hand=1000000, cost=200)
    _invoice(cid, site, item, customer, status="draft", number="DRAFT")
    _invoice(cid, site, item, customer, status="void", number="VOID")
    _invoice(cid, site, item, customer, status="sent", number="POSTED")
    report = report_inventory_sku_valuation(cid, date(2026, 1, 1), date(2026, 12, 31))
    assert [row["item_id"] for row in report["rows"]] == [item.id]
    assert Decimal(report["summary"]["total_period_quantity_sold"]) == 3
    assert Decimal(report["summary"]["total_cost_value"]) == 2000
    check = next(row for row in subledger_control_checks(cid) if row["check"] == "inventory_vs_control")
    assert Decimal(check["gl_balance"]) == 0
    assert Decimal(check["difference"]) == 2000


def test_books_audit_control_uses_openings_and_as_of_date(company_tenant):
    from api.models import JournalEntry, JournalEntryLine
    from api.services.books_audit import _control_account_balance
    from tests.test_invoice_stock_relief import _acc

    cid = company_tenant.id
    account = _acc(cid, "2000", "Accounts Payable", "liability")
    account.opening_balance = Decimal("100")
    account.opening_balance_date = date(2026, 1, 1)
    account.save()
    entry = JournalEntry.objects.create(company_id=cid, entry_number="FUTURE",
                                        entry_date=date(2027, 1, 1), is_posted=True)
    JournalEntryLine.objects.create(journal_entry=entry, account=account, credit=50)
    assert _control_account_balance(cid, "2000", date(2026, 12, 31)) == Decimal("-100")
    assert _control_account_balance(cid, "2000", date(2027, 1, 1)) == Decimal("-150")
