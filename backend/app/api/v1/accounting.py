from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from app.core.dependencies import get_db, get_current_user, require_tenant_id
from app.modules.accounting.models import Account, JournalEntry, JournalLine
from app.modules.tenancy.models import User
from pydantic import BaseModel, Field
from datetime import datetime
from decimal import Decimal

router = APIRouter()

class AccountResponse(BaseModel):
    id: int
    code: str
    name: str
    type: str
    is_active: bool
    
    class Config:
        from_attributes = True

@router.get("/accounts", response_model=List[AccountResponse])
async def list_accounts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    """List chart of accounts (tenant-scoped; same as apply template)."""
    accounts = db.query(Account).filter(
        Account.tenant_id == tenant_id,
        Account.is_active == True
    ).order_by(Account.code).all()
    return accounts


class ApplyFeedMillCoaBody(BaseModel):
    replace_existing: bool = False


@router.post("/accounts/apply-feed-mill-template")
async def apply_feed_mill_chart_of_accounts(
    body: ApplyFeedMillCoaBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    """
    Seeds a general-purpose IFRS-style chart (IAS 1 presentation, IFRS 15/16, IAS 12, IAS 37, etc.)
    tuned for feed milling: inventory, fleet, COGS, field travel & claims, QC, tax, leases, provisions.
    Use replace_existing only on a tenant with no posted journals (destructive).
    """
    from app.modules.accounting.coa_feed_mill import apply_feed_mill_chart

    try:
        n = apply_feed_mill_chart(db, tenant_id, replace_existing=body.replace_existing)
    except ValueError as e:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"created_accounts": n, "detail": "Feed mill chart of accounts applied."}


class JournalCreateLine(BaseModel):
    account_id: int
    debit: float = Field(0, ge=0)
    credit: float = Field(0, ge=0)
    memo: Optional[str] = None


class JournalCreateBody(BaseModel):
    date: Optional[datetime] = None
    memo: Optional[str] = None
    lines: List[JournalCreateLine]


class JournalPostResponse(BaseModel):
    id: int
    entry_number: str
    is_posted: bool


def _validate_balanced_lines(lines: List[JournalCreateLine]) -> tuple[Decimal, Decimal]:
    if len(lines) < 2:
        raise HTTPException(status_code=400, detail="Journal requires at least 2 lines")
    total_debit = sum((Decimal(str(l.debit)) for l in lines), Decimal("0"))
    total_credit = sum((Decimal(str(l.credit)) for l in lines), Decimal("0"))
    if total_debit <= 0 and total_credit <= 0:
        raise HTTPException(status_code=400, detail="Journal amounts cannot be all zero")
    if (total_debit - total_credit).copy_abs() > Decimal("0.01"):
        raise HTTPException(status_code=400, detail=f"Journal not balanced: debit={total_debit} credit={total_credit}")
    for l in lines:
        if l.debit > 0 and l.credit > 0:
            raise HTTPException(status_code=400, detail="A line cannot have both debit and credit")
    return total_debit, total_credit


@router.post("/journal-entries/draft", response_model=JournalPostResponse)
async def create_manual_journal_draft(
    body: JournalCreateBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    _validate_balanced_lines(body.lines)
    account_ids = {l.account_id for l in body.lines}
    accounts = db.query(Account).filter(Account.tenant_id == tenant_id, Account.id.in_(account_ids), Account.is_active == True).all()
    if len(accounts) != len(account_ids):
        raise HTTPException(status_code=400, detail="One or more accounts are invalid or inactive")

    entry_number = f"JE-DRAFT-{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}"
    je = JournalEntry(
        tenant_id=tenant_id,
        entry_number=entry_number,
        date=body.date or datetime.utcnow(),
        memo=(body.memo or "").strip() or None,
        ref_type="manual_journal",
        ref_id=None,
        posted_by=None,
        is_posted=False,
        created_by=current_user.id,
    )
    db.add(je)
    db.flush()
    for ln in body.lines:
        row = JournalLine(
            tenant_id=tenant_id,
            journal_id=je.id,
            account_id=ln.account_id,
            debit=Decimal(str(ln.debit)),
            credit=Decimal(str(ln.credit)),
            memo=(ln.memo or "").strip() or None,
            created_by=current_user.id,
        )
        db.add(row)
    db.commit()
    db.refresh(je)
    return JournalPostResponse(id=je.id, entry_number=je.entry_number, is_posted=bool(je.is_posted))


@router.post("/journal-entries/{journal_id}/post", response_model=JournalPostResponse)
async def post_manual_journal(
    journal_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    je = db.query(JournalEntry).filter(JournalEntry.id == journal_id, JournalEntry.tenant_id == tenant_id).first()
    if not je:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    if je.is_posted:
        return JournalPostResponse(id=je.id, entry_number=je.entry_number, is_posted=True)
    lines = db.query(JournalLine).filter(JournalLine.journal_id == je.id, JournalLine.tenant_id == tenant_id).all()
    if len(lines) < 2:
        raise HTTPException(status_code=400, detail="Draft journal has insufficient lines")
    total_debit = sum((Decimal(str(l.debit or 0)) for l in lines), Decimal("0"))
    total_credit = sum((Decimal(str(l.credit or 0)) for l in lines), Decimal("0"))
    if (total_debit - total_credit).copy_abs() > Decimal("0.01"):
        raise HTTPException(status_code=400, detail="Cannot post unbalanced journal")
    je.is_posted = True
    je.posted_by = current_user.id
    je.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(je)
    return JournalPostResponse(id=je.id, entry_number=je.entry_number, is_posted=True)

