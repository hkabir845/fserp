"""Sync employee HR subledger when a payroll run is posted to the general ledger."""
from __future__ import annotations

from decimal import Decimal

from django.db.models import Sum

from api.models import Employee, EmployeeLedgerEntry, PayrollRun


def _q(v: Decimal) -> Decimal:
    return (v or Decimal("0")).quantize(Decimal("0.01"))


def backfill_missing_payroll_subledger_lines(company_id: int) -> None:
    """
    Re-sync subledger lines for every posted payroll run for this company.

    Idempotent: replaces lines using current attribution rules so partial pond payrolls
    and from-one-employee runs stay aligned with the GL.
    """
    for pr in PayrollRun.objects.filter(
        company_id=company_id, salary_journal_id__isnull=False
    ).order_by("id"):
        sync_payroll_run_to_employee_ledgers(company_id, pr)


def refresh_employee_balance(employee_id: int) -> None:
    """Recompute Employee.current_balance from opening_balance and ledger lines."""
    emp = Employee.objects.filter(pk=employee_id).first()
    if not emp:
        return
    ob = emp.opening_balance or Decimal("0")
    agg = EmployeeLedgerEntry.objects.filter(employee_id=employee_id).aggregate(
        d=Sum("debit"), c=Sum("credit")
    )
    d = agg.get("d") or Decimal("0")
    c = agg.get("c") or Decimal("0")
    nb = _q(ob + d - c)
    Employee.objects.filter(pk=employee_id).update(current_balance=nb)


def _resolve_subledger_employees(
    company_id: int, pr: PayrollRun
) -> tuple[list[Employee], list[Decimal]]:
    """
    Employees whose HR subledger should receive this payroll run.

    Full-team runs (gross = sum of all salaries) split across all salaried staff.
    Pond-only runs (gross = sum of pond-scoped salaries) split across pond workers only.
    Single-employee and partial runs attribute to the correct person(s), not the whole roster.
    """
    gross = _q(pr.total_gross or Decimal("0"))
    sub_eid = getattr(pr, "subledger_employee_id", None)
    if sub_eid:
        one = Employee.objects.filter(
            pk=int(sub_eid), company_id=company_id, is_active=True
        ).first()
        if one:
            return [one], [Decimal("1")]
        return [], []

    all_emps = list(
        Employee.objects.filter(
            company_id=company_id,
            is_active=True,
            salary__isnull=False,
            salary__gt=0,
        ).order_by("id")
    )
    if not all_emps:
        return [], []

    all_sum = _q(sum(_q(e.salary or Decimal("0")) for e in all_emps))
    if abs(all_sum - gross) <= Decimal("0.02"):
        return all_emps, [_q(e.salary or Decimal("0")) for e in all_emps]

    from api.services.employee_pond_labor import (
        LABOR_SCOPE_ASSIGNED_POND,
        employee_pond_labor_applies,
    )

    pond_emps = [e for e in all_emps if employee_pond_labor_applies(e)]
    if pond_emps:
        pond_sum = _q(sum(_q(e.salary or Decimal("0")) for e in pond_emps))
        if abs(pond_sum - gross) <= Decimal("0.02"):
            return pond_emps, [_q(e.salary or Decimal("0")) for e in pond_emps]

    assigned = [
        e
        for e in all_emps
        if (getattr(e, "aquaculture_labor_scope", None) or "") == LABOR_SCOPE_ASSIGNED_POND
    ]
    if len(assigned) == 1:
        emp = assigned[0]
        if gross <= _q(emp.salary or Decimal("0")) + Decimal("0.02"):
            return [emp], [Decimal("1")]

    exact = [
        e for e in all_emps if abs(_q(e.salary or Decimal("0")) - gross) <= Decimal("0.02")
    ]
    if len(exact) == 1:
        return exact, [Decimal("1")]

    subset = _unique_employee_subset_matching_gross(all_emps, gross)
    if subset is not None:
        return subset

    # Partial payroll with no confident HR match — caller must use stored employee rows.
    return [], []


def _unique_employee_subset_matching_gross(
    emps: list[Employee], gross: Decimal
) -> tuple[list[Employee], list[Decimal]] | None:
    """When exactly one employee group sums to gross, return that group."""
    from itertools import combinations

    gross = _q(gross)
    if gross <= 0 or not emps:
        return None
    matches: list[tuple[list[Employee], list[Decimal]]] = []
    n = len(emps)
    for size in range(1, min(n, 12) + 1):
        for combo in combinations(emps, size):
            weights = [_q(e.salary or Decimal("0")) for e in combo]
            if abs(sum(weights) - gross) <= Decimal("0.02"):
                matches.append((list(combo), weights))
    if len(matches) == 1:
        return matches[0]
    return None


