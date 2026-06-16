"""Loan facilities: create, activate (schedule), record payments."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from app.core.dependencies import get_db, get_current_user, require_tenant_id
from app.modules.accounting.party_ledger_service import (
    account_balance_for_display,
    post_opening_balance_for_loan,
)
from app.modules.loans.amortization import build_schedule_rows
from app.modules.loans.models import Loan, LoanPayment, LoanScheduleLine
from app.modules.tenancy.models import User

router = APIRouter()


def _d(v) -> Decimal:
    return Decimal(str(v or 0))


class LoanCreate(BaseModel):
    loan_number: str = Field(..., min_length=1, max_length=64)
    lender_name: str
    reference: Optional[str] = None
    principal: float = Field(..., gt=0)
    annual_interest_rate_pct: float = Field(0, ge=0, le=100)
    start_date: datetime
    term_months: int = Field(..., ge=1, le=600)
    opening_balance: float = Field(
        0,
        description="Signed: + = outstanding payable to lender, − = prepayment/receivable from lender",
    )
    opening_balance_as_of: Optional[datetime] = None
    notes: Optional[str] = None


class LoanResponse(BaseModel):
    id: int
    loan_number: str
    lender_name: str
    reference: Optional[str]
    principal: float
    annual_interest_rate_pct: float
    start_date: datetime
    term_months: int
    status: str
    outstanding_principal: Optional[float]
    opening_balance: float = 0
    opening_balance_as_of: Optional[datetime] = None
    gl_account_id: Optional[int] = None
    gl_account_code: Optional[str] = None
    ledger_balance: Optional[float] = None

    class Config:
        from_attributes = True


def _loan_to_response(db: Session, tenant_id: int, r: Loan) -> LoanResponse:
    gl_code = r.gl_account.code if r.gl_account_id and getattr(r, "gl_account", None) else None
    bal = account_balance_for_display(db, tenant_id, r.gl_account_id) if r.gl_account_id else None
    return LoanResponse(
        id=r.id,
        loan_number=r.loan_number,
        lender_name=r.lender_name,
        reference=r.reference,
        principal=float(r.principal),
        annual_interest_rate_pct=float(r.annual_interest_rate_pct),
        start_date=r.start_date,
        term_months=r.term_months,
        status=r.status,
        outstanding_principal=float(r.outstanding_principal) if r.outstanding_principal is not None else None,
        opening_balance=float(r.opening_balance or 0),
        opening_balance_as_of=r.opening_balance_as_of,
        gl_account_id=r.gl_account_id,
        gl_account_code=gl_code,
        ledger_balance=bal,
    )


class ScheduleLineResponse(BaseModel):
    id: int
    installment_no: int
    due_date: datetime
    opening_balance: float
    principal_due: float
    interest_due: float
    total_due: float
    principal_paid: float
    interest_paid: float
    status: str

    class Config:
        from_attributes = True


class PaymentCreate(BaseModel):
    payment_date: datetime
    amount: float = Field(..., gt=0)
    notes: Optional[str] = None


class PaymentResponse(BaseModel):
    id: int
    loan_id: int
    payment_date: datetime
    amount: float
    principal_allocated: float
    interest_allocated: float

    class Config:
        from_attributes = True


@router.get("", response_model=List[LoanResponse])
async def list_loans(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    rows = (
        db.query(Loan)
        .options(joinedload(Loan.gl_account))
        .filter(Loan.tenant_id == tenant_id)
        .order_by(Loan.id.desc())
        .all()
    )
    return [_loan_to_response(db, tenant_id, r) for r in rows]


@router.post("", response_model=LoanResponse)
async def create_loan(
    body: LoanCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    exists = (
        db.query(Loan)
        .filter(Loan.tenant_id == tenant_id, Loan.loan_number == body.loan_number.strip())
        .first()
    )
    if exists:
        raise HTTPException(status_code=400, detail="loan_number already exists for this tenant")

    opening = _d(body.opening_balance)
    as_of = body.opening_balance_as_of or datetime.utcnow()
    loan = Loan(
        tenant_id=tenant_id,
        loan_number=body.loan_number.strip(),
        lender_name=body.lender_name.strip(),
        reference=body.reference,
        principal=_d(body.principal),
        annual_interest_rate_pct=_d(body.annual_interest_rate_pct),
        start_date=body.start_date,
        term_months=body.term_months,
        status="draft",
        outstanding_principal=_d(body.principal),
        opening_balance=opening,
        opening_balance_as_of=as_of if opening != 0 else None,
        notes=body.notes,
        created_by=current_user.id,
    )
    db.add(loan)
    db.flush()

    try:
        ac, _ = post_opening_balance_for_loan(
            db,
            tenant_id,
            loan_id=loan.id,
            display_name=f"{loan.loan_number} · {loan.lender_name}",
            opening=opening,
            as_of=as_of,
            posted_by=current_user.id,
        )
        loan.gl_account_id = ac.id
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e)) from e

    db.commit()
    loan = (
        db.query(Loan)
        .options(joinedload(Loan.gl_account))
        .filter(Loan.id == loan.id, Loan.tenant_id == tenant_id)
        .first()
    )
    return _loan_to_response(db, tenant_id, loan)


@router.post("/{loan_id}/activate", response_model=List[ScheduleLineResponse])
async def activate_loan(
    loan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.tenant_id == tenant_id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    if loan.status != "draft":
        raise HTTPException(status_code=400, detail="Only draft loans can be activated")
    db.query(LoanScheduleLine).filter(LoanScheduleLine.loan_id == loan.id).delete(synchronize_session=False)

    rows = build_schedule_rows(loan.principal, loan.annual_interest_rate_pct, loan.start_date, loan.term_months)
    for idx, (due, opening, princ, intr, total, _closing) in enumerate(rows, start=1):
        ln = LoanScheduleLine(
            tenant_id=tenant_id,
            loan_id=loan.id,
            installment_no=idx,
            due_date=due,
            opening_balance=opening,
            principal_due=princ,
            interest_due=intr,
            total_due=total,
            principal_paid=Decimal("0"),
            interest_paid=Decimal("0"),
            status="scheduled",
            created_by=current_user.id,
        )
        db.add(ln)

    loan.status = "active"
    loan.outstanding_principal = loan.principal
    loan.updated_at = datetime.utcnow()
    db.commit()

    lines = (
        db.query(LoanScheduleLine)
        .filter(LoanScheduleLine.loan_id == loan.id, LoanScheduleLine.tenant_id == tenant_id)
        .order_by(LoanScheduleLine.installment_no)
        .all()
    )
    return lines


@router.get("/{loan_id}/schedule", response_model=List[ScheduleLineResponse])
async def get_schedule(
    loan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.tenant_id == tenant_id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    return (
        db.query(LoanScheduleLine)
        .filter(LoanScheduleLine.loan_id == loan_id, LoanScheduleLine.tenant_id == tenant_id)
        .order_by(LoanScheduleLine.installment_no)
        .all()
    )


def _allocate_payment(
    lines: List[LoanScheduleLine], amount: Decimal
) -> tuple[Decimal, Decimal]:
    """Interest first, then principal, in installment order."""
    remaining = amount.quantize(Decimal("0.01"))
    tot_int = Decimal("0")
    tot_pr = Decimal("0")
    for ln in lines:
        if remaining <= 0:
            break
        int_need = (ln.interest_due - ln.interest_paid).quantize(Decimal("0.01"))
        if int_need > 0:
            take = min(remaining, int_need)
            ln.interest_paid = (ln.interest_paid + take).quantize(Decimal("0.01"))
            tot_int += take
            remaining -= take
        pr_need = (ln.principal_due - ln.principal_paid).quantize(Decimal("0.01"))
        if pr_need > 0 and remaining > 0:
            take = min(remaining, pr_need)
            ln.principal_paid = (ln.principal_paid + take).quantize(Decimal("0.01"))
            tot_pr += take
            remaining -= take
        pr_left = (ln.principal_due - ln.principal_paid).quantize(Decimal("0.01"))
        int_left = (ln.interest_due - ln.interest_paid).quantize(Decimal("0.01"))
        if pr_left <= 0 and int_left <= 0:
            ln.status = "paid"
        elif pr_left > 0 or int_left > 0:
            ln.status = "partial"
    return tot_pr, tot_int


@router.post("/{loan_id}/payments", response_model=PaymentResponse)
async def record_payment(
    loan_id: int,
    body: PaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.tenant_id == tenant_id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    if loan.status != "active":
        raise HTTPException(status_code=400, detail="Loan must be active to accept payments")

    amt = _d(body.amount)
    lines = (
        db.query(LoanScheduleLine)
        .filter(LoanScheduleLine.loan_id == loan.id, LoanScheduleLine.tenant_id == tenant_id)
        .order_by(LoanScheduleLine.installment_no)
        .all()
    )
    if not lines:
        raise HTTPException(status_code=400, detail="Activate the loan to build a schedule first")

    tot_pr, tot_int = _allocate_payment(lines, amt)
    out_principal = Decimal("0")
    for ln in lines:
        out_principal += (ln.principal_due - ln.principal_paid).quantize(Decimal("0.01"))
    if out_principal < 0:
        out_principal = Decimal("0")
    loan.outstanding_principal = out_principal
    if out_principal <= 0:
        loan.status = "closed"

    pay = LoanPayment(
        tenant_id=tenant_id,
        loan_id=loan.id,
        payment_date=body.payment_date,
        amount=amt,
        principal_allocated=tot_pr,
        interest_allocated=tot_int,
        notes=body.notes,
        created_by=current_user.id,
    )
    db.add(pay)
    loan.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(pay)
    return pay
