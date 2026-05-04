"""
Quick script to check if Chart of Accounts exist in the database
"""
from app.database import SessionLocal
from app.models.chart_of_accounts import ChartOfAccount
from app.models.user import User

def check_accounts():
    """Check if accounts exist for companies"""
    db = SessionLocal()
    try:
        # Get all companies
        from app.models.company import Company
        companies = db.query(Company).all()
        
        print("="*60)
        print("Chart of Accounts Check")
        print("="*60)
        
        if not companies:
            print("\n[ERROR] No companies found in database!")
            print("   Run init_database.py to create sample data")
            return
        
        for company in companies:
            print(f"\n[INFO] Company: {company.name} (ID: {company.id})")
            
            # Count accounts
            account_count = db.query(ChartOfAccount).filter(
                ChartOfAccount.company_id == company.id,
                ChartOfAccount.is_deleted == False
            ).count()
            
            if account_count > 0:
                print(f"   [OK] Found {account_count} accounts")
                
                # Show sample accounts
                accounts = db.query(ChartOfAccount).filter(
                    ChartOfAccount.company_id == company.id,
                    ChartOfAccount.is_deleted == False
                ).limit(5).all()
                
                print("   Sample accounts:")
                for acc in accounts:
                    print(f"      - {acc.account_code}: {acc.account_name} ({acc.account_type.value})")
                
                if account_count > 5:
                    print(f"      ... and {account_count - 5} more")
            else:
                print(f"   [WARNING] No accounts found for this company")
                print(f"   [TIP] Run init_database.py to create sample accounts")
            
            # Check users
            users = db.query(User).filter(User.company_id == company.id).all()
            print(f"   Users: {len(users)}")
            for user in users:
                print(f"      - {user.username} ({user.role.value})")
        
        print("\n" + "="*60)
        
    except Exception as e:
        print(f"\n[ERROR] Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    check_accounts()










