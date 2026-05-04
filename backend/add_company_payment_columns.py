"""
Add Missing Payment Columns to Company Table
This script adds contact_person, payment_type, payment_start_date, payment_end_date, payment_amount columns
"""
from sqlalchemy import text, inspect
from app.database import engine, SessionLocal

def add_company_payment_columns():
    """Add payment-related columns to company table if they don't exist"""
    
    print("\n" + "="*80)
    print("ADDING MISSING PAYMENT COLUMNS TO COMPANY TABLE")
    print("="*80 + "\n")
    
    db = SessionLocal()
    
    try:
        # Check if columns exist
        inspector = inspect(engine)
        columns = [col['name'] for col in inspector.get_columns('company')]
        
        print(f"Current columns in company table: {len(columns)} columns\n")
        
        added_columns = []
        
        # Add contact_person column if missing
        if 'contact_person' not in columns:
            print("Adding 'contact_person' column...")
            db.execute(text("ALTER TABLE company ADD COLUMN contact_person VARCHAR(200)"))
            added_columns.append('contact_person')
        else:
            print("[OK] Column 'contact_person' already exists")
        
        # Add payment_type column if missing
        if 'payment_type' not in columns:
            print("Adding 'payment_type' column...")
            db.execute(text("ALTER TABLE company ADD COLUMN payment_type VARCHAR(50)"))
            added_columns.append('payment_type')
        else:
            print("[OK] Column 'payment_type' already exists")
        
        # Add payment_start_date column if missing
        if 'payment_start_date' not in columns:
            print("Adding 'payment_start_date' column...")
            db.execute(text("ALTER TABLE company ADD COLUMN payment_start_date DATETIME"))
            added_columns.append('payment_start_date')
        else:
            print("[OK] Column 'payment_start_date' already exists")
        
        # Add payment_end_date column if missing
        if 'payment_end_date' not in columns:
            print("Adding 'payment_end_date' column...")
            db.execute(text("ALTER TABLE company ADD COLUMN payment_end_date DATETIME"))
            added_columns.append('payment_end_date')
        else:
            print("[OK] Column 'payment_end_date' already exists")
        
        # Add payment_amount column if missing
        if 'payment_amount' not in columns:
            print("Adding 'payment_amount' column...")
            db.execute(text("ALTER TABLE company ADD COLUMN payment_amount VARCHAR(50)"))
            added_columns.append('payment_amount')
        else:
            print("[OK] Column 'payment_amount' already exists")
        
        if added_columns:
            db.commit()
            print(f"\n[OK] Added columns: {', '.join(added_columns)}\n")
        else:
            print("\n[OK] All columns already exist!\n")
        
        # Verify
        inspector = inspect(engine)
        columns = [col['name'] for col in inspector.get_columns('company')]
        print(f"Total columns in company table: {len(columns)}\n")
        
        print("="*80)
        print("SUCCESS!")
        print("="*80 + "\n")
        
    except Exception as e:
        print(f"\nERROR: {str(e)}")
        db.rollback()
        import traceback
        traceback.print_exc()
        print("\nIf this fails, you may need to recreate the database.")
        print("Run: restore_sample_data.bat")
    finally:
        db.close()

if __name__ == "__main__":
    add_company_payment_columns()












