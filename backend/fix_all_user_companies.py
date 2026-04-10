"""
Fix All User Company Assignments
Assigns all users without company_id to Company ID 1 (except superadmins)
"""
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import User, Company, UserRole

def fix_all_user_companies():
    """Assign users to Company ID 1 if they don't have a company_id"""
    
    print("\n" + "="*80)
    print("FIXING ALL USER COMPANY ASSIGNMENTS")
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
        
        # Find all users without company_id (excluding superadmins - they don't need company_id)
        users = db.query(User).filter(
            User.company_id.is_(None),
            User.role != UserRole.SUPER_ADMIN,
            User.is_deleted == False
        ).all()
        
        if not users:
            print("No users found without company_id assignment (excluding superadmins).")
            print("Superadmins don't need company_id - this is normal.")
            return
        
        print(f"Found {len(users)} user(s) without company_id:")
        for user in users:
            print(f"  - {user.username} ({user.role.value}, ID: {user.id})")
        
        print(f"\nAssigning to Company ID 1 ({company.name})...")
        
        # Assign all users to Company ID 1
        for user in users:
            user.company_id = 1
            print(f"  [OK] Assigned {user.username} to Company ID 1")
        
        db.commit()
        
        print(f"\n[SUCCESS] Assigned {len(users)} user(s) to Company ID 1")
        print("\nAll users can now access their company's data.")
        
    except Exception as e:
        print(f"\nERROR: {str(e)}")
        db.rollback()
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    fix_all_user_companies()












