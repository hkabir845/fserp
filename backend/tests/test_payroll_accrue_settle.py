"""A0-9: accrue wages to 2200, settle net, remit 2210."""
from __future__ import annotations

import json
from decimal import Decimal

import pytest
from django.test import Client

pytestmark = pytest.mark.django_db


def _seed_payroll_coa(cid: int):
    from api.models import BankAccount, ChartOfAccount

    ChartOfAccount.objects.get_or_create(
        company_id=cid,
        account_code="6400",
        defaults={
            "account_name": "Salaries & Wages",
            "account_type": "expense",
            "account_sub_type": "payroll_expenses",
        },
    )
    bank_coa, _ = ChartOfAccount.objects.get_or_create(
        company_id=cid,
        account_code="1030",
        defaults={
            "account_name": "Bank Operating",
            "account_type": "asset",
            "account_sub_type": "bank",
        },
    )
    bank = BankAccount.objects.create(
        company_id=cid,
        chart_account=bank_coa,
        account_name="Payroll Bank",
        account_number="0099",
        bank_name="Test Bank",
    )
    return bank, bank_coa


def _create_run_from_employee(api_client: Client, headers, cid: int, *, salary="4000.00", deductions="0"):
    from api.models import Employee

    Employee.objects.create(
        company_id=cid,
        employee_code="PAY-A09",
        employee_number="E-A09",
        first_name="Wage",
        last_name="Staff",
        salary=Decimal(salary),
        is_active=True,
    )
    r = api_client.post(
        "/api/payroll/",
        data=json.dumps(
            {
                "pay_period_start": "2026-07-01",
                "pay_period_end": "2026-07-31",
                "payment_date": "2026-07-31",
            }
        ),
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 201, r.content.decode()
    pid = json.loads(r.content)["id"]
    r = api_client.post(
        f"/api/payroll/{pid}/from-employees/",
        data="{}",
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 200, r.content.decode()
    if Decimal(deductions) > 0:
        r = api_client.put(
            f"/api/payroll/{pid}/",
            data=json.dumps({"total_deductions": deductions}),
            content_type="application/json",
            **headers,
        )
        assert r.status_code == 200, r.content.decode()
    return pid


def test_accrue_credits_salaries_payable_not_bank(
    api_client: Client, auth_admin_headers, user_admin
):
    from api.models import JournalEntryLine

    cid = user_admin.company_id
    bank, _ = _seed_payroll_coa(cid)
    pid = _create_run_from_employee(api_client, auth_admin_headers, cid, salary="4000.00")

    r = api_client.post(
        f"/api/payroll/{pid}/post-to-books/",
        data=json.dumps({"mode": "accrue", "bank_account_id": bank.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    d = json.loads(r.content)
    assert d["status"] == "accrued"
    assert d["needs_net_settle"] is True
    assert d["is_salary_posted"] is True

    payable = JournalEntryLine.objects.filter(
        journal_entry_id=d["salary_journal_entry_id"], account__account_code="2200"
    )
    assert sum((ln.credit for ln in payable), Decimal("0")) == Decimal("4000.00")
    bank_lines = JournalEntryLine.objects.filter(
        journal_entry_id=d["salary_journal_entry_id"], account__account_code="1030"
    )
    assert not bank_lines.filter(credit__gt=0).exists()


def test_settle_debits_2200_and_cash_pay_cannot_settle_again(
    api_client: Client, auth_admin_headers, user_admin
):
    from api.models import Employee, JournalEntryLine

    cid = user_admin.company_id
    bank, _ = _seed_payroll_coa(cid)
    pid = _create_run_from_employee(api_client, auth_admin_headers, cid)

    r = api_client.post(
        f"/api/payroll/{pid}/post-to-books/",
        data=json.dumps({"mode": "accrue"}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()

    r = api_client.post(
        f"/api/payroll/{pid}/settle-net-pay/",
        data=json.dumps({"bank_account_id": bank.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    d = json.loads(r.content)
    assert d["status"] == "paid"
    assert d["needs_net_settle"] is False
    settle_id = d["net_pay_journal_entry_id"]
    assert settle_id
    assert JournalEntryLine.objects.filter(
        journal_entry_id=settle_id, account__account_code="2200", debit=Decimal("4000.00")
    ).exists()
    assert JournalEntryLine.objects.filter(
        journal_entry_id=settle_id, account__account_code="1030", credit=Decimal("4000.00")
    ).exists()

    Employee.objects.filter(company_id=cid, employee_code="PAY-A09").update(is_active=False)
    Employee.objects.create(
        company_id=cid,
        employee_code="PAY-A09B",
        employee_number="E-A09B",
        first_name="Cash",
        last_name="Paid",
        salary=Decimal("2500.00"),
        is_active=True,
    )
    r = api_client.post(
        "/api/payroll/",
        data=json.dumps(
            {
                "pay_period_start": "2026-08-01",
                "pay_period_end": "2026-08-31",
                "payment_date": "2026-08-31",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    cash_pid = json.loads(r.content)["id"]
    r = api_client.post(
        f"/api/payroll/{cash_pid}/from-employees/",
        data="{}",
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    r = api_client.post(
        f"/api/payroll/{cash_pid}/post-to-books/",
        data=json.dumps({"mode": "pay", "bank_account_id": bank.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    r = api_client.post(
        f"/api/payroll/{cash_pid}/settle-net-pay/",
        data=json.dumps({"bank_account_id": bank.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400, r.content.decode()
    assert "already credited" in r.content.decode().lower()


def test_remit_debits_statutory_deductions_payable(
    api_client: Client, auth_admin_headers, user_admin
):
    from api.models import JournalEntryLine

    cid = user_admin.company_id
    bank, _ = _seed_payroll_coa(cid)
    pid = _create_run_from_employee(
        api_client, auth_admin_headers, cid, salary="5000.00", deductions="500.00"
    )
    r = api_client.post(
        f"/api/payroll/{pid}/post-to-books/",
        data=json.dumps({"mode": "pay", "bank_account_id": bank.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    d = json.loads(r.content)
    assert d["needs_deduction_remit"] is True
    assert JournalEntryLine.objects.filter(
        journal_entry_id=d["salary_journal_entry_id"],
        account__account_code="2210",
        credit=Decimal("500.00"),
    ).exists()

    r = api_client.post(
        f"/api/payroll/{pid}/remit-deductions/",
        data=json.dumps({"bank_account_id": bank.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    d = json.loads(r.content)
    assert d["needs_deduction_remit"] is False
    remit_id = d["deduction_remittance_journal_entry_id"]
    assert JournalEntryLine.objects.filter(
        journal_entry_id=remit_id, account__account_code="2210", debit=Decimal("500.00")
    ).exists()
    assert JournalEntryLine.objects.filter(
        journal_entry_id=remit_id, account__account_code="1030", credit=Decimal("500.00")
    ).exists()
