"""
Accounting posting service - handles double-entry bookkeeping
"""
from decimal import Decimal
from typing import List, Dict, Optional
from sqlalchemy.orm import Session
from datetime import datetime
from app.modules.accounting.models import JournalEntry, JournalLine, Account
from app.core.exceptions import PostingError
from app.shared.enums import DocumentStatus

class PostingService:
    """Service for creating journal entries from business transactions"""
    
    @staticmethod
    def create_journal_entry(
        db: Session,
        tenant_id: int,
        date: datetime,
        memo: str,
        lines: List[Dict],
        ref_type: Optional[str] = None,
        ref_id: Optional[int] = None,
        posted_by: Optional[int] = None,
        entry_number: Optional[str] = None
    ) -> JournalEntry:
        """
        Create a journal entry with balanced lines
        
        lines format: [
            {"account_id": 1, "debit": 1000, "credit": 0, "memo": "..."},
            {"account_id": 2, "debit": 0, "credit": 1000, "memo": "..."}
        ]
        """
        # Validate balance
        total_debit = sum(Decimal(str(line["debit"])) for line in lines)
        total_credit = sum(Decimal(str(line["credit"])) for line in lines)
        
        if total_debit != total_credit:
            raise PostingError(f"Journal entry not balanced: Debit {total_debit} != Credit {total_credit}")
        
        # Generate entry number if not provided (microseconds avoid collisions in batch / rapid posts)
        if not entry_number:
            entry_number = f"JE-{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}"
        
        # Create journal entry
        journal = JournalEntry(
            tenant_id=tenant_id,
            entry_number=entry_number,
            date=date,
            memo=memo,
            ref_type=ref_type,
            ref_id=ref_id,
            posted_by=posted_by,
            is_posted=True,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db.add(journal)
        db.flush()
        
        # Create journal lines
        for line_data in lines:
            line = JournalLine(
                tenant_id=tenant_id,
                journal_id=journal.id,
                account_id=line_data["account_id"],
                debit=Decimal(str(line_data["debit"])),
                credit=Decimal(str(line_data["credit"])),
                memo=line_data.get("memo"),
                cost_center_id=line_data.get("cost_center_id"),
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            db.add(line)
        
        db.commit()
        db.refresh(journal)
        return journal
    
    @staticmethod
    def get_account_by_code(db: Session, tenant_id: int, code: str) -> Optional[Account]:
        """Get account by code for a tenant"""
        return db.query(Account).filter(
            Account.tenant_id == tenant_id,
            Account.code == code,
            Account.is_active == True
        ).first()
    
    @staticmethod
    def get_account_by_name(db: Session, tenant_id: int, name: str) -> Optional[Account]:
        """Get account by name for a tenant"""
        return db.query(Account).filter(
            Account.tenant_id == tenant_id,
            Account.name == name,
            Account.is_active == True
        ).first()

