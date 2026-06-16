"""
Payroll: employees, salary structures, runs, and payslip generation.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from app.core.dependencies import get_db, get_current_user, require_tenant_id
from app.modules.accounting.party_ledger_service import (
    account_balance_for_display,
    post_opening_balance_for_employee,
)
from app.modules.payroll.models import Employee, PayrollRun, Payslip, SalaryStructure
from app.modules.tenancy.models import User

router = APIRouter()


# ---------- Helpers ----------


def _money(v: Any) -> Decimal:
    if v is None:
        return Decimal("0")
    return Decimal(str(v))


def compute_from_structure(ss: SalaryStructure) -> tuple[Decimal, Decimal, Decimal]:
    """Returns gross, total_deductions, net."""
    basic = _money(ss.basic)
    allow = Decimal("0")
    if ss.allowances_json and isinstance(ss.allowances_json, dict):
        for v in ss.allowances_json.values():
            allow += _money(v)
    deduct = Decimal("0")
    if ss.deductions_json and isinstance(ss.deductions_json, dict):
        for v in ss.deductions_json.values():
            deduct += _money(v)
    gross = basic + allow
    net = gross - deduct
    return gross, deduct, net


# ---------- Schemas ----------


class EmployeeResponse(BaseModel):
    id: int
    employee_code: Optional[str] = None
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    join_date: datetime
    bank_name: Optional[str] = None
    bank_account_no: Optional[str] = None
    bank_branch: Optional[str] = None
    bank_routing_or_ifsc: Optional[str] = None
    opening_balance: float = 0
    opening_balance_as_of: Optional[datetime] = None
    gl_account_id: Optional[int] = None
    gl_account_code: Optional[str] = None
    ledger_balance: Optional[float] = None
    is_active: bool
    basic_salary: Optional[float] = None
    ready_for_payroll: bool = False

    class Config:
        from_attributes = True


class EmployeeCreate(BaseModel):
    employee_code: Optional[str] = None
    name: str = Field(..., min_length=1)
    phone: Optional[str] = None
    email: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    join_date: datetime
    basic_salary: float = Field(0, ge=0, description="Monthly basic; creates salary structure when > 0")
    bank_name: Optional[str] = None
    bank_account_no: Optional[str] = None
    bank_branch: Optional[str] = None
    bank_routing_or_ifsc: Optional[str] = None
    opening_balance: float = Field(
        0,
        description="Signed: + = we owe employee (payable), − = employee advance owed to company",
    )
    opening_balance_as_of: Optional[datetime] = None


class EmployeeUpdate(BaseModel):
    employee_code: Optional[str] = None
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    join_date: Optional[datetime] = None
    bank_name: Optional[str] = None
    bank_account_no: Optional[str] = None
    bank_branch: Optional[str] = None
    bank_routing_or_ifsc: Optional[str] = None
    is_active: Optional[bool] = None


class SalaryUpsert(BaseModel):
    basic: float = Field(..., ge=0)
    allowances_json: Optional[Dict[str, Any]] = None
    deductions_json: Optional[Dict[str, Any]] = None
    effective_from: Optional[datetime] = None


class PayrollRunResponse(BaseModel):
    id: int
    run_number: str
    period_month: int
    period_year: int
    status: str
    run_date: datetime

    class Config:
        from_attributes = True


class PayrollRunCreate(BaseModel):
    period_month: int = Field(..., ge=1, le=12)
    period_year: int = Field(..., ge=2000, le=2100)


class PayslipResponse(BaseModel):
    id: int
    employee_id: int
    employee_name: Optional[str] = None
    gross: float
    deduction: float
    net: float

    class Config:
        from_attributes = True


class CalculateResult(BaseModel):
    run: PayrollRunResponse
    payslips_created: int
    skipped_no_salary: List[str] = []
    message: str


def _emp_to_response(db: Session, tenant_id: int, e: Employee) -> EmployeeResponse:
    basic = None
    ready = False
    try:
        if e.salary_structure:
            basic = float(e.salary_structure.basic or 0)
            if basic > 0 and e.is_active:
                ready = True
    except Exception:
        pass
    code = e.gl_account.code if e.gl_account_id and getattr(e, "gl_account", None) else None
    bal = account_balance_for_display(db, tenant_id, e.gl_account_id) if e.gl_account_id else None
    return EmployeeResponse(
        id=e.id,
        employee_code=e.employee_code,
        name=e.name,
        phone=e.phone,
        email=e.email,
        department=e.department,
        designation=e.designation,
        join_date=e.join_date,
        bank_name=e.bank_name,
        bank_account_no=e.bank_account_no,
        bank_branch=e.bank_branch,
        bank_routing_or_ifsc=e.bank_routing_or_ifsc,
        opening_balance=float(e.opening_balance or 0),
        opening_balance_as_of=e.opening_balance_as_of,
        gl_account_id=e.gl_account_id,
        gl_account_code=code,
        ledger_balance=bal,
        is_active=e.is_active,
        basic_salary=basic,
        ready_for_payroll=ready,
    )


# ---------- Employees ----------


@router.get("/employees", response_model=List[EmployeeResponse])
async def list_employees(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    rows = (
        db.query(Employee)
        .options(joinedload(Employee.salary_structure), joinedload(Employee.gl_account))
        .filter(Employee.tenant_id == tenant_id)
        .order_by(Employee.name)
        .all()
    )
    return [_emp_to_response(db, tenant_id, e) for e in rows]


@router.post("/employees", response_model=EmployeeResponse)
async def create_employee(
    payload: EmployeeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    ob = Decimal(str(payload.opening_balance))
    as_of = payload.opening_balance_as_of or datetime.utcnow()
    emp = Employee(
        tenant_id=tenant_id,
        employee_code=payload.employee_code.strip() if payload.employee_code else None,
        name=payload.name.strip(),
        phone=payload.phone,
        email=payload.email,
        department=payload.department,
        designation=payload.designation,
        join_date=payload.join_date,
        bank_name=payload.bank_name,
        bank_account_no=payload.bank_account_no,
        bank_branch=payload.bank_branch,
        bank_routing_or_ifsc=payload.bank_routing_or_ifsc,
        opening_balance=ob,
        opening_balance_as_of=as_of if ob != 0 else None,
        is_active=True,
        created_by=current_user.id,
    )
    db.add(emp)
    db.flush()

    try:
        ac, _ = post_opening_balance_for_employee(
            db,
            tenant_id,
            employee_id=emp.id,
            display_name=emp.name,
            opening=ob,
            as_of=as_of,
            posted_by=current_user.id,
        )
        emp.gl_account_id = ac.id
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e)) from e

    if payload.basic_salary and payload.basic_salary > 0:
        ss = SalaryStructure(
            tenant_id=tenant_id,
            employee_id=emp.id,
            basic=Decimal(str(payload.basic_salary)),
            allowances_json=None,
            deductions_json=None,
            effective_from=payload.join_date,
            effective_to=None,
            created_by=current_user.id,
        )
        db.add(ss)

    db.commit()
    emp = (
        db.query(Employee)
        .options(joinedload(Employee.salary_structure), joinedload(Employee.gl_account))
        .filter(Employee.id == emp.id, Employee.tenant_id == tenant_id)
        .first()
    )
    return _emp_to_response(db, tenant_id, emp)


@router.patch("/employees/{employee_id}", response_model=EmployeeResponse)
async def update_employee(
    employee_id: int,
    payload: EmployeeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    emp = (
        db.query(Employee)
        .options(joinedload(Employee.salary_structure), joinedload(Employee.gl_account))
        .filter(Employee.id == employee_id, Employee.tenant_id == tenant_id)
        .first()
    )
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(emp, k, v)
    emp.updated_at = datetime.utcnow()
    db.commit()
    emp = (
        db.query(Employee)
        .options(joinedload(Employee.salary_structure), joinedload(Employee.gl_account))
        .filter(Employee.id == employee_id, Employee.tenant_id == tenant_id)
        .first()
    )
    return _emp_to_response(db, tenant_id, emp)


@router.put("/employees/{employee_id}/salary", response_model=EmployeeResponse)
async def upsert_salary(
    employee_id: int,
    payload: SalaryUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    emp = (
        db.query(Employee)
        .options(joinedload(Employee.salary_structure), joinedload(Employee.gl_account))
        .filter(Employee.id == employee_id, Employee.tenant_id == tenant_id)
        .first()
    )
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    eff = payload.effective_from or emp.join_date or datetime.utcnow()

    if emp.salary_structure:
        ss = emp.salary_structure
        ss.basic = Decimal(str(payload.basic))
        ss.allowances_json = payload.allowances_json
        ss.deductions_json = payload.deductions_json
        ss.effective_from = eff
        ss.updated_at = datetime.utcnow()
    else:
        ss = SalaryStructure(
            tenant_id=tenant_id,
            employee_id=emp.id,
            basic=Decimal(str(payload.basic)),
            allowances_json=payload.allowances_json,
            deductions_json=payload.deductions_json,
            effective_from=eff,
            effective_to=None,
            created_by=current_user.id,
        )
        db.add(ss)

    db.commit()
    emp = (
        db.query(Employee)
        .options(joinedload(Employee.salary_structure), joinedload(Employee.gl_account))
        .filter(Employee.id == employee_id, Employee.tenant_id == tenant_id)
        .first()
    )
    return _emp_to_response(db, tenant_id, emp)


# ---------- Runs & payslips ----------


@router.get("/runs", response_model=List[PayrollRunResponse])
async def list_payroll_runs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    limit: int = 50,
):
    rows = (
        db.query(PayrollRun)
        .filter(PayrollRun.tenant_id == tenant_id)
        .order_by(PayrollRun.run_date.desc(), PayrollRun.id.desc())
        .limit(min(limit, 200))
        .all()
    )
    return rows


@router.post("/runs", response_model=PayrollRunResponse)
async def create_payroll_run(
    payload: PayrollRunCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    """Create a draft payroll run for a calendar period."""
    run_number = f"PR-{tenant_id}-{payload.period_year}{payload.period_month:02d}-{uuid.uuid4().hex[:10].upper()}"
    run = PayrollRun(
        tenant_id=tenant_id,
        run_number=run_number,
        period_month=payload.period_month,
        period_year=payload.period_year,
        status="draft",
        run_date=datetime.utcnow(),
        created_by=current_user.id,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


@router.post("/runs/{run_id}/calculate", response_model=CalculateResult)
async def calculate_payslips(
    run_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    """
    Generate payslips for all active employees with a salary structure.
    Replaces existing payslips if the run is still draft.
    """
    run = (
        db.query(PayrollRun)
        .filter(PayrollRun.id == run_id, PayrollRun.tenant_id == tenant_id)
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Payroll run not found")
    if run.status != "draft":
        raise HTTPException(status_code=400, detail="Only draft runs can be calculated")

    db.query(Payslip).filter(Payslip.payroll_run_id == run.id).delete(synchronize_session=False)

    emps = (
        db.query(Employee)
        .options(joinedload(Employee.salary_structure))
        .filter(Employee.tenant_id == tenant_id, Employee.is_active == True)
        .order_by(Employee.name)
        .all()
    )

    skipped: List[str] = []
    created = 0
    for emp in emps:
        if not emp.salary_structure:
            skipped.append(f"{emp.name} (no salary structure)")
            continue
        gross, deduct, net = compute_from_structure(emp.salary_structure)
        if gross <= 0 and deduct <= 0:
            skipped.append(f"{emp.name} (zero amounts)")
            continue
        slip = Payslip(
            tenant_id=tenant_id,
            payroll_run_id=run.id,
            employee_id=emp.id,
            gross=gross,
            deduction=deduct,
            net=net,
            created_by=current_user.id,
        )
        db.add(slip)
        created += 1

    run.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(run)

    msg = f"Created {created} payslip(s)."
    if skipped:
        msg += f" Skipped {len(skipped)}."

    return CalculateResult(
        run=PayrollRunResponse.model_validate(run),
        payslips_created=created,
        skipped_no_salary=skipped,
        message=msg,
    )


@router.post("/runs/{run_id}/post", response_model=PayrollRunResponse)
async def post_payroll_run(
    run_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    run = (
        db.query(PayrollRun)
        .filter(PayrollRun.id == run_id, PayrollRun.tenant_id == tenant_id)
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Payroll run not found")
    if run.status != "draft":
        raise HTTPException(status_code=400, detail="Only draft runs can be posted")

    n = db.query(Payslip).filter(Payslip.payroll_run_id == run.id).count()
    if n == 0:
        raise HTTPException(status_code=400, detail="Calculate payslips before posting")

    run.status = "posted"
    run.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(run)
    return run


@router.get("/runs/{run_id}/payslips", response_model=List[PayslipResponse])
async def list_payslips(
    run_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    run = (
        db.query(PayrollRun)
        .filter(PayrollRun.id == run_id, PayrollRun.tenant_id == tenant_id)
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Payroll run not found")

    slips = (
        db.query(Payslip)
        .options(joinedload(Payslip.employee))
        .filter(Payslip.payroll_run_id == run_id, Payslip.tenant_id == tenant_id)
        .order_by(Payslip.id)
        .all()
    )
    out: List[PayslipResponse] = []
    for p in slips:
        nm = None
        try:
            if p.employee:
                nm = p.employee.name
        except Exception:
            nm = None
        out.append(
            PayslipResponse(
                id=p.id,
                employee_id=p.employee_id,
                employee_name=nm,
                gross=float(p.gross),
                deduction=float(p.deduction),
                net=float(p.net),
            )
        )
    return out
