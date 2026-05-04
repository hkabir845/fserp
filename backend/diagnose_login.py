"""
Diagnostic script to check login issues
This script will help identify why login is failing
"""
import sys
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database import SessionLocal
from app.models.user import User, UserRole
from app.utils.security import verify_password, get_password_hash

def diagnose_login(username: str = "superadmin@admin.com", password: str = "Admin@123"):
    """Diagnose login issues"""
    db: Session = SessionLocal()
    try:
        print("=" * 70)
        print("LOGIN DIAGNOSTIC TOOL")
        print("=" * 70)
        print(f"\nChecking for username: '{username}'")
        print(f"Testing password: '{password}'")
        print("\n" + "-" * 70)
        
        # 1. Check if user exists (case-insensitive)
        username_lower = username.strip().lower()
        print(f"\n1. Searching for user (case-insensitive): '{username_lower}'")
        
        user = db.query(User).filter(
            func.lower(User.username) == username_lower,
            User.is_deleted == False
        ).first()
        
        if not user:
            print(f"   [X] USER NOT FOUND!")
            print(f"   Searching in database...")
            
            # List all users
            all_users = db.query(User).filter(User.is_deleted == False).all()
            print(f"\n   Found {len(all_users)} active users in database:")
            for u in all_users:
                print(f"   - Username: '{u.username}' (ID: {u.id}, Role: {u.role.value}, Active: {u.is_active})")
            
            # Check for similar usernames
            similar = db.query(User).filter(
                User.username.ilike(f"%{username}%"),
                User.is_deleted == False
            ).all()
            if similar:
                print(f"\n   Similar usernames found:")
                for u in similar:
                    print(f"   - '{u.username}' (ID: {u.id})")
            
            print("\n   SOLUTION: Create the superadmin user:")
            print("   python create_super_admin.py")
            return False
        
        print(f"   [OK] USER FOUND!")
        print(f"   - ID: {user.id}")
        print(f"   - Username: '{user.username}'")
        print(f"   - Email: '{user.email}'")
        print(f"   - Role: {user.role.value}")
        print(f"   - Active: {user.is_active}")
        print(f"   - Deleted: {user.is_deleted}")
        print(f"   - Company ID: {user.company_id}")
        
        # 2. Check if user is active
        print(f"\n2. Checking if user is active...")
        if not user.is_active:
            print(f"   [X] USER IS INACTIVE!")
            print(f"   SOLUTION: Activate the user in the database")
            return False
        print(f"   [OK] User is active")
        
        # 3. Check password hash
        print(f"\n3. Checking password hash...")
        print(f"   Hash stored: {user.hashed_password[:50]}...")
        print(f"   Hash type: {type(user.hashed_password)}")
        print(f"   Hash length: {len(user.hashed_password)}")
        
        # 4. Test password verification
        print(f"\n4. Testing password verification...")
        try:
            password_valid = verify_password(password, user.hashed_password)
            print(f"   Verification result: {password_valid}")
            
            if not password_valid:
                print(f"   [X] PASSWORD VERIFICATION FAILED!")
                print(f"\n   Testing with new hash generation...")
                
                # Test if we can create a new hash and verify it
                test_hash = get_password_hash(password)
                test_verify = verify_password(password, test_hash)
                print(f"   New hash test: {test_verify}")
                
                if test_verify:
                    print(f"   SOLUTION: The stored hash might be corrupted.")
                    print(f"   Reset the password using:")
                    print(f"   python reset_user_password.py {user.username} {password}")
                else:
                    print(f"   [X] CRITICAL: Password hashing/verification is broken!")
                    return False
            else:
                print(f"   [OK] PASSWORD VERIFICATION SUCCESSFUL!")
        except Exception as e:
            print(f"   [X] ERROR during password verification: {e}")
            import traceback
            traceback.print_exc()
            return False
        
        # 5. Summary
        print("\n" + "=" * 70)
        if password_valid and user.is_active:
            print("[OK] ALL CHECKS PASSED - Login should work!")
            print("\nIf login still fails, check:")
            print("1. Backend is running with latest code")
            print("2. Frontend is sending correct credentials")
            print("3. CORS is properly configured")
            print("4. Check backend console logs for detailed error messages")
        else:
            print("[X] ISSUES FOUND - See details above")
        print("=" * 70)
        
        return password_valid and user.is_active
        
    except Exception as e:
        print(f"\n[X] ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        db.close()


if __name__ == "__main__":
    username = sys.argv[1] if len(sys.argv) > 1 else "superadmin@admin.com"
    password = sys.argv[2] if len(sys.argv) > 2 else "Admin@123"
    
    diagnose_login(username, password)

