"""Per-employee wage splits on payroll runs (audit trail + subledger source of truth)."""
from __future__ import annotations

from decimal import Decimal

from django.db.models import Sum

from api.models import Employee, EmployeeLedgerEntry, PayrollRun, PayrollRunEmployeeAllocation
from api.services.employee_payroll_subledger import (
    _q,
    _resolve_subledger_employees,
    _split_total_by_weights,
)


def _employee_display_name(emp: Employee) -> str:
    name = f"{emp.first_name or ''} {emp.last_name or ''}".strip()
    if name:
        return name
    return (emp.employee_code or emp.employee_number or f"Employee #{emp.id}").strip()


def _labor_scope_label(emp: Employee) -> str:
    scope = (getattr(emp, "aquaculture_labor_scope", None) or "not_applicable").strip()
    labels = {
        "not_applicable": "Site / company payroll",
        "assigned_pond": "Single pond",
        "all_ponds_equal": "Shared across all ponds",
    }
    return labels.get(scope, scope.replace("_", " ").title())


def _allocation_row(emp: Employee, gross: Decimal) -> dict:
    pond_name = ""
    if getattr(emp, "home_aquaculture_pond_id", None) and getattr(emp, "home_aquaculture_pond", None):
        pond_name = (emp.home_aquaculture_pond.name or "").strip()
    return {
        "employee_id": emp.id,
        "employee_number": (emp.employee_number or emp.employee_code or "").strip(),
        "employee_code": (emp.employee_code or emp.employee_number or "").strip(),
        "employee_name": _employee_display_name(emp),
        "amount": str(_q(gross)),
        "hr_salary": str(_q(emp.salary or Decimal("0"))),
        "aquaculture_labor_scope": getattr(emp, "aquaculture_labor_scope", None) or "not_applicable",
        "labor_scope_label": _labor_scope_label(emp),
        "home_aquaculture_pond_id": getattr(emp, "home_aquaculture_pond_id", None),
        "home_aquaculture_pond_name": pond_name,
    }


def _is_legacy_whole_roster_proportional_split(
    company_id: int,
    payroll: PayrollRun,
    stored: list[PayrollRunEmployeeAllocation],
) -> bool:
    """
    Detect obsolete auto-fill that spread partial gross across every salaried employee
    by HR salary weight (pre manual-pick workflow).
    """
    gross = _q(payroll.total_gross or Decimal("0"))
    if gross <= 0 or not stored:
        return False
    all_emps = list(
        Employee.objects.filter(
            company_id=company_id,
            is_active=True,
            salary__isnull=False,
            salary__gt=0,
        ).order_by("id")
    )
    if len(stored) != len(all_emps):
        return False
    salary_sum = _q(sum(_q(e.salary or Decimal("0")) for e in all_emps))
    if abs(salary_sum - gross) <= Decimal("0.02"):
        return False
    stored_by_id = {int(r.employee_id): _q(r.amount) for r in stored}
    weights = [_q(e.salary or Decimal("0")) for e in all_emps]
    expected = _split_total_by_weights(gross, weights)
    for emp, exp in zip(all_emps, expected):
        if abs(stored_by_id.get(int(emp.id), Decimal("0")) - exp) > Decimal("0.02"):
            return False
    return True


def replace_payroll_employee_allocations(
    payroll_run_id: int,
    rows: list[tuple[Employee, Decimal]],
) -> None:
    PayrollRunEmployeeAllocation.objects.filter(payroll_run_id=payroll_run_id).delete()
    for emp, amt in rows:
        gross = _q(amt)
        if gross <= 0:
            continue
        PayrollRunEmployeeAllocation.objects.create(
            payroll_run_id=payroll_run_id,
            employee_id=emp.id,
            amount=gross,
        )


def sync_payroll_employee_allocations_from_hr(
    company_id: int,
    payroll: PayrollRun,
) -> tuple[list[dict], list[str]]:
    """
    Infer employee wage rows from HR (same rules as subledger posting).
    Returns (allocation dicts, warnings).
    """
    warnings: list[str] = []
    gross = _q(payroll.total_gross or Decimal("0"))
    if gross <= 0:
        replace_payroll_employee_allocations(payroll.id, [])
        return [], warnings

    emps, weights = _resolve_subledger_employees(company_id, payroll)
    if not emps:
        replace_payroll_employee_allocations(payroll.id, [])
        warnings.append(
            "No employees could be matched to this payroll gross. "
            "Use Fill from one employee or Sum from employees, or set employee wage rows manually."
        )
        return [], warnings

    parts = _split_total_by_weights(gross, weights)
    rows = list(zip(emps, parts))
    replace_payroll_employee_allocations(payroll.id, rows)
    return [_allocation_row(emp, amt) for emp, amt in rows if amt > 0], warnings


def sync_payroll_employee_allocations_all_active(
    company_id: int,
    payroll: PayrollRun,
) -> list[dict]:
    """Sum from employees: one row per active salaried employee at HR salary amounts."""
    emps = list(
        Employee.objects.filter(
            company_id=company_id,
            is_active=True,
            salary__isnull=False,
            salary__gt=0,
        )
        .select_related("home_aquaculture_pond")
        .order_by("id")
    )
    rows = [(e, _q(e.salary or Decimal("0"))) for e in emps]
    replace_payroll_employee_allocations(payroll.id, rows)
    return [_allocation_row(emp, amt) for emp, amt in rows if amt > 0]


