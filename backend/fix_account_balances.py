"""
Fix Account Balance Calculation
Recalculates all account balances from journal entries to fix discrepancies
"""
from decimal import Decimal
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import SessionLocal
from app.models import ChartOfAccount, JournalEntry, JournalEntryLine, AccountType

def recalculate_account_balance(db: Session, account: ChartOfAccount, company_id: int):
    """Recalculate account balance from journal entries"""
    # Get all posted journal entries for this account
    debit_total = db.query(func.sum(JournalEntryLine.amount)).filter(
        JournalEntryLine.debit_account_id == account.id,
        JournalEntryLine.journal_entry_id.in_(
            db.query(JournalEntry.id).filter(
                JournalEntry.company_id == company_id,
                JournalEntry.is_posted == True,
                JournalEntry.is_deleted == False
            )
        )
    ).scalar() or Decimal("0.00")
    
    credit_total = db.query(func.sum(JournalEntryLine.amount)).filter(
        JournalEntryLine.credit_account_id == account.id,
        JournalEntryLine.journal_entry_id.in_(
            db.query(JournalEntry.id).filter(
                JournalEntry.company_id == company_id,
                JournalEntry.is_posted == True,
                JournalEntry.is_deleted == False
            )
        )
    ).scalar() or Decimal("0.00")
    
    # Calculate balance based on account type
    # ASSET, EXPENSE, COGS: Debit increases, Credit decreases
    # LIABILITY, EQUITY, INCOME: Credit increases, Debit decreases
    if account.account_type in [AccountType.ASSET, AccountType.EXPENSE, AccountType.COST_OF_GOODS_SOLD]:
        calculated_balance = account.opening_balance + debit_total - credit_total
    else:  # LIABILITY, EQUITY, INCOME
        calculated_balance = account.opening_balance + credit_total - debit_total
    
    return calculated_balance, debit_total, credit_total

def fix_all_account_balances(company_id: int = None):
    """Fix all account balances for a company"""
    db = SessionLocal()
    
    try:
        if company_id is None:
            # Get first company
            from app.models import Company
            company = db.query(Company).first()
            if not company:
                print("[ERROR] No company found")
                return
            company_id = company.id
            print(f"[OK] Using company: {company.name} (ID: {company_id})")
        
        # Get all active accounts
        accounts = db.query(ChartOfAccount).filter(
            ChartOfAccount.company_id == company_id,
            ChartOfAccount.is_active == True
        ).all()
        
        print(f"\n[OK] Recalculating balances for {len(accounts)} accounts...")
        
        fixed_count = 0
        issues = []
        
        for account in accounts:
            calculated_balance, debit_total, credit_total = recalculate_account_balance(db, account, company_id)
            
            if abs(account.current_balance - calculated_balance) > Decimal("0.01"):
                old_balance = account.current_balance
                account.current_balance = calculated_balance
                fixed_count += 1
                
                issues.append({
                    "account": account.account_name,
                    "old": old_balance,
                    "new": calculated_balance,
                    "difference": abs(old_balance - calculated_balance),
                    "debits": debit_total,
                    "credits": credit_total
                })
        
        if fixed_count > 0:
            db.commit()
            print(f"\n[OK] Fixed {fixed_count} account balance(s)")
            print("\nFixed Accounts:")
            for issue in issues[:10]:  # Show first 10
                print(f"  - {issue['account']}: ${issue['old']:.2f} -> ${issue['new']:.2f} (diff: ${issue['difference']:.2f})")
        else:
            print("\n[OK] All account balances are already correct")
        
        return fixed_count, issues
        
    except Exception as e:
        db.rollback()
        print(f"\n[ERROR] {str(e)}")
        import traceback
        traceback.print_exc()
        return 0, []
    finally:
        db.close()

if __name__ == "__main__":
    print("="*60)
    print("FIX ACCOUNT BALANCES")
    print("="*60)
    fix_all_account_balances()

