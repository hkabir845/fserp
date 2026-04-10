"""
Fix Orphaned Invoice Line Items
Removes or fixes line items that reference deleted items
"""
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.database import SessionLocal
from app.models import Company, Invoice, InvoiceLineItem, Item

def fix_orphaned_line_items(company_id: int = None):
    """Fix orphaned invoice line items"""
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
        
        # Find orphaned line items (items that don't exist)
        orphaned_items = db.query(InvoiceLineItem).filter(
            InvoiceLineItem.invoice_id.in_(
                db.query(Invoice.id).filter(Invoice.company_id == company_id)
            )
        ).outerjoin(Item, InvoiceLineItem.item_id == Item.id).filter(
            Item.id == None
        ).all()
        
        if not orphaned_items:
            print("[OK] No orphaned line items found")
            return
        
        print(f"[OK] Found {len(orphaned_items)} orphaned line item(s)")
        
        # Option 1: Delete orphaned items (recommended)
        # Option 2: Set item_id to NULL and mark for review
        # We'll delete them as they're invalid
        
        deleted_count = 0
        for line_item in orphaned_items:
            invoice = db.query(Invoice).filter(Invoice.id == line_item.invoice_id).first()
            if invoice:
                print(f"  - Deleting line item {line_item.id} from invoice {invoice.invoice_number}")
                db.delete(line_item)
                deleted_count += 1
        
        if deleted_count > 0:
            db.commit()
            print(f"\n[SUCCESS] Deleted {deleted_count} orphaned line item(s)")
            print("[WARNING] Invoice totals may need recalculation after deletion")
        else:
            print("[OK] No items deleted")
        
    except Exception as e:
        db.rollback()
        print(f"\n[ERROR] {str(e)}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    print("="*60)
    print("FIX ORPHANED INVOICE LINE ITEMS")
    print("="*60)
    fix_orphaned_line_items()

