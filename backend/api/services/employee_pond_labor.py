"""
Pond-based labor: resolve which pond an employee's wages belong to and build payroll splits.
"""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from api.models import AquaculturePond, Company, Employee, PayrollRun, PayrollRunPondAllocation

CODE_AQUACULTURE_LABOR = "6712"

LABOR_SCOPE_NOT_APPLICABLE = "not_applicable"
LABOR_SCOPE_ASSIGNED_POND = "assigned_pond"
LABOR_SCOPE_ALL_PONDS_EQUAL = "all_ponds_equal"

VALID_LABOR_SCOPES = frozenset(
    {LABOR_SCOPE_NOT_APPLICABLE, LABOR_SCOPE_ASSIGNED_POND, LABOR_SCOPE_ALL_PONDS_EQUAL}
)


def _q_money(v: Decimal) -> Decimal:
    return (v or Decimal("0")).quantize(Decimal("0.01"))


def employee_labor_scope(employee: Employee) -> str:
    scope = (getattr(employee, "aquaculture_labor_scope", None) or LABOR_SCOPE_NOT_APPLICABLE).strip()
    return scope if scope in VALID_LABOR_SCOPES else LABOR_SCOPE_NOT_APPLICABLE


def employee_pond_labor_applies(employee: Employee) -> bool:
    return employee_labor_scope(employee) != LABOR_SCOPE_NOT_APPLICABLE


def employee_splits_salary_all_ponds_equally(employee: Employee) -> bool:
    return employee_labor_scope(employee) == LABOR_SCOPE_ALL_PONDS_EQUAL


def active_pond_ids_for_company(company_id: int) -> list[int]:
    return list(
        AquaculturePond.objects.filter(company_id=company_id, is_active=True)
        .order_by("sort_order", "id")
        .values_list("id", flat=True)
    )


def _pond_name_map(company_id: int, pond_ids: list[int]) -> dict[int, str]:
    names: dict[int, str] = {}
    for row in AquaculturePond.objects.filter(company_id=company_id, pk__in=pond_ids).only("id", "name"):
        names[row.id] = (row.name or "").strip() or f"Pond #{row.id}"
    return names


def _split_amount_equally(amount: Decimal, pond_ids: list[int]) -> dict[int, Decimal]:
    """Split a wage amount across ponds; remainder cents go to the last pond."""
    n = len(pond_ids)
    if n == 0:
        return {}
    amount = _q_money(amount)
    if n == 1:
        return {pond_ids[0]: amount}
    base = _q_money(amount / Decimal(n))
    out: dict[int, Decimal] = {pid: base for pid in pond_ids}
    remainder = _q_money(amount - sum(out.values()))
    if remainder != 0:
        last = pond_ids[-1]
        out[last] = _q_money(out[last] + remainder)
    return out


def resolve_employee_labor_pond(employee: Employee) -> int | None:
    """
    Pond for wage attribution: explicit home pond, else aquaculture shop site default pond.
    Returns None when labor is not pond-scoped or shared across all ponds equally.
    """
    if not employee_pond_labor_applies(employee):
        return None
    if employee_splits_salary_all_ponds_equally(employee):
        return None
    if getattr(employee, "home_aquaculture_pond_id", None):
        return int(employee.home_aquaculture_pond_id)
    station = getattr(employee, "home_station", None)
    if (
        station is not None
        and not getattr(station, "operates_fuel_retail", True)
        and getattr(station, "default_aquaculture_pond_id", None)
    ):
        return int(station.default_aquaculture_pond_id)
    return None


def _add_to_pond_buckets(
    by_pond: dict[int, Decimal],
    splits: dict[int, Decimal],
    pond_names: dict[int, str],
    company_id: int,
) -> None:
    for pid, amt in splits.items():
        if amt <= 0:
            continue
        by_pond[pid] += amt
        if pid not in pond_names:
            pond_names[pid] = _pond_name_map(company_id, [pid]).get(pid, f"Pond #{pid}")


