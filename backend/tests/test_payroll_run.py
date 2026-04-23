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

    from api.models import BankAccount, ChartOfAccount, Employee

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


@pytest.mark.django_db
def test_payroll_post_to_books_uses_chart_account_without_bank_register(
    api_client: Client, auth_admin_headers, user_admin
):
    """Net pay can credit a GL bank/cash line when no bank register is used."""
    from decimal import Decimal

    from api.models import ChartOfAccount, Employee

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
