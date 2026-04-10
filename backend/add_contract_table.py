"""
Migration Script: Create contract table
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import create_engine, inspect, text
from app.config import settings
from app.database import SessionLocal, Base
from app.models.contract import Contract

def create_contract_table():
    """Create contract table if it doesn't exist"""
    print("="*80)
    print("Migration: Creating contract table")
    print("="*80)
    
    db = SessionLocal()
    try:
        inspector = inspect(db.bind)
        table_names = inspector.get_table_names()
        
        if 'contract' in table_names:
            print("\n[OK] Contract table already exists. Skipping migration.")
            return True
        
        print("\nCreating contract table...")
        
        # Create table using SQLAlchemy
        Contract.__table__.create(bind=db.bind, checkfirst=True)
        
        db.commit()
        print("[OK] Contract table created successfully!")
        
        return True
        
    except Exception as e:
        db.rollback()
        print(f"\n[X] Error creating contract table: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        db.close()

if __name__ == "__main__":
    print("\nStarting migration...")
    
    if create_contract_table():
        print("\n" + "="*80)
        print("[OK] Migration completed successfully!")
        print("="*80 + "\n")
    else:
        print("\n[X] Migration failed!")
        sys.exit(1)

