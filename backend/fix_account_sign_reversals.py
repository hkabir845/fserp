"""
Fix Account Balance Sign Reversals
Fixes accounts where stored balance is opposite of calculated balance
"""
from decimal import Decimal
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import SessionLocal
from app.models import ChartOfAccount, JournalEntry, JournalEntryLine, AccountType, Company

def fix_account_sign_reversals(company_id: int = None):
    """Fix account balance sign reversals"""
    db = SessionLocal()
    
    try:
        if company_id is None:
            company = db.query(Company).first()
            if not company:
                print("[ERROR] No company found")
                return
            company_id = company.id
            print(f"[OK] Using company: {company.name} (ID: {company_id})")
        
        accounts = db.query(ChartOfAccount).filter(
            ChartOfAccount.company_id == company_id,
            ChartOfAccount.is_active == True
        ).all()
        
        print(f"\n[OK] Checking {len(accounts)} accounts for sign reversals...")
        
        fixed_count = 0
        
        for account in accounts:
            # Calculate from journal entries
            debit_total = db.query(func.sum(JournalEntryLine.amount)).filter(
                JournalEntryLine.debit_account_id == account.id,
                JournalEntryLine.journal_entry_id.in_(
                    db.query(JournalEntry.id).filter(
                        JournalEntry.company_id == company_id,
                        JournalEntry.is_posted == True
                    )
                )
            ).scalar() or Decimal("0.00")
            
            credit_total = db.query(func.sum(JournalEntryLine.amount)).filter(
                JournalEntryLine.credit_account_id == account.id,
                JournalEntryLine.journal_entry_id.in_(
                    db.query(JournalEntry.id).filter(
                        JournalEntry.company_id == company_id,
                        JournalEntry.is_posted == True
                    )
                )
            ).scalar() or Decimal("0.00")
            
            # Calculate expected balance
            if account.account_type in [AccountType.ASSET, AccountType.EXPENSE, AccountType.COST_OF_GOODS_SOLD]:
                expected_balance = account.opening_balance + debit_total - credit_total
            else:
                expected_balance = account.opening_balance + credit_total - debit_total
            
            # Check if it's a sign reversal (stored = -calculated)
            if abs(account.current_balance + expected_balance) < Decimal("0.01") and abs(account.current_balance) > Decimal("0.01"):
                old_balance = account.current_balance
                account.current_balance = expected_balance
                fixed_count += 1
                print(f"  [FIX] {account.account_name}: ${old_balance:.2f} -> ${expected_balance:.2f}")
        
        if fixed_count > 0:
            db.commit()
            print(f"\n[SUCCESS] Fixed {fixed_count} account balance(s)")
        else:
            print("\n[OK] No sign reversals found")
        
    except Exception as e:
        db.rollback()
        print(f"\n[ERROR] {str(e)}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    print("="*60)
    print("FIX ACCOUNT BALANCE SIGN REVERSALS")
    print("="*60)
    fix_account_sign_reversals()

