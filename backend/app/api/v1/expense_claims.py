from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ConfigDict, field_validator
from sqlalchemy.orm import Session

from app.core.dependencies import get_db, get_current_user, require_tenant_id
from app.modules.expenses.models import ExpenseClaim, ExpenseClaimLine
from app.modules.tenancy.models import User

router = APIRouter()


class LineIn(BaseModel):
    category: str = Field(..., description="transport, fuel, meals_breakfast, meals_lunch, meals_dinner, lodging, toll, parking, other")
    amount: float
    spent_on: Optional[datetime] = None
    description: Optional[str] = None
    receipt_ref: Optional[str] = None


class ClaimCreate(BaseModel):
    purpose: Optional[str] = None
    customer_id: Optional[int] = None
    trip_ref: Optional[str] = None
    lines: List[LineIn] = Field(default_factory=list)


class ClaimLineResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    category: str
    amount: float
    spent_on: datetime
    description: Optional[str]
    receipt_ref: Optional[str]

    @field_validator("amount", mode="before")
    @classmethod
    def _amount_float(cls, v):
        return float(v) if v is not None else v


class ClaimResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    claim_number: str
    user_id: int
    employee_id: Optional[int]
    status: str
    purpose: Optional[str]
    customer_id: Optional[int]
    trip_ref: Optional[str]
    submitted_at: Optional[datetime]
    decided_at: Optional[datetime]
    reviewer_notes: Optional[str]
    lines: List[ClaimLineResponse]


def _next_claim_number(db: Session, tenant_id: int) -> str:
    prefix = datetime.utcnow().strftime("EXP-%Y%m%d-")
    n = (
        db.query(ExpenseClaim)
        .filter(ExpenseClaim.tenant_id == tenant_id, ExpenseClaim.claim_number.like(prefix + "%"))
        .count()
    )
    return f"{prefix}{n + 1:04d}"


@router.get("/claims", response_model=List[ClaimResponse])
async def list_claims(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    mine_only: bool = False,
):
    q = db.query(ExpenseClaim).filter(ExpenseClaim.tenant_id == tenant_id)
    if mine_only:
        q = q.filter(ExpenseClaim.user_id == current_user.id)
    claims = q.order_by(ExpenseClaim.id.desc()).all()
    return claims


@router.post("/claims", response_model=ClaimResponse)
async def create_claim(
    body: ClaimCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    if not body.lines:
        raise HTTPException(status_code=400, detail="Add at least one line item")
    claim = ExpenseClaim(
        tenant_id=tenant_id,
        claim_number=_next_claim_number(db, tenant_id),
        user_id=current_user.id,
        employee_id=None,
        status="draft",
        purpose=body.purpose,
        customer_id=body.customer_id,
        trip_ref=body.trip_ref,
        created_by=current_user.id,
    )
    db.add(claim)
    db.flush()
    for ln in body.lines:
        line = ExpenseClaimLine(
            tenant_id=tenant_id,
            claim_id=claim.id,
            category=ln.category,
            amount=Decimal(str(ln.amount)),
            spent_on=ln.spent_on or datetime.utcnow(),
            description=ln.description,
            receipt_ref=ln.receipt_ref,
            created_by=current_user.id,
        )
        db.add(line)
    db.commit()
    db.refresh(claim)
    return claim


@router.post("/claims/{claim_id}/submit", response_model=ClaimResponse)
async def submit_claim(
    claim_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    claim = (
        db.query(ExpenseClaim)
        .filter(
            ExpenseClaim.id == claim_id,
            ExpenseClaim.tenant_id == tenant_id,
            ExpenseClaim.user_id == current_user.id,
        )
        .first()
    )
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.status != "draft":
        raise HTTPException(status_code=400, detail="Only draft claims can be submitted")
    claim.status = "submitted"
    claim.submitted_at = datetime.utcnow()
    db.commit()
    db.refresh(claim)
    return claim


class ReviewBody(BaseModel):
    approve: bool
    notes: Optional[str] = None


@router.post("/claims/{claim_id}/review", response_model=ClaimResponse)
async def review_claim(
    claim_id: int,
    body: ReviewBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    """Simple approve/reject — extend with roles later."""
    claim = (
        db.query(ExpenseClaim)
        .filter(ExpenseClaim.id == claim_id, ExpenseClaim.tenant_id == tenant_id)
        .first()
    )
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.status != "submitted":
        raise HTTPException(status_code=400, detail="Only submitted claims can be reviewed")
    claim.status = "approved" if body.approve else "rejected"
    claim.decided_at = datetime.utcnow()
    claim.decided_by_user_id = current_user.id
    claim.reviewer_notes = body.notes
    db.commit()
    db.refresh(claim)
    return claim