def _accumulate_pond_wages_for_employees(
    company_id: int,
    employee_amounts: list[tuple[Employee, Decimal]],
) -> tuple[list[dict], list[str]]:
    """Sum wage amounts by pond for the given employees."""
    all_pond_ids = active_pond_ids_for_company(company_id)
    pond_names = _pond_name_map(company_id, all_pond_ids)
    by_pond: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    warnings: list[str] = []

    if not all_pond_ids:
        for emp, _sal in employee_amounts:
            if employee_splits_salary_all_ponds_equally(emp):
                code = (emp.employee_code or emp.employee_number or f"#{emp.id}").strip()
                name = f"{emp.first_name or ''} {emp.last_name or ''}".strip() or code
                warnings.append(
                    f"{code} ({name}): shared manager pay needs at least one active pond in Aquaculture."
                )
        return [], warnings

    for emp, sal in employee_amounts:
        sal = _q_money(sal)
        if sal <= 0:
            continue
        code = (emp.employee_code or emp.employee_number or f"#{emp.id}").strip()
        name = f"{emp.first_name or ''} {emp.last_name or ''}".strip() or code

        if not employee_pond_labor_applies(emp):
            continue

        if employee_splits_salary_all_ponds_equally(emp):
            splits = _split_amount_equally(sal, all_pond_ids)
            _add_to_pond_buckets(by_pond, splits, pond_names, company_id)
            continue

        pid = resolve_employee_labor_pond(emp)
        if pid:
            by_pond[pid] += sal
            if pid not in pond_names:
                pond = (
                    emp.home_aquaculture_pond
                    if getattr(emp, "home_aquaculture_pond_id", None) == pid
                    and emp.home_aquaculture_pond
                    else None
                )
                if pond is None and emp.home_station and emp.home_station.default_aquaculture_pond_id == pid:
                    pond = emp.home_station.default_aquaculture_pond
                if pond is None:
                    pond = AquaculturePond.objects.filter(pk=pid, company_id=company_id).only("name").first()
                pond_names[pid] = (pond.name if pond else "").strip() or f"Pond #{pid}"
        else:
            warnings.append(
                f"{code} ({name}): assign an Aquaculture pond, mark wages as shared across all ponds, "
                f"or set wage attribution to Not applicable for site / company payroll."
            )

    out = [
        {
            "pond_id": pid,
            "pond_name": pond_names.get(pid, ""),
            "amount": str(_q_money(amt)),
        }
        for pid, amt in sorted(by_pond.items())
    ]
    return out, warnings


def compute_pond_labor_allocations_from_employees(
    company_id: int,
) -> tuple[list[dict], list[str]]:
    """
    Sum active employee salaries by pond (single pond or equal split for shared managers).
    Returns ([{pond_id, amount, pond_name?}, ...], warning messages).
    """
    rows = (
        Employee.objects.filter(
            company_id=company_id,
            is_active=True,
            salary__isnull=False,
            salary__gt=0,
        )
        .select_related(
            "home_aquaculture_pond",
            "home_station",
            "home_station__default_aquaculture_pond",
        )
        .order_by("id")
    )
    employee_amounts = [(emp, _q_money(emp.salary or Decimal("0"))) for emp in rows]
    return _accumulate_pond_wages_for_employees(company_id, employee_amounts)


def compute_pond_labor_allocations_from_payroll_employees(
    company_id: int,
    payroll_run_id: int,
) -> tuple[list[dict], list[str]]:
    """Sum per-employee wage rows saved on this payroll run by pond."""
    from api.models import PayrollRunEmployeeAllocation

    stored = list(
        PayrollRunEmployeeAllocation.objects.filter(payroll_run_id=payroll_run_id)
        .select_related(
            "employee",
            "employee__home_aquaculture_pond",
            "employee__home_station",
            "employee__home_station__default_aquaculture_pond",
        )
        .order_by("employee_id")
    )
    employee_amounts = [
        (row.employee, _q_money(row.amount or Decimal("0")))
        for row in stored
        if row.employee_id and row.amount and _q_money(row.amount) > 0
    ]
    return _accumulate_pond_wages_for_employees(company_id, employee_amounts)


