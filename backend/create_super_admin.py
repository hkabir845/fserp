"""
Script to create a Super Admin user
Run this script to create a super admin account that can manage all companies and users
"""
import sys
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models.user import User, UserRole
from app.utils.security import get_password_hash

def create_super_admin(username: str = "superadmin@admin.com", email: str = "superadmin@admin.com", password: str = "Admin@123", full_name: str = "Super Administrator"):
    """Create a super admin user"""
    db: Session = SessionLocal()
    try:
        # Check if super admin already exists
        existing = db.query(User).filter(
            (User.username == username) | (User.email == email),
            User.role == UserRole.SUPER_ADMIN
        ).first()
        
        if existing:
            print(f"Super Admin user '{username}' already exists!")
            print(f"User ID: {existing.id}")
            print(f"Email: {existing.email}")
            print(f"Role: {existing.role.value}")
            return existing
        
        # Check if username or email exists with different role
        existing_user = db.query(User).filter(
            (User.username == username) | (User.email == email)
        ).first()
        
        if existing_user:
            print(f"User '{username}' already exists with role '{existing_user.role.value}'")
            response = input(f"Do you want to upgrade this user to SUPER_ADMIN? (yes/no): ")
            if response.lower() == 'yes':
                existing_user.role = UserRole.SUPER_ADMIN
                existing_user.hashed_password = get_password_hash(password)
                existing_user.is_active = True
                db.commit()
                db.refresh(existing_user)
                print(f"User '{username}' upgraded to SUPER_ADMIN!")
                return existing_user
            else:
                print("Operation cancelled.")
                return None
        
        # Create new super admin user
        hashed_password = get_password_hash(password)
        
        super_admin = User(
            username=username,
            email=email,
            full_name=full_name,
            role=UserRole.SUPER_ADMIN,
            hashed_password=hashed_password,
            company_id=None,  # Super admin doesn't belong to any company
            is_active=True,
            is_deleted=False
        )
        
        db.add(super_admin)
        db.commit()
        db.refresh(super_admin)
        
        print("=" * 60)
        print("Super Admin Created Successfully!")
        print("=" * 60)
        print(f"Username: {super_admin.username}")
        print(f"Email: {super_admin.email}")
        print(f"Full Name: {super_admin.full_name}")
        print(f"Role: {super_admin.role.value}")
        print(f"User ID: {super_admin.id}")
        print("=" * 60)
        print("\nIMPORTANT: Please change the password after first login!")
        print("=" * 60)
        
        return super_admin
        
    except Exception as e:
        db.rollback()
        print(f"Error creating super admin: {e}")
        import traceback
        traceback.print_exc()
        return None
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        # Allow command-line arguments
        username = sys.argv[1] if len(sys.argv) > 1 else "superadmin@admin.com"
        email = sys.argv[2] if len(sys.argv) > 2 else "superadmin@admin.com"
        password = sys.argv[3] if len(sys.argv) > 3 else "Admin@123"
        full_name = sys.argv[4] if len(sys.argv) > 4 else "Super Administrator"
    else:
        # Interactive mode
        print("=" * 60)
        print("Create Super Admin User")
        print("=" * 60)
        username = input("Username (default: superadmin@admin.com): ").strip() or "superadmin@admin.com"
        email = input("Email (default: superadmin@admin.com): ").strip() or "superadmin@admin.com"
        password = input("Password (default: Admin@123): ").strip() or "Admin@123"
        full_name = input(f"Full Name (default: Super Administrator): ").strip() or "Super Administrator"
    
    create_super_admin(username, email, password, full_name)

