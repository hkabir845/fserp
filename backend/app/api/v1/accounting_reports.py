from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from typing import List, Optional
from datetime import datetime
from decimal import Decimal
from app.core.dependencies import get_db, get_current_user, require_tenant_id
from app.modules.accounting.models import Account, JournalEntry, JournalLine
from app.modules.tenancy.models import User
from pydantic import BaseModel
router = APIRouter()

class JournalLineOut(BaseModel):
    account_code: str
    account_name: str
    debit: float
    credit: float
    memo: Optional[str] = None


class JournalEntryOut(BaseModel):
    id: int
    entry_number: str
    date: datetime
    memo: Optional[str] = None
    ref_type: Optional[str] = None
    ref_id: Optional[int] = None
    is_posted: bool
    lines: List[JournalLineOut]

class JournalSummaryOut(BaseModel):
    total_entries: int
    posted_entries: int
    draft_entries: int
    unbalanced_entries: int


@router.get("/journal-entries", response_model=List[JournalEntryOut])
async def list_journal_entries(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    skip: int = 0,
    limit: int = 100,
    posted_only: bool = False,
):
    q = db.query(JournalEntry).filter(JournalEntry.tenant_id == tenant_id)
    if posted_only:
        q = q.filter(JournalEntry.is_posted == True)
    entries = (
        q.order_by(JournalEntry.date.desc(), JournalEntry.id.desc())
        .offset(skip)
        .limit(min(limit, 500))
        .options(joinedload(JournalEntry.lines).joinedload(JournalLine.account))
        .all()
    )
    out: List[JournalEntryOut] = []
    for je in entries:
        lines_out: List[JournalLineOut] = []
        for ln in je.lines:
            ac = ln.account
            lines_out.append(
                JournalLineOut(
                    account_code=ac.code if ac else "?",
                    account_name=ac.name if ac else "",
                    debit=float(ln.debit or 0),
                    credit=float(ln.credit or 0),
                    memo=ln.memo,
                )
            )
        out.append(
            JournalEntryOut(
                id=je.id,
                entry_number=je.entry_number,
                date=je.date,
                memo=je.memo,
                ref_type=je.ref_type,
                ref_id=je.ref_id,
                is_posted=bool(je.is_posted),
                lines=lines_out,
            )
        )
    return out


@router.get("/journal-entries/summary", response_model=JournalSummaryOut)
async def journal_entries_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    entries = (
        db.query(JournalEntry)
        .filter(JournalEntry.tenant_id == tenant_id)
        .options(joinedload(JournalEntry.lines))
        .all()
    )
    posted = 0
    drafts = 0
    unbalanced = 0
    for je in entries:
        if je.is_posted:
            posted += 1
        else:
            drafts += 1
        debit = sum((ln.debit or Decimal("0")) for ln in je.lines)
        credit = sum((ln.credit or Decimal("0")) for ln in je.lines)
        if (debit - credit).copy_abs() > Decimal("0.01"):
            unbalanced += 1
    return JournalSummaryOut(
        total_entries=len(entries),
        posted_entries=posted,
        draft_entries=drafts,
        unbalanced_entries=unbalanced,
    )


class TrialBalanceLine(BaseModel):
    account_code: str
    account_name: str
    debit: float
    credit: float
    balance: float

class TrialBalanceResponse(BaseModel):
    as_on_date: str
    lines: List[TrialBalanceLine]
    total_debit: float
    total_credit: float