def _split_total_by_weights(total: Decimal, weights: list[Decimal]) -> list[Decimal]:
    """Allocate ``total`` across ``weights`` (all > 0); last row absorbs rounding remainder."""
    total = _q(total)
    if not weights:
        return []
    W = sum(weights)
    if W <= 0:
        return [_q(Decimal("0"))] * len(weights)
    n = len(weights)
    out: list[Decimal] = []
    allocated = Decimal("0")
    for i, w in enumerate(weights):
        if i == n - 1:
            part = _q(total - allocated)
        else:
            part = _q(total * (w / W))
            allocated += part
        out.append(part)
    return out


def sync_payroll_run_to_employee_ledgers(company_id: int, pr: PayrollRun) -> None:
    """
    Replace subledger lines tied to this payroll run.

    Allocates gross, deductions, and net pay across active employees with positive salary
    in proportion to salary. Net effect on each employee's running balance is zero
    (gross accrual offset by deductions and net payment), but the ledger shows the same
    economic story as the posted salary journal.

    If no employees have a positive salary, nothing is written (totals cannot be attributed).

    When the payroll run has ``subledger_employee`` set (from-one-employee), all lines go to
    that person regardless of other salaried staff.
    """
    pr_id = int(pr.pk)
    gross = _q(pr.total_gross or Decimal("0"))
    ded = _q(pr.total_deductions or Decimal("0"))
    net = _q(pr.total_net or Decimal("0"))
    if gross <= 0:
        old_eids = set(
            EmployeeLedgerEntry.objects.filter(payroll_run_id=pr_id).values_list(
                "employee_id", flat=True
            )
        )
        EmployeeLedgerEntry.objects.filter(payroll_run_id=pr_id).delete()
        for eid in old_eids:
            refresh_employee_balance(int(eid))
        return

    from api.services.employee_payroll_allocations import (
        stored_employee_allocations_for_subledger,
    )

    stored_rows = stored_employee_allocations_for_subledger(pr_id)
    if stored_rows:
        emps = [row[0] for row in stored_rows]
        gross_parts = [row[1] for row in stored_rows]
        weight_basis = gross_parts
    else:
        emps, weights = _resolve_subledger_employees(company_id, pr)
        if not emps or sum(weights) <= 0:
            old_eids = set(
                EmployeeLedgerEntry.objects.filter(payroll_run_id=pr_id).values_list(
                    "employee_id", flat=True
                )
            )
            EmployeeLedgerEntry.objects.filter(payroll_run_id=pr_id).delete()
            for eid in old_eids:
                refresh_employee_balance(int(eid))
            return
        gross_parts = _split_total_by_weights(gross, weights)
        weight_basis = weights

    ded_parts = _split_total_by_weights(ded, weight_basis)
    net_parts = _split_total_by_weights(net, weight_basis)

    old_eids = set(
        EmployeeLedgerEntry.objects.filter(payroll_run_id=pr_id).values_list(
            "employee_id", flat=True
        )
    )
    EmployeeLedgerEntry.objects.filter(payroll_run_id=pr_id).delete()

    ref_label = (pr.payroll_number or f"PR-{pr_id}")[:120]
    pay_date = pr.payment_date
    touched: set[int] = set(old_eids)

    for emp, g_i, d_i, n_i in zip(emps, gross_parts, ded_parts, net_parts):
        eid = int(emp.id)
        touched.add(eid)
        base_ref = f"AUTO-PR{pr_id}-E{eid}"
        if g_i > 0:
            EmployeeLedgerEntry.objects.create(
                employee_id=eid,
                payroll_run_id=pr_id,
                entry_date=pay_date,
                entry_type="payroll",
                reference=f"{base_ref}-G"[:200],
                memo=f"Gross pay — {ref_label}"[:500],
                debit=g_i,
                credit=Decimal("0"),
            )
        if d_i > 0:
            EmployeeLedgerEntry.objects.create(
                employee_id=eid,
                payroll_run_id=pr_id,
                entry_date=pay_date,
                entry_type="payroll",
                reference=f"{base_ref}-D"[:200],
                memo=f"Deductions / withholdings — {ref_label}"[:500],
                debit=Decimal("0"),
                credit=d_i,
            )
        if n_i > 0:
            EmployeeLedgerEntry.objects.create(
                employee_id=eid,
                payroll_run_id=pr_id,
                entry_date=pay_date,
                entry_type="payroll",
                reference=f"{base_ref}-N"[:200],
                memo=f"Net pay — {ref_label}"[:500],
                debit=Decimal("0"),
                credit=n_i,
            )

    for eid in touched:
        refresh_employee_balance(eid)
