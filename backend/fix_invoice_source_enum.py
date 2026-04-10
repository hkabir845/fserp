"""
Fix Invoice Source Enum Values
Updates 'manual' to 'MANUAL' to match enum definition
"""
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.database import SessionLocal
from app.models import Company, Invoice, InvoiceSource

def fix_invoice_source_enum(company_id: int = None):
    """Fix invoice source enum values in database"""
    db = SessionLocal()
    
    try:
        if company_id is None:
            # Get first company
            company = db.query(Company).first()
            if not company:
                print("[ERROR] No company found")
                return
            company_id = company.id
            print(f"[OK] Using company: {company.name} (ID: {company_id})")
        
        # Check for invoices with incorrect enum values
        # Note: SQLAlchemy enum handling can be tricky, so we'll use raw SQL
        result = db.execute(text("""
            SELECT COUNT(*) as count
            FROM invoice
            WHERE company_id = :company_id
            AND source = 'manual'
        """), {"company_id": company_id})
        
        count = result.scalar()
        
        if count == 0:
            print("[OK] No invoices with incorrect enum values found")
            return
        
        print(f"[OK] Found {count} invoice(s) with 'manual' source value")
        print("[OK] Updating to 'MANUAL'...")
        
        # Update using raw SQL
        db.execute(text("""
            UPDATE invoice
            SET source = 'MANUAL'
            WHERE company_id = :company_id
            AND source = 'manual'
        """), {"company_id": company_id})
        
        db.commit()
        
        print(f"[SUCCESS] Updated {count} invoice(s)")
        
    except Exception as e:
        db.rollback()
        print(f"\n[ERROR] {str(e)}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    print("="*60)
    print("FIX INVOICE SOURCE ENUM")
    print("="*60)
    fix_invoice_source_enum()