def _replace_payroll_pond_allocations(
    payroll_run_id: int,
    allocs: list[dict],
) -> None:
    PayrollRunPondAllocation.objects.filter(payroll_run_id=payroll_run_id).delete()
    for row in allocs:
        amt = _q_money(Decimal(row["amount"]))
        if amt <= 0:
            continue
        PayrollRunPondAllocation.objects.create(
            payroll_run_id=payroll_run_id,
            pond_id=int(row["pond_id"]),
            amount=amt,
        )


def sync_payroll_pond_allocations_from_employees(
    company_id: int,
    payroll: PayrollRun,
) -> tuple[list[dict], list[str]]:
    """
    Replace pond allocations from active employee salaries (gross wage per pond).
    No-op when aquaculture is disabled. Returns (allocations, warnings).
    """
    co = Company.objects.filter(pk=company_id).only("aquaculture_enabled").first()
    if not co or not getattr(co, "aquaculture_enabled", False):
        return [], []
    allocs, warnings = compute_pond_labor_allocations_from_employees(company_id)
    gross = _q_money(payroll.total_gross or Decimal("0"))
    alloc_sum = sum(_q_money(Decimal(a["amount"])) for a in allocs)
    if gross > 0 and allocs and alloc_sum > gross + Decimal("0.02"):
        warnings.append(
            f"Pond wage split ({alloc_sum}) exceeds payroll gross ({gross}); "
            "adjust employee salaries or payroll totals."
        )
    PayrollRunPondAllocation.objects.filter(payroll_run_id=payroll.id).delete()
    for row in allocs:
        amt = _q_money(Decimal(row["amount"]))
        if amt <= 0:
            continue
        PayrollRunPondAllocation.objects.create(
            payroll_run=payroll,
            pond_id=int(row["pond_id"]),
            amount=amt,
        )
    return allocs, warnings


def sync_single_employee_pond_allocations(
    company_id: int,
    payroll: PayrollRun,
    employee: Employee,
    *,
    gross_amount: Decimal | None = None,
) -> list[str]:
    """After a one-employee payroll fill, set pond splits for that person only."""
    warnings: list[str] = []
    sal = _q_money(
        gross_amount if gross_amount is not None else (employee.salary or Decimal("0"))
    )
    PayrollRunPondAllocation.objects.filter(payroll_run_id=payroll.id).delete()
    if sal <= 0:
        return warnings

    if not employee_pond_labor_applies(employee):
        return warnings

    if employee_splits_salary_all_ponds_equally(employee):
        pond_ids = active_pond_ids_for_company(company_id)
        if not pond_ids:
            code = (employee.employee_code or employee.employee_number or f"#{employee.id}").strip()
            warnings.append(f"{code}: no active ponds to split shared manager salary.")
            return warnings
        for pid, amt in _split_amount_equally(sal, pond_ids).items():
            if amt > 0:
                PayrollRunPondAllocation.objects.create(
                    payroll_run=payroll, pond_id=pid, amount=amt
                )
        return warnings

    pid = resolve_employee_labor_pond(employee)
    if pid:
        PayrollRunPondAllocation.objects.create(payroll_run=payroll, pond_id=pid, amount=sal)
    else:
        code = (employee.employee_code or employee.employee_number or f"#{employee.id}").strip()
        name = f"{employee.first_name or ''} {employee.last_name or ''}".strip() or code
        warnings.append(f"{code} ({name}): assign an Aquaculture pond on the employee record.")
    return warnings


