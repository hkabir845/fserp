"""Balanced G/L for manual employee subledger lines.

Payroll-run rows already have salary / settle / remit journals. Manual debit/credit
on the employee ledger must post here so the HR balance and the trial balance agree.

Control accounts:
  2200  salaries payable — salary, overtime, bonus, payment, adjustment
  1150  employee advances — type ``advance`` (cash out / recovery)
  6400  salaries expense — debit that increases what we owe
  1010  cash — payments, advances, and advance recoveries
"""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction

from api.exceptions import GlPostingError
from api.models import EmployeeLedgerEntry, JournalEntry
from api.services.gl_posting import (
    CODE_CASH,
    CODE_EMP_ADVANCE,
    CODE_SALARY_EXP,
    CODE_SALARY_PAYABLE,
    _create_posted_entry,
    _ensure_core_posting_account,
    _gl_station_id,
)

# Subledger credit on an advance is cash leaving (Dr 1150 / Cr cash).
# A debit on an advance, or any recovery type, is cash coming back.
ADVANCE_GIVEN_TYPES = frozenset({"advance", "staff_advance"})
RECOVERY_TYPES = frozenset({"recovery", "advance_recovery"})
ADVANCE_TYPES = ADVANCE_GIVEN_TYPES | RECOVERY_TYPES


def employee_ledger_journal_number(entry_id: int) -> str:
    return f"AUTO-EMP-LE-{int(entry_id)}"


def _money(value: Decimal) -> Decimal:
    return (value or Decimal("0")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def delete_employee_ledger_journal(company_id: int, entry_id: int) -> int:
    from api.services.gl_posting import assert_period_open

    row = EmployeeLedgerEntry.objects.filter(pk=entry_id, employee__company_id=company_id).first()
    if row is not None:
        assert_period_open(company_id, row.entry_date, action="delete")
    deleted, _ = JournalEntry.objects.filter(
        company_id=company_id,
        entry_number=employee_ledger_journal_number(entry_id),
    ).delete()
    return deleted


def delete_manual_employee_ledger_entry(company_id: int, entry_id: int) -> None:
    """Remove a manual ledger row and its journal so the subledger and 1150/2200 stay together."""
    with transaction.atomic():
        entry = (
            EmployeeLedgerEntry.objects.select_for_update()
            .filter(pk=entry_id, employee__company_id=company_id)
            .first()
        )
        if entry is None:
            raise GlPostingError("Employee ledger entry not found.")
        if entry.payroll_run_id:
            raise GlPostingError(
                "Payroll lines are reversed from the payroll run, not deleted from the employee ledger."
            )
        delete_employee_ledger_journal(company_id, entry.id)
        employee_id = entry.employee_id
        entry.delete()
        from api.services.employee_payroll_subledger import refresh_employee_balance

        refresh_employee_balance(employee_id)


def post_manual_employee_ledger_journal(
    company_id: int, entry: EmployeeLedgerEntry
) -> JournalEntry | None:
    """
    Post (or refuse) a balanced journal for a manual employee ledger row.

    Raises GlPostingError when the period is closed or required accounts cannot be provisioned.
    Payroll-linked rows are skipped (they already live in the payroll journals).
    """
    if entry.payroll_run_id:
        return entry.journal_entry

    debit = _money(entry.debit)
    credit = _money(entry.credit)
    net = debit - credit
    mag = abs(net)
    if mag <= Decimal("0.00"):
        raise GlPostingError(
            "debit or credit must be greater than zero (net of each other) to post to the ledger."
        )

    emp = entry.employee
    et = (entry.entry_type or "adjustment").strip().lower()
    is_debit = net > 0

    cash = _ensure_core_posting_account(company_id, CODE_CASH)
    payable = _ensure_core_posting_account(company_id, CODE_SALARY_PAYABLE)
    expense = _ensure_core_posting_account(company_id, CODE_SALARY_EXP)
    advance = _ensure_core_posting_account(company_id, CODE_EMP_ADVANCE)
    if not cash or not payable:
        raise GlPostingError(
            "Could not post the employee ledger to the general ledger. "
            "Ensure accounts 1010 (cash) and 2200 (salaries payable) exist."
        )

    if et in ADVANCE_TYPES:
        if not advance:
            raise GlPostingError(
                "Could not post a staff advance. Ensure account 1150 (Employee Advances) exists."
            )
        giving_advance = et in ADVANCE_GIVEN_TYPES and not is_debit
        if et in RECOVERY_TYPES:
            giving_advance = not is_debit
        if giving_advance:
            debit_acc, credit_acc = advance, cash
        else:
            # Recovery: cash in, reduce the advance asset; subledger payable rises.
            debit_acc, credit_acc = cash, advance
    elif is_debit:
        if not expense:
            raise GlPostingError(
                "Could not post wages to the general ledger. "
                "Ensure account 6400 (Salaries & Wages) exists."
            )
        debit_acc, credit_acc = expense, payable
    else:
        debit_acc, credit_acc = payable, cash

    name = f"{emp.first_name} {emp.last_name}".strip() or f"Employee #{emp.id}"
    name = name[:120]
    memo = (entry.memo or entry.reference or entry.entry_type or "Employee ledger")[:300]
    desc = f"Employee ledger — {name}"[:500]
    en = employee_ledger_journal_number(entry.id)
    lines = [
        (debit_acc, mag, Decimal("0"), memo),
        (credit_acc, Decimal("0"), mag, memo),
    ]
    station_id = _gl_station_id(company_id, getattr(emp, "home_station_id", None))
    je = _create_posted_entry(
        company_id,
        entry.entry_date,
        en,
        desc,
        lines,
        gl_station_id=station_id,
    )
    if not je:
        raise GlPostingError(
            "Could not post the employee ledger journal (unbalanced or invalid lines)."
        )
    EmployeeLedgerEntry.objects.filter(pk=entry.pk).update(journal_entry_id=je.id)
    entry.journal_entry_id = je.id
    return je


def sync_manual_employee_ledger_journal(
    company_id: int, entry: EmployeeLedgerEntry
) -> JournalEntry:
    """Idempotent post used by the HR create endpoint."""
    with transaction.atomic():
        if entry.journal_entry_id:
            existing = JournalEntry.objects.filter(
                pk=entry.journal_entry_id, company_id=company_id
            ).first()
            if existing:
                return existing
        return post_manual_employee_ledger_journal(company_id, entry)
