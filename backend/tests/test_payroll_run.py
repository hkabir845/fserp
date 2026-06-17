"""Payroll run API (company-scoped headers)."""
from __future__ import annotations

import json

import pytest
from django.test import Client


@pytest.mark.django_db
def test_payroll_list_create_get_delete(api_client: Client, auth_admin_headers):
    r = api_client.get("/api/payroll/", **auth_admin_headers)
    assert r.status_code == 200
    assert json.loads(r.content) == []

    body = {
        "pay_period_start": "2026-04-01",
        "pay_period_end": "2026-04-15",
        "payment_date": "2026-04-15",
        "notes": "April half",
    }
    r = api_client.post(
        "/api/payroll/",
        data=json.dumps(body),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    data = json.loads(r.content)
    assert data["payroll_number"].startswith("PR-")
    assert data["status"] == "draft"
    assert data["total_net"] == 0.0
    pid = data["id"]

    r = api_client.get(f"/api/payroll/{pid}/", **auth_admin_headers)
    assert r.status_code == 200

    r = api_client.delete(f"/api/payroll/{pid}/", **auth_admin_headers)
    assert r.status_code == 200


@pytest.mark.django_db
def test_payroll_from_employees_and_post_to_books(
    api_client: Client, auth_admin_headers, user_admin
):
    from decimal import Decimal

    from api.models import BankAccount, ChartOfAccount, Employee, EmployeeLedgerEntry

    cid = user_admin.company_id
    # Minimum chart lines for template-style posting
    ChartOfAccount.objects.get_or_create(
        company_id=cid,
        account_code="6400",
        defaults={
            "account_name": "Salaries & Wages",
            "account_type": "expense",
            "account_sub_type": "payroll_expenses",
        },
    )
    bcoa, _ = ChartOfAccount.objects.get_or_create(
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
        chart_account=bcoa,
        account_name="Payroll Bank",
        account_number="0001",
        bank_name="Test Bank",
    )
    Employee.objects.create(
        company_id=cid,
        employee_code="E1",
        employee_number="E1",
        first_name="A",
        last_name="B",
        salary=Decimal("5000.00"),
        is_active=True,
    )
    r = api_client.post(
        "/api/payroll/",
        data=json.dumps(
            {
                "pay_period_start": "2026-04-01",
                "pay_period_end": "2026-04-30",
                "payment_date": "2026-04-30",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    pid = json.loads(r.content)["id"]

    r = api_client.post(
        f"/api/payroll/{pid}/from-employees/",
        data="{}",
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    d = json.loads(r.content)
    assert d["total_gross"] == 5000.0
    assert d["total_net"] == 5000.0
    assert d["is_salary_posted"] is False

    r = api_client.post(
        f"/api/payroll/{pid}/post-to-books/",
        data=json.dumps({"bank_account_id": bank.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    d = json.loads(r.content)
    assert d["is_salary_posted"] is True
    assert d["status"] == "paid"
    assert d.get("salary_journal_entry_id")
    assert "message" in d

    emp = Employee.objects.filter(company_id=cid, employee_code="E1").first()
    assert emp is not None
    assert EmployeeLedgerEntry.objects.filter(employee_id=emp.id).count() == 2
    emp.refresh_from_db()
    assert Decimal(str(emp.current_balance)) == Decimal("0")


@pytest.mark.django_db
def test_payroll_post_to_books_uses_chart_account_without_bank_register(
    api_client: Client, auth_admin_headers, user_admin
):
    """Net pay can credit a GL bank/cash line when no bank register is used."""
    from decimal import Decimal

    from api.models import ChartOfAccount, Employee, EmployeeLedgerEntry

    cid = user_admin.company_id
    ChartOfAccount.objects.get_or_create(
        company_id=cid,
        account_code="6400",
        defaults={
            "account_name": "Salaries & Wages",
            "account_type": "expense",
            "account_sub_type": "payroll_expenses",
        },
    )
    bcoa, _ = ChartOfAccount.objects.get_or_create(
        company_id=cid,
        account_code="1030",
        defaults={
            "account_name": "Bank Operating",
            "account_type": "asset",
            "account_sub_type": "bank",
        },
    )
    Employee.objects.create(
        company_id=cid,
        employee_code="E1",
        employee_number="E1",
        first_name="A",
        last_name="B",
        salary=Decimal("3000.00"),
        is_active=True,
    )
    r = api_client.post(
        "/api/payroll/",
        data=json.dumps(
            {
                "pay_period_start": "2026-04-01",
                "pay_period_end": "2026-04-30",
                "payment_date": "2026-04-30",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    pid = json.loads(r.content)["id"]
    r = api_client.post(
        f"/api/payroll/{pid}/from-employees/",
        data="{}",
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    r = api_client.post(
        f"/api/payroll/{pid}/post-to-books/",
        data=json.dumps({"pay_from_chart_account_id": bcoa.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    d = json.loads(r.content)
    assert d["is_salary_posted"] is True

    emp = Employee.objects.filter(company_id=cid, employee_code="E1").first()
    assert emp is not None
    assert EmployeeLedgerEntry.objects.filter(employee_id=emp.id).count() == 2


@pytest.mark.django_db
def test_payroll_put_earning_breakdown_sets_total_gross(api_client: Client, auth_admin_headers):
    """base + overtime + bonus + other → total_gross; deductions/net validated."""
    r = api_client.post(
        "/api/payroll/",
        data=json.dumps(
            {
                "pay_period_start": "2026-05-01",
                "pay_period_end": "2026-05-31",
                "payment_date": "2026-05-31",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    pid = json.loads(r.content)["id"]

    r = api_client.put(
        f"/api/payroll/{pid}/",
        data=json.dumps(
            {
                "base_salary_total": "4000.00",
                "overtime_amount": "350.50",
                "bonus_amount": "200",
                "other_earnings_amount": "0",
                "total_deductions": "0",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    d = json.loads(r.content)
    assert d["total_gross"] == 4550.5
    assert d["base_salary_total"] == 4000.0
    assert d["overtime_amount"] == 350.5
    assert d["bonus_amount"] == 200.0
    assert d["other_earnings_amount"] == 0.0
    assert d["total_net"] == 4550.5


@pytest.mark.django_db
def test_payroll_from_one_employee(api_client: Client, auth_admin_headers, user_admin):
    from decimal import Decimal

    from api.models import Employee

    cid = user_admin.company_id
    a = Employee.objects.create(
        company_id=cid,
        employee_code="E2",
        employee_number="E2",
        first_name="Yunus",
        last_name="Khan",
        salary=Decimal("12000.00"),
        is_active=True,
    )
    Employee.objects.create(
        company_id=cid,
        employee_code="E3",
        employee_number="E3",
        first_name="Other",
        last_name="Staff",
        salary=Decimal("30000.00"),
        is_active=True,
    )
    r = api_client.post(
        "/api/payroll/",
        data=json.dumps(
            {
                "pay_period_start": "2026-04-01",
                "pay_period_end": "2026-04-30",
                "payment_date": "2026-04-30",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    pid = json.loads(r.content)["id"]

    r = api_client.post(
        f"/api/payroll/{pid}/from-one-employee/",
        data=json.dumps({"employee_id": a.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    d = json.loads(r.content)
    assert d["total_gross"] == 12000.0
    assert d["total_net"] == 12000.0
    assert d["is_salary_posted"] is False


@pytest.mark.django_db
def test_payroll_post_creates_subledger_three_lines_with_deductions_two_employees(
    api_client: Client, auth_admin_headers, user_admin
):
    """Gross / deductions / net split 50–50; each employee gets three subledger rows."""
    from decimal import Decimal

    from api.models import BankAccount, ChartOfAccount, Employee, EmployeeLedgerEntry

    cid = user_admin.company_id
    ChartOfAccount.objects.get_or_create(
        company_id=cid,
        account_code="6400",
        defaults={
            "account_name": "Salaries & Wages",
            "account_type": "expense",
            "account_sub_type": "payroll_expenses",
        },
    )
    ChartOfAccount.objects.get_or_create(
        company_id=cid,
        account_code="2210",
        defaults={
            "account_name": "Statutory deductions",
            "account_type": "liability",
            "account_sub_type": "payroll",
        },
    )
    bcoa, _ = ChartOfAccount.objects.get_or_create(
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
        chart_account=bcoa,
        account_name="Payroll Bank",
        account_number="0002",
        bank_name="Test Bank",
    )
    e1 = Employee.objects.create(
        company_id=cid,
        employee_code="PE1",
        employee_number="PE1",
        first_name="One",
        last_name="Staff",
        salary=Decimal("5000.00"),
        is_active=True,
    )
    e2 = Employee.objects.create(
        company_id=cid,
        employee_code="PE2",
        employee_number="PE2",
        first_name="Two",
        last_name="Staff",
        salary=Decimal("5000.00"),
        is_active=True,
    )
    r = api_client.post(
        "/api/payroll/",
        data=json.dumps(
            {
                "pay_period_start": "2026-06-01",
                "pay_period_end": "2026-06-30",
                "payment_date": "2026-06-30",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    pid = json.loads(r.content)["id"]
    r = api_client.put(
        f"/api/payroll/{pid}/",
        data=json.dumps(
            {
                "base_salary_total": "10000.00",
                "overtime_amount": "0",
                "bonus_amount": "0",
                "other_earnings_amount": "0",
                "total_deductions": "1000.00",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    d = json.loads(r.content)
    assert d["total_gross"] == 10000.0
    assert d["total_net"] == 9000.0

    r = api_client.post(
        f"/api/payroll/{pid}/post-to-books/",
        data=json.dumps({"bank_account_id": bank.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()

    assert EmployeeLedgerEntry.objects.filter(employee_id=e1.id).count() == 3
    assert EmployeeLedgerEntry.objects.filter(employee_id=e2.id).count() == 3
    e1.refresh_from_db()
    e2.refresh_from_db()
    assert Decimal(str(e1.current_balance)) == Decimal("0")
    assert Decimal(str(e2.current_balance)) == Decimal("0")


@pytest.mark.django_db
def test_payroll_from_one_employee_subledger_only_on_selected(
    api_client: Client, auth_admin_headers, user_admin
):
    """When multiple staff have salary, from-one-employee attributes subledger only to that person."""
    from decimal import Decimal

    from api.models import BankAccount, ChartOfAccount, Employee, EmployeeLedgerEntry

    cid = user_admin.company_id
    ChartOfAccount.objects.get_or_create(
        company_id=cid,
        account_code="6400",
        defaults={
            "account_name": "Salaries & Wages",
            "account_type": "expense",
            "account_sub_type": "payroll_expenses",
        },
    )
    bcoa, _ = ChartOfAccount.objects.get_or_create(
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
        chart_account=bcoa,
        account_name="Payroll Bank",
        account_number="0003",
        bank_name="Test Bank",
    )
    paid = Employee.objects.create(
        company_id=cid,
        employee_code="SOLO",
        employee_number="SOLO",
        first_name="Paid",
        last_name="Only",
        salary=Decimal("12000.00"),
        is_active=True,
    )
    Employee.objects.create(
        company_id=cid,
        employee_code="OTHER",
        employee_number="OTHER",
        first_name="Other",
        last_name="Staff",
        salary=Decimal("30000.00"),
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
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    pid = json.loads(r.content)["id"]
    r = api_client.post(
        f"/api/payroll/{pid}/from-one-employee/",
        data=json.dumps({"employee_id": paid.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()

    r = api_client.post(
        f"/api/payroll/{pid}/post-to-books/",
        data=json.dumps({"bank_account_id": bank.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()

    assert EmployeeLedgerEntry.objects.filter(employee_id=paid.id).count() == 2
    assert EmployeeLedgerEntry.objects.filter(employee__employee_code="OTHER").count() == 0


@pytest.mark.django_db
def test_employee_ledger_get_backfills_posted_payroll_without_subledger_rows(
    api_client: Client, auth_admin_headers, user_admin
):
    """Posted payroll with no EmployeeLedgerEntry rows yet is synced when ledger is opened."""
    from decimal import Decimal

    from api.models import BankAccount, ChartOfAccount, Employee, EmployeeLedgerEntry

    cid = user_admin.company_id
    ChartOfAccount.objects.get_or_create(
        company_id=cid,
        account_code="6400",
        defaults={
            "account_name": "Salaries & Wages",
            "account_type": "expense",
            "account_sub_type": "payroll_expenses",
        },
    )
    bcoa, _ = ChartOfAccount.objects.get_or_create(
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
        chart_account=bcoa,
        account_name="Payroll Bank BF",
        account_number="BF-1",
        bank_name="Test Bank",
    )
    emp = Employee.objects.create(
        company_id=cid,
        employee_code="BF1",
        employee_number="BF1",
        first_name="Backfill",
        last_name="Test",
        salary=Decimal("4500.00"),
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
    assert r.status_code == 201, r.content.decode()
    pid = json.loads(r.content)["id"]
    r = api_client.post(
        f"/api/payroll/{pid}/from-employees/",
        data="{}",
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    r = api_client.post(
        f"/api/payroll/{pid}/post-to-books/",
        data=json.dumps({"bank_account_id": bank.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    EmployeeLedgerEntry.objects.filter(employee_id=emp.id).delete()
    Employee.objects.filter(pk=emp.pk).update(current_balance=Decimal("0"))

    r = api_client.get(f"/api/employees/{emp.id}/ledger/", **auth_admin_headers)
    assert r.status_code == 200, r.content.decode()
    data = json.loads(r.content)
    assert len(data["transactions"]) >= 2
    assert EmployeeLedgerEntry.objects.filter(employee_id=emp.id).count() == 2


@pytest.mark.django_db
def test_payroll_reverts_to_draft_when_salary_journal_removed(
    api_client: Client, auth_admin_headers, user_admin
):
    """Removing AUTO-PAYROLL journal (GL) sets payroll status back to draft."""
    from decimal import Decimal

    from api.models import BankAccount, ChartOfAccount, Employee, JournalEntry, PayrollRun

    cid = user_admin.company_id
    ChartOfAccount.objects.get_or_create(
        company_id=cid,
        account_code="6400",
        defaults={
            "account_name": "Salaries & Wages",
            "account_type": "expense",
            "account_sub_type": "payroll_expenses",
        },
    )
    bcoa, _ = ChartOfAccount.objects.get_or_create(
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
        chart_account=bcoa,
        account_name="Payroll Bank",
        account_number="0002",
        bank_name="Test Bank",
    )
    Employee.objects.create(
        company_id=cid,
        employee_code="E-REL",
        employee_number="E-REL",
        first_name="Rel",
        last_name="Test",
        salary=Decimal("3000.00"),
        is_active=True,
    )
    r = api_client.post(
        "/api/payroll/",
        data=json.dumps(
            {
                "pay_period_start": "2026-05-01",
                "pay_period_end": "2026-05-31",
                "payment_date": "2026-05-31",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    pid = json.loads(r.content)["id"]

    r = api_client.post(
        f"/api/payroll/{pid}/from-employees/",
        data="{}",
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()

    r = api_client.post(
        f"/api/payroll/{pid}/post-to-books/",
        data=json.dumps({"bank_account_id": bank.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    posted = json.loads(r.content)
    assert posted["status"] == "paid"
    je_id = posted["salary_journal_entry_id"]
    assert je_id

    r = api_client.post(
        f"/api/journal-entries/{je_id}/unpost/",
        data=json.dumps({"remove_system_entry": True}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    assert json.loads(r.content).get("removed") is True
    assert not JournalEntry.objects.filter(pk=je_id).exists()

    pr = PayrollRun.objects.get(pk=pid)
    assert pr.status == "draft"
    assert pr.salary_journal_id is None

    r = api_client.get(f"/api/payroll/{pid}/", **auth_admin_headers)
    assert r.status_code == 200
    detail = json.loads(r.content)
    assert detail["status"] == "draft"
    assert detail["is_salary_posted"] is False


@pytest.mark.django_db
def test_payroll_list_repairs_paid_status_when_journal_gone(
    api_client: Client, auth_admin_headers, user_admin
):
    """Orphan paid runs (no salary_journal) are corrected to draft on list GET."""
    from decimal import Decimal

    from api.models import PayrollRun

    cid = user_admin.company_id
    pr = PayrollRun.objects.create(
        company_id=cid,
        payroll_number="PR-ORPHAN",
        pay_period_start="2026-05-01",
        pay_period_end="2026-05-31",
        payment_date="2026-05-31",
        total_gross=Decimal("1000"),
        total_deductions=Decimal("0"),
        total_net=Decimal("1000"),
        status="paid",
        salary_journal_id=None,
    )
    r = api_client.get("/api/payroll/", **auth_admin_headers)
    assert r.status_code == 200
    rows = json.loads(r.content)
    row = next(x for x in rows if x["id"] == pr.id)
    assert row["status"] == "draft"
    assert row["is_salary_posted"] is False
    pr.refresh_from_db()
    assert pr.status == "draft"


@pytest.mark.django_db
def test_partial_pond_payroll_subledger_only_pond_workers(
    api_client: Client, auth_admin_headers, user_admin
):
    """Gross matching pond-scoped salaries only — subledger must not hit fuel/site staff."""
    from decimal import Decimal

    from django.db.models import Sum

    from api.models import (
        AquaculturePond,
        BankAccount,
        ChartOfAccount,
        Company,
        Employee,
        EmployeeLedgerEntry,
    )

    cid = user_admin.company_id
    Company.objects.filter(pk=cid).update(aquaculture_enabled=True, aquaculture_licensed=True)
    ChartOfAccount.objects.get_or_create(
        company_id=cid,
        account_code="6712",
        defaults={
            "account_name": "Aquaculture Expense — Labor & Wages",
            "account_type": "expense",
            "account_sub_type": "payroll_expenses",
        },
    )
    bcoa, _ = ChartOfAccount.objects.get_or_create(
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
        chart_account=bcoa,
        account_name="Payroll Bank Pond",
        account_number="POND-1",
        bank_name="Test Bank",
    )
    AquaculturePond.objects.create(company_id=cid, name="Pond A")
    AquaculturePond.objects.create(company_id=cid, name="Pond B")
    pond_worker = Employee.objects.create(
        company_id=cid,
        employee_code="PW",
        employee_number="PW",
        first_name="Pond",
        last_name="Worker",
        salary=Decimal("14000.00"),
        is_active=True,
        aquaculture_labor_scope="assigned_pond",
        home_aquaculture_pond=AquaculturePond.objects.filter(company_id=cid).first(),
    )
    Employee.objects.create(
        company_id=cid,
        employee_code="SHARED",
        employee_number="SHARED",
        first_name="Shared",
        last_name="Manager",
        salary=Decimal("20000.00"),
        is_active=True,
        aquaculture_labor_scope="all_ponds_equal",
    )
    Employee.objects.create(
        company_id=cid,
        employee_code="SITE",
        employee_number="SITE",
        first_name="Site",
        last_name="Accountant",
        salary=Decimal("85000.00"),
        is_active=True,
        aquaculture_labor_scope="not_applicable",
    )

    r = api_client.post(
        "/api/payroll/",
        data=json.dumps(
            {
                "pay_period_start": "2026-06-01",
                "pay_period_end": "2026-06-30",
                "payment_date": "2026-06-30",
                "total_gross": "34000.00",
                "total_deductions": "0",
                "total_net": "34000.00",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    pid = json.loads(r.content)["id"]
    r = api_client.post(
        f"/api/payroll/{pid}/pond-allocations-from-employees/",
        data="{}",
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    r = api_client.post(
        f"/api/payroll/{pid}/post-to-books/",
        data=json.dumps({"bank_account_id": bank.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()

    site_lines = EmployeeLedgerEntry.objects.filter(
        payroll_run_id=pid, employee__employee_number="SITE"
    )
    assert site_lines.count() == 0
    pw_gross = EmployeeLedgerEntry.objects.filter(
        payroll_run_id=pid, employee_id=pond_worker.id, debit__gt=0
    ).aggregate(t=Sum("debit"))["t"]
    shared_gross = EmployeeLedgerEntry.objects.filter(
        payroll_run_id=pid, employee__employee_number="SHARED", debit__gt=0
    ).aggregate(t=Sum("debit"))["t"]
    assert Decimal(str(pw_gross)) == Decimal("14000.00")
    assert Decimal(str(shared_gross)) == Decimal("20000.00")


@pytest.mark.django_db
def test_payroll_json_includes_employee_allocations_for_pond_workers(
    api_client: Client, auth_admin_headers, user_admin
):
    """Partial pond payroll exposes employee ID, name, and wage amount on the run."""
    from decimal import Decimal

    from api.models import AquaculturePond, Company, Employee

    cid = user_admin.company_id
    Company.objects.filter(pk=cid).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=cid, name="Digonta")
    Employee.objects.create(
        company_id=cid,
        employee_code="E1",
        employee_number="EMP-00001",
        first_name="Yunus",
        last_name="Khan",
        salary=Decimal("20000.00"),
        is_active=True,
        aquaculture_labor_scope="all_ponds_equal",
    )
    Employee.objects.create(
        company_id=cid,
        employee_code="E2",
        employee_number="EMP-00002",
        first_name="Baro",
        last_name="Babu",
        salary=Decimal("14000.00"),
        is_active=True,
        aquaculture_labor_scope="assigned_pond",
        home_aquaculture_pond=pond,
    )
    r = api_client.post(
        "/api/payroll/",
        data=json.dumps(
            {
                "pay_period_start": "2026-06-01",
                "pay_period_end": "2026-06-30",
                "payment_date": "2026-06-30",
                "total_gross": "34000.00",
                "total_deductions": "0",
                "total_net": "34000.00",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    pid = json.loads(r.content)["id"]
    r = api_client.post(
        f"/api/payroll/{pid}/employee-allocations-from-hr/",
        data="{}",
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    d = json.loads(r.content)
    assert d["employee_allocations_total"] == 34000.0
    by_num = {x["employee_number"]: x for x in d["employee_allocations"]}
    assert by_num["EMP-00001"]["employee_name"] == "Yunus Khan"
    assert by_num["EMP-00001"]["amount"] == "20000.00"
    assert by_num["EMP-00002"]["employee_name"] == "Baro Babu"
    assert by_num["EMP-00002"]["amount"] == "14000.00"
    assert d["employee_allocations_source"] == "stored"


@pytest.mark.django_db
def test_partial_payroll_two_picked_employees_not_whole_roster(
    api_client: Client, auth_admin_headers, user_admin
):
    """Picking two employees must not spread wages across every active employee."""
    from decimal import Decimal

    from django.db.models import Sum

    from api.models import (
        AquaculturePond,
        BankAccount,
        ChartOfAccount,
        Company,
        Employee,
        EmployeeLedgerEntry,
    )

    cid = user_admin.company_id
    Company.objects.filter(pk=cid).update(aquaculture_enabled=True, aquaculture_licensed=True)
    ChartOfAccount.objects.get_or_create(
        company_id=cid,
        account_code="6712",
        defaults={
            "account_name": "Aquaculture Expense — Labor & Wages",
            "account_type": "expense",
            "account_sub_type": "payroll_expenses",
        },
    )
    bcoa, _ = ChartOfAccount.objects.get_or_create(
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
        chart_account=bcoa,
        account_name="Payroll Bank",
        account_number="TWO-EMP",
        bank_name="Test Bank",
    )
    pond = AquaculturePond.objects.create(company_id=cid, name="Digonta")
    emp1 = Employee.objects.create(
        company_id=cid,
        employee_code="E1",
        employee_number="EMP-00001",
        first_name="Yunus",
        last_name="Khan",
        salary=Decimal("20000.00"),
        is_active=True,
        aquaculture_labor_scope="all_ponds_equal",
    )
    emp6 = Employee.objects.create(
        company_id=cid,
        employee_code="E6",
        employee_number="EMP-00006",
        first_name="Baro",
        last_name="Babu",
        salary=Decimal("14000.00"),
        is_active=True,
        aquaculture_labor_scope="assigned_pond",
        home_aquaculture_pond=pond,
    )
    for num, sal in [
        ("EMP-001", "15000"),
        ("EMP-002", "14000"),
        ("EMP-003", "28000"),
        ("EMP-004", "14000"),
        ("EMP-005", "25000"),
    ]:
        Employee.objects.create(
            company_id=cid,
            employee_code=num,
            employee_number=num,
            first_name=num,
            last_name="Other",
            salary=Decimal(sal),
            is_active=True,
            aquaculture_labor_scope="assigned_pond",
            home_aquaculture_pond=pond,
        )

    r = api_client.post(
        "/api/payroll/",
        data=json.dumps(
            {
                "pay_period_start": "2026-06-01",
                "pay_period_end": "2026-06-30",
                "payment_date": "2026-06-30",
                "total_gross": "10000.00",
                "total_deductions": "0",
                "total_net": "10000.00",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    pid = json.loads(r.content)["id"]

    r = api_client.post(
        f"/api/payroll/{pid}/post-to-books/",
        data=json.dumps({"bank_account_id": bank.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400, r.content.decode()

    r = api_client.put(
        f"/api/payroll/{pid}/",
        data=json.dumps(
            {
                "employee_allocations": [
                    {"employee_id": emp1.id, "amount": "6000.00"},
                    {"employee_id": emp6.id, "amount": "4000.00"},
                ],
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    d = json.loads(r.content)
    assert len(d["employee_allocations"]) == 2
    assert d["employee_allocations_total"] == 10000.0

    r = api_client.post(
        f"/api/payroll/{pid}/post-to-books/",
        data=json.dumps({"bank_account_id": bank.id}),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 200, r.content.decode()
    d = json.loads(r.content)
    assert len(d["employee_allocations"]) == 2
    nums = {x["employee_number"] for x in d["employee_allocations"]}
    assert nums == {"EMP-00001", "EMP-00006"}

    ledger_count = EmployeeLedgerEntry.objects.filter(
        payroll_run_id=pid, debit__gt=0
    ).count()
    assert ledger_count == 2
    gross_by_emp = {
        row["employee__employee_number"]: row["t"]
        for row in EmployeeLedgerEntry.objects.filter(payroll_run_id=pid, debit__gt=0)
        .values("employee__employee_number")
        .annotate(t=Sum("debit"))
    }
    assert gross_by_emp["EMP-00001"] == Decimal("6000.00")
    assert gross_by_emp["EMP-00006"] == Decimal("4000.00")


@pytest.mark.django_db
def test_legacy_whole_roster_proportional_split_is_cleared_on_read(
    api_client: Client, auth_admin_headers, user_admin
):
    """Old auto-split rows across every employee are removed when opening the payroll."""
    from decimal import Decimal

    from api.models import AquaculturePond, Company, Employee, PayrollRun
    from api.services.employee_payroll_allocations import replace_payroll_employee_allocations
    from api.services.employee_payroll_subledger import _split_total_by_weights

    cid = user_admin.company_id
    Company.objects.filter(pk=cid).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(company_id=cid, name="Digonta")
    emps = []
    for num, sal in [
        ("EMP-00001", "20000"),
        ("EMP-00006", "14000"),
        ("EMP-001", "15000"),
        ("EMP-002", "14000"),
        ("EMP-003", "28000"),
        ("EMP-004", "14000"),
        ("EMP-005", "25000"),
    ]:
        scope = "all_ponds_equal" if num == "EMP-00001" else "assigned_pond"
        emps.append(
            Employee.objects.create(
                company_id=cid,
                employee_code=num,
                employee_number=num,
                first_name=num,
                last_name="Worker",
                salary=Decimal(sal),
                is_active=True,
                aquaculture_labor_scope=scope,
                home_aquaculture_pond=pond if scope == "assigned_pond" else None,
            )
        )
    gross = Decimal("34000.00")
    pr = PayrollRun.objects.create(
        company_id=cid,
        pay_period_start="2026-06-01",
        pay_period_end="2026-06-30",
        payment_date="2026-06-30",
        total_gross=gross,
        total_deductions=Decimal("0"),
        total_net=gross,
    )
    weights = [Decimal(str(e.salary)) for e in emps]
    parts = _split_total_by_weights(gross, weights)
    replace_payroll_employee_allocations(pr.id, list(zip(emps, parts)))

    r = api_client.get(f"/api/payroll/{pr.id}/", **auth_admin_headers)
    assert r.status_code == 200, r.content.decode()
    d = json.loads(r.content)
    assert d["employee_allocations"] == []
    assert d["employee_allocations_total"] == 0.0
    assert any("Cleared old auto-generated" in w for w in d.get("employee_allocation_warnings", []))
