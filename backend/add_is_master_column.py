"""
Migration Script: Add is_master column to company table
This script adds the is_master field to mark the master company for development/upgrades
"""
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from app.config import settings
from app.database import SessionLocal
from app.models.company import Company

def add_is_master_column():
    """Add is_master column to company table if it doesn't exist"""
    print("="*80)
    print("Migration: Adding is_master column to company table")
    print("="*80)
    
    db = SessionLocal()
    try:
        # Check if column exists
        inspector = inspect(db.bind)
        company_columns = {col['name'] for col in inspector.get_columns('company')}
        
        if 'is_master' in company_columns:
            print("\n[OK] Column 'is_master' already exists. Skipping migration.")
            return True
        
        print("\nAdding 'is_master' column to company table...")
        
        # Add column using raw SQL
        if 'sqlite' in settings.DATABASE_URL.lower():
            # SQLite syntax
            db.execute(text("ALTER TABLE company ADD COLUMN is_master VARCHAR(10) DEFAULT 'false' NOT NULL"))
        else:
            # PostgreSQL syntax
            db.execute(text("ALTER TABLE company ADD COLUMN is_master VARCHAR(10) DEFAULT 'false' NOT NULL"))
        
        db.commit()
        print("[OK] Column 'is_master' added successfully!")
        
        # Update existing rows to have is_master = 'false'
        db.execute(text("UPDATE company SET is_master = 'false' WHERE is_master IS NULL"))
        db.commit()
        print("[OK] Set default value 'false' for all existing companies")
        
        return True
        
    except Exception as e:
        db.rollback()
        print(f"\n[X] Error adding column: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        db.close()


def create_master_company():
    """Create a master company if one doesn't exist"""
    print("\n" + "="*80)
    print("Creating Master Company")
    print("="*80)
    
    db = SessionLocal()
    try:
        # Check if master company already exists
        existing_master = db.query(Company).filter(Company.is_master == "true").first()
        
        if existing_master:
            print(f"\n[OK] Master Company already exists: '{existing_master.name}' (ID: {existing_master.id})")
            return existing_master
        
        print("\nCreating new Master Company...")
        
        from app.utils.security import get_password_hash
        
        # Create master company
        master_company = Company(
            name="Master Company",
            legal_name="Master Company - Development & Upgrades",
            email="master@system.local",
            subdomain="master",
            currency="BDT",
            is_master="true",
            is_active=True,
            description="Master company for developing and testing upgrades. Updates can be pushed to all companies."
        )
        
        db.add(master_company)
        db.commit()
        db.refresh(master_company)
        
        print(f"[OK] Master Company created successfully!")
        print(f"   ID: {master_company.id}")
        print(f"   Name: {master_company.name}")
        print(f"   Subdomain: {master_company.subdomain}")
        print(f"   is_master: {master_company.is_master}")
        
        return master_company
        
    except Exception as e:
        db.rollback()
        print(f"\n[X] Error creating master company: {e}")
        import traceback
        traceback.print_exc()
        return None
    finally:
        db.close()


if __name__ == "__main__":
    print("\nStarting migration...")
    
    # Step 1: Add column
    if add_is_master_column():
        print("\n[OK] Migration step 1 completed!")
    else:
        print("\n[X] Migration step 1 failed!")
        sys.exit(1)
    
    # Step 2: Create master company
    master_company = create_master_company()
    if master_company:
        print("\n[OK] Migration step 2 completed!")
    else:
        print("\n[!] Master company creation failed or already exists")
    
    print("\n" + "="*80)
    print("[OK] Migration completed successfully!")
    print("="*80 + "\n")