@router.get("/trial-balance", response_model=TrialBalanceResponse)
async def get_trial_balance(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    as_on_date: Optional[str] = None,
):
    """Get trial balance as on a specific date"""
    
    # Parse date or use today
    if as_on_date:
        try:
            cutoff_date = datetime.fromisoformat(as_on_date.replace('Z', '+00:00'))
        except:
            cutoff_date = datetime.utcnow()
    else:
        cutoff_date = datetime.utcnow()
    
    # Get all active accounts
    accounts = db.query(Account).filter(
        Account.tenant_id == tenant_id,
        Account.is_active == True
    ).all()
    
    lines = []
    total_debit = Decimal("0")
    total_credit = Decimal("0")
    
    for account in accounts:
        # Get sum of debits and credits for this account up to cutoff date
        debit_sum = db.query(func.sum(JournalLine.debit)).join(JournalEntry).filter(
            JournalLine.tenant_id == tenant_id,
            JournalLine.account_id == account.id,
            JournalEntry.date <= cutoff_date,
            JournalEntry.is_posted == True
        ).scalar() or Decimal("0")
        
        credit_sum = db.query(func.sum(JournalLine.credit)).join(JournalEntry).filter(
            JournalLine.tenant_id == tenant_id,
            JournalLine.account_id == account.id,
            JournalEntry.date <= cutoff_date,
            JournalEntry.is_posted == True
        ).scalar() or Decimal("0")
        
        balance = debit_sum - credit_sum
        
        # Only include accounts with transactions
        if debit_sum > 0 or credit_sum > 0:
            lines.append({
                "account_code": account.code,
                "account_name": account.name,
                "debit": float(debit_sum),
                "credit": float(credit_sum),
                "balance": float(balance)
            })
            total_debit += debit_sum
            total_credit += credit_sum
    
    return {
        "as_on_date": cutoff_date.isoformat(),
        "lines": lines,
        "total_debit": float(total_debit),
        "total_credit": float(total_credit)
    }

class AccountBalance(BaseModel):
    account_code: str
    account_name: str
    account_type: str
    balance: float

class BalanceSheetResponse(BaseModel):
    as_on_date: str
    assets: List[AccountBalance]
    liabilities: List[AccountBalance]
    equity: List[AccountBalance]
    total_assets: float
    total_liabilities: float
    total_equity: float

@router.get("/balance-sheet", response_model=BalanceSheetResponse)
async def get_balance_sheet(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    as_on_date: Optional[str] = None,
):
    """Get balance sheet as on a specific date"""
    
    # Parse date or use today
    if as_on_date:
        try:
            cutoff_date = datetime.fromisoformat(as_on_date.replace('Z', '+00:00'))
        except:
            cutoff_date = datetime.utcnow()
    else:
        cutoff_date = datetime.utcnow()
    
    def get_account_balance(account_id: int) -> Decimal:
        debit_sum = db.query(func.sum(JournalLine.debit)).join(JournalEntry).filter(
            JournalLine.tenant_id == tenant_id,
            JournalLine.account_id == account_id,
            JournalEntry.date <= cutoff_date,
            JournalEntry.is_posted == True
        ).scalar() or Decimal("0")
        
        credit_sum = db.query(func.sum(JournalLine.credit)).join(JournalEntry).filter(
            JournalLine.tenant_id == tenant_id,
            JournalLine.account_id == account_id,
            JournalEntry.date <= cutoff_date,
            JournalEntry.is_posted == True
        ).scalar() or Decimal("0")
        
        return debit_sum - credit_sum
    
    # Get accounts by type
    assets = []
    liabilities = []
    equity = []
    
    accounts = db.query(Account).filter(
        Account.tenant_id == tenant_id,
        Account.is_active == True
    ).all()
    
    for account in accounts:
        balance = get_account_balance(account.id)
        
        if account.type == "asset":
            # Assets: Debit balance is positive
            if balance != 0:
                assets.append({
                    "account_code": account.code,
                    "account_name": account.name,
                    "account_type": account.type,
                    "balance": float(balance)
                })
        elif account.type == "liability":
            # Liabilities: Credit balance is positive (negative of balance)
            if balance != 0:
                liabilities.append({
                    "account_code": account.code,
                    "account_name": account.name,
                    "account_type": account.type,
                    "balance": float(-balance)  # Negate for liabilities
                })
        elif account.type == "equity":
            # Equity: Credit balance is positive
            if balance != 0:
                equity.append({
                    "account_code": account.code,
                    "account_name": account.name,
                    "account_type": account.type,
                    "balance": float(-balance)  # Negate for equity
                })
    
    total_assets = sum(a["balance"] for a in assets)
    total_liabilities = sum(l["balance"] for l in liabilities)
    total_equity = sum(e["balance"] for e in equity)
    
    return {
        "as_on_date": cutoff_date.isoformat(),
        "assets": assets,
        "liabilities": liabilities,
        "equity": equity,
        "total_assets": total_assets,
        "total_liabilities": total_liabilities,
        "total_equity": total_equity
    }

