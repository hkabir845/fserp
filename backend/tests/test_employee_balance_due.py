"""Employee payable balance must match employee ledger all-time closing."""
from decimal import Decimal

import pytest

from api.models import Employee, EmployeeLedgerEntry
from api.services.contact_ledgers import build_employee_ledger, employee_payable_balance
from api.services.employee_payroll_subledger import refresh_employee_balance


def _assert_balance_matches_ledger(company_id: int, employee_id: int) -> Decimal:
    due = employee_payable_balance(company_id, employee_id, backfill=False)
    payload = build_employee_ledger(company_id, employee_id)
    closing = Decimal(payload["closing_balance_all_time"])
    profile = Decimal(payload["stored_current_balance"])
    assert due == closing == profile
    return due


@pytest.mark.django_db
def test_opening_balance_matches_ledger(company_tenant):
    e = Employee.objects.create(
        company_id=company_tenant.id,
        first_name="Open",
        last_name="Balance",
        opening_balance=Decimal("250.00"),
        opening_balance_date="2026-01-01",
        current_balance=Decimal("0"),
    )
    assert _assert_balance_matches_ledger(company_tenant.id, e.id) == Decimal("250.00")
    refresh_employee_balance(e.id)
    e.refresh_from_db()
    assert e.current_balance == Decimal("250.00")


@pytest.mark.django_db
def test_manual_debit_and_credit_match_ledger(company_tenant):
    e = Employee.objects.create(
        company_id=company_tenant.id,
        first_name="Manual",
        last_name="Ledger",
        opening_balance=Decimal("0"),
        current_balance=Decimal("0"),
    )
    EmployeeLedgerEntry.objects.create(
        employee=e,
        entry_date="2026-05-01",
        entry_type="adjustment",
        reference="ADV-1",
        memo="Wage accrual",
        debit=Decimal("1000.00"),
        credit=Decimal("0"),
    )
    EmployeeLedgerEntry.objects.create(
        employee=e,
        entry_date="2026-05-02",
        entry_type="payment",
        reference="PAY-1",
        memo="Paid net",
        debit=Decimal("0"),
        credit=Decimal("800.00"),
    )
    assert _assert_balance_matches_ledger(company_tenant.id, e.id) == Decimal("200.00")


@pytest.mark.django_db
def test_advance_allows_negative_employee_balance(company_tenant):
    e = Employee.objects.create(
        company_id=company_tenant.id,
        first_name="Advance",
        last_name="Worker",
        opening_balance=Decimal("0"),
        current_balance=Decimal("0"),
    )
    EmployeeLedgerEntry.objects.create(
        employee=e,
        entry_date="2026-05-01",
        entry_type="advance",
        reference="ADV-OUT",
        memo="Cash advance",
        debit=Decimal("0"),
        credit=Decimal("500.00"),
    )
    assert _assert_balance_matches_ledger(company_tenant.id, e.id) == Decimal("-500.00")
