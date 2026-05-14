"""Sync employee HR subledger when a payroll run is posted to the general ledger."""
from __future__ import annotations

from decimal import Decimal

from django.db.models import Sum

from api.models import Employee, EmployeeLedgerEntry, PayrollRun


def _q(v: Decimal) -> Decimal:
    return (v or Decimal("0")).quantize(Decimal("0.01"))


def backfill_missing_payroll_subledger_lines(company_id: int) -> None:
    """
    For each posted payroll run with no EmployeeLedgerEntry rows yet, run subledger sync.

    Covers payroll posted before subledger integration or any failed sync, so opening
    an employee ledger repopulates lines without posting again.
    """
    for pr in PayrollRun.objects.filter(
        company_id=company_id, salary_journal_id__isnull=False
    ).order_by("id"):
        if EmployeeLedgerEntry.objects.filter(payroll_run_id=pr.id).exists():
            continue
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

    sub_eid = getattr(pr, "subledger_employee_id", None)
    if sub_eid:
        one = Employee.objects.filter(
            pk=int(sub_eid), company_id=company_id, is_active=True
        ).first()
        if one:
            emps = [one]
            weights = [Decimal("1")]
        else:
            emps = []
            weights = []
    else:
        emps = list(
            Employee.objects.filter(
                company_id=company_id,
                is_active=True,
                salary__isnull=False,
                salary__gt=0,
            ).order_by("id")
        )
        weights = [_q(e.salary or Decimal("0")) for e in emps]
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
    ded_parts = _split_total_by_weights(ded, weights)
    net_parts = _split_total_by_weights(net, weights)

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
