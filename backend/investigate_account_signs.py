"""
Investigate Account Balance Sign Issues
Analyzes why some accounts show sign reversals
"""
from decimal import Decimal
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import SessionLocal
from app.models import ChartOfAccount, JournalEntry, JournalEntryLine, AccountType, Company

def investigate_account_signs(company_id: int = None):
    """Investigate account balance sign issues"""
    db = SessionLocal()
    
    try:
        if company_id is None:
            company = db.query(Company).first()
            if not company:
                print("[ERROR] No company found")
                return
            company_id = company.id
            print(f"[OK] Using company: {company.name} (ID: {company_id})")
        
        # Get accounts with sign issues
        accounts = db.query(ChartOfAccount).filter(
            ChartOfAccount.company_id == company_id,
            ChartOfAccount.is_active == True
        ).all()
        
        print(f"\n[OK] Analyzing {len(accounts)} accounts...")
        
        issues = []
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
            
            if abs(account.current_balance - expected_balance) > Decimal("0.01"):
                # Check if it's a sign reversal
                if abs(account.current_balance + expected_balance) < Decimal("0.01"):
                    issues.append({
                        "account": account.account_name,
                        "type": account.account_type.value,
                        "stored": account.current_balance,
                        "calculated": expected_balance,
                        "opening": account.opening_balance,
                        "debits": debit_total,
                        "credits": credit_total,
                        "issue": "SIGN_REVERSAL"
                    })
                else:
                    issues.append({
                        "account": account.account_name,
                        "type": account.account_type.value,
                        "stored": account.current_balance,
                        "calculated": expected_balance,
                        "opening": account.opening_balance,
                        "debits": debit_total,
                        "credits": credit_total,
                        "issue": "OTHER"
                    })
        
        if issues:
            print(f"\n[OK] Found {len(issues)} account(s) with issues:")
            print("\nSign Reversals:")
            sign_reversals = [i for i in issues if i["issue"] == "SIGN_REVERSAL"]
            for issue in sign_reversals[:10]:
                print(f"  - {issue['account']} ({issue['type']}):")
                print(f"      Stored: ${issue['stored']:.2f}")
                print(f"      Calculated: ${issue['calculated']:.2f}")
                print(f"      Opening: ${issue['opening']:.2f}")
                print(f"      Debits: ${issue['debits']:.2f}, Credits: ${issue['credits']:.2f}")
                print(f"      Fix: Multiply stored by -1")
            
            print("\nOther Issues:")
            other_issues = [i for i in issues if i["issue"] != "SIGN_REVERSAL"]
            for issue in other_issues[:5]:
                print(f"  - {issue['account']} ({issue['type']}):")
                print(f"      Stored: ${issue['stored']:.2f}, Calculated: ${issue['calculated']:.2f}")
        else:
            print("\n[OK] No account balance issues found")
        
    except Exception as e:
        print(f"\n[ERROR] {str(e)}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    print("="*60)
    print("INVESTIGATE ACCOUNT BALANCE SIGN ISSUES")
    print("="*60)
    investigate_account_signs()

