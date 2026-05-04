"""
Fix Empty Invoices
Updates invoices that have no line items but non-zero totals
"""
from decimal import Decimal
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Company, Invoice, InvoiceLineItem

def fix_empty_invoices(company_id: int = None):
    """Fix invoices with no line items but non-zero totals"""
    db = SessionLocal()
    
    try:
        if company_id is None:
            company = db.query(Company).first()
            if not company:
                print("[ERROR] No company found")
                return
            company_id = company.id
            print(f"[OK] Using company: {company.name} (ID: {company_id})")
        
        # Find invoices with no line items but non-zero totals
        invoices = db.query(Invoice).filter(
            Invoice.company_id == company_id
        ).all()
        
        fixed_count = 0
        
        for invoice in invoices:
            line_items = db.query(InvoiceLineItem).filter(
                InvoiceLineItem.invoice_id == invoice.id
            ).count()
            
            if line_items == 0 and (invoice.subtotal != Decimal("0.00") or invoice.total_amount != Decimal("0.00")):
                print(f"  [FIX] Invoice {invoice.invoice_number}: Setting totals to $0.00 (no line items)")
                invoice.subtotal = Decimal("0.00")
                invoice.tax_amount = Decimal("0.00")
                invoice.discount_amount = Decimal("0.00")
                invoice.total_amount = Decimal("0.00")
                invoice.balance_due = Decimal("0.00")
                fixed_count += 1
        
        if fixed_count > 0:
            db.commit()
            print(f"\n[SUCCESS] Fixed {fixed_count} invoice(s)")
        else:
            print("\n[OK] No empty invoices with non-zero totals found")
        
    except Exception as e:
        db.rollback()
        print(f"\n[ERROR] {str(e)}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    print("="*60)
    print("FIX EMPTY INVOICES")
    print("="*60)
    fix_empty_invoices()