def ensure_payroll_pond_allocations_before_post(
    company_id: int,
    payroll: PayrollRun,
) -> tuple[list[str], str | None]:
    """
    Infer pond wage splits from HR when missing so pond P&L and GL 6712 lines are correct.
    Returns (warnings, error_detail). Non-empty error_detail blocks posting.
    """
    if PayrollRunPondAllocation.objects.filter(payroll_run_id=payroll.id).exists():
        return [], None

    co = Company.objects.filter(pk=company_id).only("aquaculture_enabled").first()
    if not co or not getattr(co, "aquaculture_enabled", False):
        return [], None

    gross = _q_money(payroll.total_gross or Decimal("0"))
    if gross <= 0:
        return [], None

    warnings: list[str] = []
    from api.models import PayrollRunEmployeeAllocation

    if PayrollRunEmployeeAllocation.objects.filter(payroll_run_id=payroll.id).exists():
        allocs, alloc_warnings = compute_pond_labor_allocations_from_payroll_employees(
            company_id, payroll.id
        )
        warnings.extend(alloc_warnings)
        if allocs:
            alloc_sum = sum(_q_money(Decimal(a["amount"])) for a in allocs)
            if alloc_sum > gross + Decimal("0.02"):
                return warnings, (
                    f"Pond wage split from picked employees ({alloc_sum}) exceeds payroll gross "
                    f"({gross}). Reduce employee amounts or adjust payroll totals."
                )
            _replace_payroll_pond_allocations(payroll.id, allocs)
        return warnings, None

    emp_qs = Employee.objects.filter(
        company_id=company_id,
        is_active=True,
        salary__isnull=False,
        salary__gt=0,
    )

    if payroll.subledger_employee_id:
        emp = (
            emp_qs.filter(pk=payroll.subledger_employee_id)
            .select_related(
                "home_aquaculture_pond",
                "home_station",
                "home_station__default_aquaculture_pond",
            )
            .first()
        )
        if not emp:
            return [], "Linked employee not found for this payroll run."
        if not employee_pond_labor_applies(emp):
            return [], None
        warnings = sync_single_employee_pond_allocations(
            company_id, payroll, emp, gross_amount=gross
        )
        return warnings, None

    allocs, alloc_warnings = compute_pond_labor_allocations_from_employees(company_id)
    warnings.extend(alloc_warnings)
    alloc_sum = sum(_q_money(Decimal(a["amount"])) for a in allocs)

    if allocs:
        if abs(alloc_sum - gross) <= Decimal("0.02") or gross >= alloc_sum - Decimal("0.02"):
            sync_payroll_pond_allocations_from_employees(company_id, payroll)
            return warnings, None

    assigned = list(
        emp_qs.filter(aquaculture_labor_scope=LABOR_SCOPE_ASSIGNED_POND).select_related(
            "home_aquaculture_pond",
            "home_station",
            "home_station__default_aquaculture_pond",
        )
    )
    if len(assigned) == 1:
        emp = assigned[0]
        max_sal = _q_money(emp.salary or Decimal("0"))
        if gross <= max_sal + Decimal("0.02"):
            warnings = sync_single_employee_pond_allocations(
                company_id, payroll, emp, gross_amount=gross
            )
            return warnings, None

    exact = [
        e
        for e in assigned
        if abs(_q_money(e.salary or Decimal("0")) - gross) <= Decimal("0.02")
    ]
    if len(exact) == 1:
        warnings = sync_single_employee_pond_allocations(
            company_id, payroll, exact[0], gross_amount=gross
        )
        return warnings, None

    pond_applicable = emp_qs.exclude(
        aquaculture_labor_scope=LABOR_SCOPE_NOT_APPLICABLE
    ).exists()
    if pond_applicable:
        if not allocs:
            return warnings, (
                "Payroll has no pond wage split. Set pond allocations, use Fill from one employee "
                "for pond staff pay, or Sum from employees for a full payroll run before posting."
            )
        if alloc_sum > gross + Decimal("0.02"):
            return warnings, (
                f"Pond wage split from HR ({alloc_sum}) exceeds payroll gross ({gross}). "
                "Adjust totals or set pond allocations manually."
            )

    return warnings, None


def aquaculture_labor_expense_account(company_id: int):
    """Prefer 6712 (pond labor) when seeded for aquaculture tenants."""
    from api.services.gl_posting import _coa

    return _coa(company_id, CODE_AQUACULTURE_LABOR)
