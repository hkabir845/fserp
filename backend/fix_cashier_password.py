"""
Script to fix cashier1 password
Run this to reset cashier1 password to 'cash123'
"""
import sys
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models.user import User, UserRole
from app.utils.security import get_password_hash, verify_password

def fix_cashier_password(username: str = "cashier1", password: str = "cash123"):
    """Reset cashier password"""
    db: Session = SessionLocal()
    try:
        # Find the user
        user = db.query(User).filter(User.username == username).first()
        
        if not user:
            print(f"User '{username}' not found!")
            print("Creating new cashier1 user...")
            
            # Get first company
            from app.models.company import Company
            company = db.query(Company).first()
            if not company:
                print("ERROR: No company found. Please create a company first.")
                return None
            
            # Create new user
            user = User(
                username=username,
                email=f"{username}@mainfs.com",
                full_name="Cashier User",
                role=UserRole.CASHIER,
                hashed_password=get_password_hash(password),
                company_id=company.id,
                is_active=True,
                is_deleted=False
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            print(f"Created new user '{username}' with password '{password}'")
        else:
            print(f"Found user '{username}' (ID: {user.id})")
            print(f"Current role: {user.role.value}")
            print(f"Is active: {user.is_active}")
            
            # Test current password
            if user.hashed_password:
                try:
                    current_valid = verify_password(password, user.hashed_password)
                    if current_valid:
                        print(f"Password '{password}' is already correct!")
                        return user
                except Exception as e:
                    print(f"Error verifying current password: {e}")
            
            # Reset password
            user.hashed_password = get_password_hash(password)
            user.is_active = True
            user.is_deleted = False
            
            # Ensure user has a company
            if not user.company_id:
                from app.models.company import Company
                company = db.query(Company).first()
                if company:
                    user.company_id = company.id
                    print(f"Assigned user to company ID: {company.id}")
            
            db.commit()
            db.refresh(user)
            
            # Verify the new password
            test_valid = verify_password(password, user.hashed_password)
            if test_valid:
                print(f"✓ Password reset successful!")
                print(f"✓ Username: {user.username}")
                print(f"✓ Password: {password}")
                print(f"✓ Role: {user.role.value}")
                print(f"✓ Is Active: {user.is_active}")
                print(f"✓ Company ID: {user.company_id}")
            else:
                print("ERROR: Password verification failed after reset!")
                return None
        
        return user
        
    except Exception as e:
        db.rollback()
        print(f"Error fixing cashier password: {e}")
        import traceback
        traceback.print_exc()
        return None
    finally:
        db.close()


if __name__ == "__main__":
    print("=" * 60)
    print("Fixing cashier1 password")
    print("=" * 60)
    
    # Fix cashier1
    user1 = fix_cashier_password("cashier1", "cash123")
    
    # Also fix cashier2 if it exists
    user2 = fix_cashier_password("cashier2", "cash123")
    
    print("=" * 60)
    print("Done!")
    print("=" * 60)
    print("\nLogin credentials:")
    print("  Username: cashier1")
    print("  Password: cash123")
    print("=" * 60)