def sync_single_payroll_employee_allocation(
    company_id: int,
    payroll: PayrollRun,
    employee: Employee,
    *,
    gross_amount: Decimal | None = None,
) -> dict | None:
    amt = _q(gross_amount if gross_amount is not None else (employee.salary or Decimal("0")))
    replace_payroll_employee_allocations(payroll.id, [(employee, amt)] if amt > 0 else [])
    if amt <= 0:
        return None
    return _allocation_row(employee, amt)


def employee_allocations_for_payroll(
    company_id: int,
    payroll: PayrollRun,
) -> tuple[list[dict], str, list[str]]:
    """
    Rows for API/UI. Returns (rows, attribution_source, warnings).
    attribution_source: posted_ledger | stored | inferred_hr
    """
    warnings: list[str] = []
    gross = _q(payroll.total_gross or Decimal("0"))

    if payroll.salary_journal_id:
        ledger_rows = (
            EmployeeLedgerEntry.objects.filter(
                payroll_run_id=payroll.id,
                debit__gt=0,
            )
            .select_related("employee", "employee__home_aquaculture_pond")
            .order_by("employee__employee_number", "employee__id")
        )
        if ledger_rows.exists():
            out = [_allocation_row(ln.employee, ln.debit) for ln in ledger_rows]
            return out, "posted_ledger", warnings

    stored = list(
        PayrollRunEmployeeAllocation.objects.filter(payroll_run_id=payroll.id)
        .select_related("employee", "employee__home_aquaculture_pond")
        .order_by("employee__employee_number", "employee__id")
    )
    if stored and _is_legacy_whole_roster_proportional_split(company_id, payroll, stored):
        replace_payroll_employee_allocations(payroll.id, [])
        stored = []
        warnings.append(
            "Cleared old auto-generated wage rows that split this payroll across the whole team. "
            "Pick who is paid, enter each amount, then save."
        )
    if stored:
        out = [_allocation_row(row.employee, row.amount) for row in stored]
        alloc_sum = sum(_q(row.amount) for row in stored)
        if gross > 0 and abs(alloc_sum - gross) > Decimal("0.02"):
            warnings.append(
                f"Employee wage rows total ({alloc_sum}) differs from payroll gross ({gross}). "
                "Update employee rows or payroll totals before posting."
            )
        return out, "stored", warnings

    emps, weights = _resolve_subledger_employees(company_id, payroll)
    if not emps or gross <= 0:
        return [], "inferred_hr", warnings
    parts = _split_total_by_weights(gross, weights)
    out = [_allocation_row(emp, amt) for emp, amt in zip(emps, parts) if amt > 0]
    if out and not warnings:
        warnings.append(
            "Employee wage rows are preview-only (from HR). Save amounts or use "
            "Sum from employees / Fill from one employee to record who is paid on this run."
        )
    return out, "inferred_hr", warnings


def stored_employee_allocations_for_subledger(
    payroll_run_id: int,
) -> list[tuple[Employee, Decimal]]:
    payroll = PayrollRun.objects.filter(pk=payroll_run_id).first()
    stored = list(
        PayrollRunEmployeeAllocation.objects.filter(payroll_run_id=payroll_run_id)
        .select_related("employee")
        .order_by("employee_id")
    )
    if payroll and stored and _is_legacy_whole_roster_proportional_split(
        payroll.company_id, payroll, stored
    ):
        replace_payroll_employee_allocations(payroll_run_id, [])
        return []
    return [
        (row.employee, _q(row.amount))
        for row in stored
        if row.amount and _q(row.amount) > 0
    ]


def employee_allocation_sum(payroll_run_id: int) -> Decimal:
    return _q(
        PayrollRunEmployeeAllocation.objects.filter(payroll_run_id=payroll_run_id).aggregate(
            t=Sum("amount")
        )["t"]
        or Decimal("0")
    )


def employee_allocations_match_gross(gross: Decimal, alloc_sum: Decimal) -> bool:
    return abs(_q(alloc_sum) - _q(gross)) <= Decimal("0.02")


def validate_employee_allocations_match_gross(
    gross: Decimal,
    alloc_sum: Decimal,
    *,
    require_rows: bool = False,
    row_count: int = 0,
) -> str | None:
    """
    Return an error message when employee wage rows cannot be saved or posted against payroll gross.
    """
    gross = _q(gross or Decimal("0"))
    alloc_sum = _q(alloc_sum or Decimal("0"))
    if require_rows and row_count <= 0:
        return (
            "Pick which employees are paid on this run, enter each amount, save, "
            "then post. Partial payroll cannot be split across the whole roster automatically."
        )
    if row_count <= 0:
        return None
    if gross <= 0:
        return "Set payroll totals first (gross must be positive)."
    if employee_allocations_match_gross(gross, alloc_sum):
        return None
    if alloc_sum > gross:
        return (
            f"Employee wage rows ({alloc_sum}) exceed payroll gross ({gross}). "
            "Reduce employee amounts or increase gross pay, then save."
        )
    return (
        f"Employee wage rows ({alloc_sum}) must match payroll gross ({gross}). "
        "Adjust employee amounts or use Sum from employees, then save before posting."
    )
