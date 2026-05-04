"""
Add Missing Column to Journal Entry Table
This script adds the is_posted column if it's missing
"""
from sqlalchemy import text, inspect
from app.database import engine, SessionLocal

def add_missing_column():
    """Add is_posted column to journal_entry table if it doesn't exist"""
    
    print("\n" + "="*80)
    print("ADDING MISSING COLUMN TO JOURNAL_ENTRY TABLE")
    print("="*80 + "\n")
    
    db = SessionLocal()
    
    try:
        # Check if column exists
        inspector = inspect(engine)
        columns = [col['name'] for col in inspector.get_columns('journal_entry')]
        
        print(f"Current columns in journal_entry table: {columns}\n")
        
        added_columns = []
        
        # Add is_posted column if missing
        if 'is_posted' not in columns:
            print("Adding 'is_posted' column...")
            db.execute(text("ALTER TABLE journal_entry ADD COLUMN is_posted BOOLEAN DEFAULT 0 NOT NULL"))
            added_columns.append('is_posted')
        else:
            print("[OK] Column 'is_posted' already exists")
        
        # Add created_by column if missing
        if 'created_by' not in columns:
            print("Adding 'created_by' column...")
            db.execute(text("ALTER TABLE journal_entry ADD COLUMN created_by INTEGER"))
            added_columns.append('created_by')
        else:
            print("[OK] Column 'created_by' already exists")
        
        if added_columns:
            db.commit()
            print(f"[OK] Added columns: {', '.join(added_columns)}\n")
        else:
            print("[OK] All columns already exist!\n")
        
        # Verify
        inspector = inspect(engine)
        columns = [col['name'] for col in inspector.get_columns('journal_entry')]
        print(f"Current columns: {columns}\n")
        
        print("="*80)
        print("SUCCESS!")
        print("="*80 + "\n")
        
    except Exception as e:
        print(f"\nERROR: {str(e)}")
        db.rollback()
        import traceback
        traceback.print_exc()
        print("\nIf this fails, you may need to recreate the database.")
        print("Run: python fix_database_schema.py")
    finally:
        db.close()

if __name__ == "__main__":
    add_missing_column()

