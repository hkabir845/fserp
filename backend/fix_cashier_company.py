"""
Fix Cashier Company Assignment
Assigns cashier users to Company ID 1 (sample data company) if they don't have a company_id
"""
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import User, Company

def fix_cashier_company():
    """Assign cashier users to Company ID 1 if they don't have a company_id"""
    
    print("\n" + "="*80)
    print("FIXING CASHIER COMPANY ASSIGNMENT")
    print("="*80 + "\n")
    
    db = SessionLocal()
    
    try:
        # Check if Company ID 1 exists
        company = db.query(Company).filter(Company.id == 1).first()
        if not company:
            print("ERROR: Company ID 1 does not exist!")
            print("Please run: python init_database.py to create sample data")
            return
        
        print(f"Target Company: {company.name} (ID: 1)\n")
        
        # Find all cashier users without company_id
        cashiers = db.query(User).filter(
            User.role == "cashier",
            User.company_id.is_(None),
            User.is_deleted == False
        ).all()
        
        if not cashiers:
            print("No cashier users found without company_id assignment.")
            print("All cashiers are already assigned to companies.")
            return
        
        print(f"Found {len(cashiers)} cashier(s) without company_id:")
        for cashier in cashiers:
            print(f"  - {cashier.username} (ID: {cashier.id})")
        
        print(f"\nAssigning to Company ID 1 ({company.name})...")
        
        # Assign all cashiers to Company ID 1
        for cashier in cashiers:
            cashier.company_id = 1
            print(f"  [OK] Assigned {cashier.username} to Company ID 1")
        
        db.commit()
        
        print(f"\n[SUCCESS] Assigned {len(cashiers)} cashier(s) to Company ID 1")
        print("\nCashier users can now access the cashier page with sample data.")
        print("\nLogin credentials:")
        print("  - cashier1 / cash123")
        print("  - cashier2 / cash123")
        
    except Exception as e:
        print(f"\nERROR: {str(e)}")
        db.rollback()
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    fix_cashier_company()












