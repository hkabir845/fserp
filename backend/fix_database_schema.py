"""
Fix Database Schema - Add missing columns or recreate tables
"""
import os
from sqlalchemy import text, inspect
from app.database import engine, SessionLocal
from app.models.base import Base
from app.models import *  # Import all models

def fix_database():
    """Fix database schema by adding missing columns or recreating tables"""
    
    print("\n" + "="*80)
    print("FIXING DATABASE SCHEMA")
    print("="*80 + "\n")
    
    db_path = "filling_station_erp.db"
    
    # Check if database exists
    if os.path.exists(db_path):
        print(f"Database file found: {db_path}")
        response = input("\nThis will recreate the database and delete all existing data.\nDo you want to continue? (yes/no): ")
        if response.lower() != 'yes':
            print("Cancelled.")
            return
        
        # Close all connections
        engine.dispose()
        
        # Delete database file
        print(f"\nDeleting old database file...")
        os.remove(db_path)
        print("[OK] Database file deleted")
    
    # Recreate all tables
    print("\nCreating database tables...")
    Base.metadata.create_all(bind=engine)
    print("[OK] All tables created successfully!\n")
    
    print("="*80)
    print("DATABASE SCHEMA FIXED!")
    print("="*80)
    print("\nNext steps:")
    print("1. Run: python init_comprehensive_data.py")
    print("2. Or run: python add_sample_journal_entries.py (if data already exists)")
    print("="*80 + "\n")

if __name__ == "__main__":
    fix_database()



