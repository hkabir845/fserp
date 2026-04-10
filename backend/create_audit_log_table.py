"""
Create Audit Log Table
Migration script to create the audit_log table
"""
import sys
from sqlalchemy import text
from app.database import SessionLocal, engine
from app.models.audit_log import AuditLog

def create_audit_log_table():
    """Create audit_log table if it doesn't exist"""
    print("\n" + "="*80)
    print("Creating Audit Log Table")
    print("="*80)
    
    db = SessionLocal()
    try:
        # Check if table already exists
        inspector = __import__('sqlalchemy.inspect', fromlist=['inspect']).inspect(engine)
        existing_tables = inspector.get_table_names()
        
        if 'audit_log' in existing_tables:
            print("\n[OK] Audit log table already exists. Skipping creation.")
            return True
        
        print("\nCreating audit_log table...")
        
        # Create table using SQLAlchemy
        AuditLog.__table__.create(bind=engine, checkfirst=True)
        
        print("[OK] Audit log table created successfully!")
        print("\nTable structure:")
        print("  - id (Primary Key)")
        print("  - action (String)")
        print("  - action_type (String)")
        print("  - user_id (Integer, Indexed)")
        print("  - user_email (String)")
        print("  - company_id (Integer, Indexed)")
        print("  - company_name (String)")
        print("  - is_master_company (String)")
        print("  - resource_type (String)")
        print("  - resource_id (Integer)")
        print("  - details (JSON)")
        print("  - ip_address (String)")
        print("  - user_agent (String)")
        print("  - request_path (String)")
        print("  - status (String)")
        print("  - error_message (Text)")
        print("  - timestamp (DateTime, Indexed)")
        print("  - created_at, updated_at, is_deleted (from BaseModel)")
        
        return True
        
    except Exception as e:
        print(f"\n[X] Error creating audit log table: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        db.close()


if __name__ == "__main__":
    print("\nStarting audit log table creation...")
    if create_audit_log_table():
        print("\n" + "="*80)
        print("✅ Audit log table creation completed!")
        print("="*80)
    else:
        print("\n" + "="*80)
        print("❌ Audit log table creation failed!")
        print("="*80)
        sys.exit(1)
