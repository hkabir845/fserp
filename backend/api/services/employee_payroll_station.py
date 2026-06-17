"""Resolve payroll run site (station) from HR employee work-site assignments."""
from __future__ import annotations

from decimal import Decimal

from api.models import Employee, PayrollRun
from api.services.employee_pond_labor import (
    LABOR_SCOPE_ALL_PONDS_EQUAL,
    LABOR_SCOPE_ASSIGNED_POND,
    employee_labor_scope,
    employee_pond_labor_applies,
)


def _q(v: Decimal) -> Decimal:
    return (v or Decimal("0")).quantize(Decimal("0.01"))


def employee_work_site_label(employee: Employee) -> str:
    """Human-readable HR work assignment for API / UI."""
    if getattr(employee, "home_station_id", None) and getattr(employee, "home_station", None):
        name = (employee.home_station.station_name or "").strip()
        if name:
            return name
        return f"Site #{employee.home_station_id}"
    scope = employee_labor_scope(employee)
    if scope == LABOR_SCOPE_ALL_PONDS_EQUAL:
        return "All ponds (equal share)"
    if scope == LABOR_SCOPE_ASSIGNED_POND:
        pond = getattr(employee, "home_aquaculture_pond", None)
        if pond is not None:
            name = (pond.name or "").strip()
            if name:
                return name
        if getattr(employee, "home_aquaculture_pond_id", None):
            return f"Pond #{employee.home_aquaculture_pond_id}"
        return "Pond — not set"
    return ""


def resolve_payroll_station_id_from_employees(
    employees: list[Employee],
    *,
    company_site_gross: Decimal | None = None,
) -> int | None:
    """
    Infer payroll site (6400 GL tag) from HR staff on this run.

    Returns a station id when site/company payroll staff share one work site.
    Returns None when wages are fully pond-scoped, staff are company-wide, or sites conflict.
    """
    if not employees:
        return None

    site_gross = _q(company_site_gross) if company_site_gross is not None else None
    if site_gross is not None and site_gross <= Decimal("0.02"):
        return None

    site_staff = [e for e in employees if not employee_pond_labor_applies(e)]
    if not site_staff and site_gross is None:
        site_staff = list(employees)

    station_ids = sorted(
        {
            int(e.home_station_id)
            for e in site_staff
            if getattr(e, "home_station_id", None)
        }
    )
    if len(station_ids) == 1:
        return station_ids[0]
    if len(station_ids) > 1:
        return None

    if site_staff and all(not getattr(e, "home_station_id", None) for e in site_staff):
        return None

    pond_only = all(employee_pond_labor_applies(e) for e in employees)
    if pond_only:
        return None

    return None


def employees_for_payroll_station_sync(company_id: int, payroll: PayrollRun) -> list[Employee]:
    from api.models import PayrollRunEmployeeAllocation

    stored = list(
        PayrollRunEmployeeAllocation.objects.filter(payroll_run_id=payroll.id)
        .select_related("employee", "employee__home_station")
        .order_by("employee_id")
    )
    if stored:
        return [row.employee for row in stored if row.employee_id]
    return list(
        Employee.objects.filter(
            company_id=company_id,
            is_active=True,
            salary__isnull=False,
            salary__gt=0,
        )
        .select_related("home_station")
        .order_by("id")
    )


def sync_payroll_station_from_employees(
    company_id: int,
    payroll: PayrollRun,
    *,
    company_site_gross: Decimal | None = None,
) -> None:
    """
    Set or clear payroll.station_id from HR work sites on allocated / active employees.
    Does not fall back to a default fuel station — callers use that only at GL post time.
    """
    emps = employees_for_payroll_station_sync(company_id, payroll)
    sid = resolve_payroll_station_id_from_employees(emps, company_site_gross=company_site_gross)
    from api.models import PayrollRun as PayrollRunModel

    PayrollRunModel.objects.filter(pk=payroll.pk).update(station_id=sid)
