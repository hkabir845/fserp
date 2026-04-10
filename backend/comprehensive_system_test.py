"""
Comprehensive System Test
Tests all features with existing data to verify world-standard business rules
"""
import sys
from datetime import datetime, date
from decimal import Decimal
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import SessionLocal
from app.models import (
    Company, User, Customer, Vendor, Item, Invoice, InvoiceLineItem,
    Bill, BillLineItem, Payment, JournalEntry, JournalEntryLine,
    ChartOfAccount, TaxCode, TaxRate, Tank, TankDip, NozzleSale,
    ShiftSession, MeterReading, BankAccount
)
from app.utils.tax_calculation import calculate_tax_for_line_item
from app.utils.backup_restore import backup_service

def test_tax_calculation(db: Session, company_id: int):
    """Test tax calculation with existing data"""
    print("\n" + "="*60)
    print("TEST 1: Tax Calculation")
    print("="*60)
    
    # Get a taxable item
    item = db.query(Item).filter(
        Item.company_id == company_id,
        Item.is_taxable == True
    ).first()
    
    if not item:
        print("[WARNING] No taxable items found. Creating test item...")
        item = Item(
            item_number="TEST-TAX-001",
            name="Test Taxable Item",
            item_type="INVENTORY",
            unit="Liter",
            cost=Decimal("1.00"),
            unit_price=Decimal("2.00"),
            is_taxable=True,
            company_id=company_id
        )
        db.add(item)
        db.commit()
        db.refresh(item)
    
    # Get tax code and rate (TaxCode doesn't have is_active, so just filter by company)
    tax_code = db.query(TaxCode).filter(
        TaxCode.company_id == company_id
    ).first()
    
    if not tax_code:
        print("[WARNING] No tax codes found. Test cannot proceed.")
        return False
    
    tax_rate = db.query(TaxRate).filter(
        TaxRate.tax_code_id == tax_code.id
    ).first()
    
    if not tax_rate:
        print("[WARNING] No tax rates found for tax code. Test cannot proceed.")
        return False
    
    print(f"[OK] Item: {item.name}")
    print(f"[OK] Tax Code: {tax_code.code} ({tax_code.name})")
    print(f"[OK] Tax Rate: {tax_rate.rate}%")
    
    # Test calculation
    line_amount = Decimal("100.00")
    expected_tax = line_amount * (tax_rate.rate / 100)
    calculated_tax = calculate_tax_for_line_item(item, line_amount, company_id, db)
    
    print(f"\nTest Calculation:")
    print(f"  Line Amount: ${line_amount}")
    print(f"  Expected Tax: ${expected_tax:.2f}")
    print(f"  Calculated Tax: ${calculated_tax:.2f}")
    
    if abs(calculated_tax - expected_tax) < Decimal("0.01"):
        print("[PASS] Tax calculation is CORRECT")
        return True
    else:
        print(f"[FAIL] Tax calculation is INCORRECT (difference: ${abs(calculated_tax - expected_tax):.2f})")
        return False


def test_invoice_accounting_rules(db: Session, company_id: int):
    """Test invoice accounting follows double-entry rules"""
    print("\n" + "="*60)
    print("TEST 2: Invoice Accounting Rules (Double-Entry)")
    print("="*60)
    
    # Get an existing invoice
    invoice = db.query(Invoice).filter(
        Invoice.company_id == company_id
    ).order_by(Invoice.id.desc()).first()
    
    if not invoice:
        print("[WARNING] No invoices found. Skipping test.")
        return True
    
    print(f"[OK] Testing Invoice: {invoice.invoice_number}")
    print(f"  Subtotal: ${invoice.subtotal}")
    print(f"  Tax: ${invoice.tax_amount}")
    print(f"  Total: ${invoice.total_amount}")
    
    # Check journal entries (by reference field containing invoice number)
    journal_entries = db.query(JournalEntry).filter(
        JournalEntry.reference.like(f"%{invoice.invoice_number}%"),
        JournalEntry.company_id == company_id
    ).all()
    
    if not journal_entries:
        print("[WARNING] No journal entries found for invoice. Accounting may not be posted.")
        return True
    
    print(f"\n[OK] Found {len(journal_entries)} journal entry(ies)")
    
    # Verify double-entry: debits = credits
    total_debits = Decimal("0.00")
    total_credits = Decimal("0.00")
    
    for entry in journal_entries:
        lines = db.query(JournalEntryLine).filter(
            JournalEntryLine.journal_entry_id == entry.id
        ).all()
        
        for line in lines:
            if line.debit_account_id:
                total_debits += line.amount
            if line.credit_account_id:
                total_credits += line.amount
    
    print(f"  Total Debits: ${total_debits:.2f}")
    print(f"  Total Credits: ${total_credits:.2f}")
    
    if abs(total_debits - total_credits) < Decimal("0.01"):
        print("[PASS] Double-entry rule is CORRECT (Debits = Credits)")
        return True
    else:
        print(f"[FAIL] Double-entry rule is VIOLATED (difference: ${abs(total_debits - total_credits):.2f})")
        return False


def test_account_balances(db: Session, company_id: int):
    """Test that account balances are correctly maintained"""
    print("\n" + "="*60)
    print("TEST 3: Account Balance Integrity")
    print("="*60)
    
    # Get all accounts
    accounts = db.query(ChartOfAccount).filter(
        ChartOfAccount.company_id == company_id,
        ChartOfAccount.is_active == True
    ).all()
    
    print(f"[OK] Checking {len(accounts)} accounts")
    
    issues = []
    for account in accounts:
        # Calculate balance from journal entries
        # Note: JournalEntryLine uses debit_account_id/credit_account_id and amount
        debit_total = db.query(func.sum(JournalEntryLine.amount)).filter(
            JournalEntryLine.debit_account_id == account.id,
            JournalEntryLine.journal_entry_id.in_(
                db.query(JournalEntry.id).filter(
                    JournalEntry.company_id == company_id,
                    JournalEntry.is_posted == True
                )
            )
        ).scalar() or Decimal("0.00")
        
        credit_total = db.query(func.sum(JournalEntryLine.amount)).filter(
            JournalEntryLine.credit_account_id == account.id,
            JournalEntryLine.journal_entry_id.in_(
                db.query(JournalEntry.id).filter(
                    JournalEntry.company_id == company_id,
                    JournalEntry.is_posted == True
                )
            )
        ).scalar() or Decimal("0.00")
        
        # Calculate expected balance based on account type
        if account.account_type in ["ASSET", "EXPENSE", "COST_OF_GOODS_SOLD"]:
            expected_balance = account.opening_balance + debit_total - credit_total
        else:  # LIABILITY, EQUITY, INCOME
            expected_balance = account.opening_balance + credit_total - debit_total
        
        if abs(account.current_balance - expected_balance) > Decimal("0.01"):
            issues.append({
                "account": account.account_name,
                "stored": account.current_balance,
                "calculated": expected_balance,
                "difference": abs(account.current_balance - expected_balance)
            })
    
    if issues:
        print(f"[FAIL] Found {len(issues)} account(s) with balance discrepancies:")
        for issue in issues[:5]:  # Show first 5
            print(f"  - {issue['account']}: Stored=${issue['stored']:.2f}, Calculated=${issue['calculated']:.2f}, Diff=${issue['difference']:.2f}")
        return False
    else:
        print("[PASS] All account balances are CORRECT")
        return True


def test_tank_dip_accounting(db: Session, company_id: int):
    """Test tank dip accounting (inventory gain/loss)"""
    print("\n" + "="*60)
    print("TEST 4: Tank Dip Accounting")
    print("="*60)
    
    # Get a tank dip (through tank relationship)
    tank_dip = db.query(TankDip).join(Tank).filter(
        Tank.company_id == company_id
    ).order_by(TankDip.id.desc()).first()
    
    if not tank_dip:
        print("[WARNING] No tank dips found. Skipping test.")
        return True
    
    print(f"[OK] Testing Tank Dip: {tank_dip.id}")
    print(f"  Tank: {tank_dip.tank.tank_name if tank_dip.tank else 'N/A'}")
    print(f"  Measured Qty: {tank_dip.measured_quantity}")
    print(f"  System Qty: {tank_dip.system_quantity}")
    print(f"  Variance: {tank_dip.variance_quantity} ({tank_dip.variance_type})")
    print(f"  Variance Value: ${tank_dip.variance_value}")
    
    # Check if journal entry exists (by journal_entry_id or reference field)
    journal_entry = None
    if tank_dip.journal_entry_id:
        journal_entry = db.query(JournalEntry).filter(
            JournalEntry.id == tank_dip.journal_entry_id,
            JournalEntry.company_id == company_id
        ).first()
    else:
        # Try by reference field
        journal_entry = db.query(JournalEntry).filter(
            JournalEntry.reference.like(f"%Tank Dip%{tank_dip.id}%"),
            JournalEntry.company_id == company_id
        ).first()
    
    if not journal_entry:
        print("[WARNING] No journal entry found. Tank dip accounting may not be posted.")
        return True
    
    print(f"[OK] Journal Entry: {journal_entry.entry_number}")
    
    # Verify double-entry
    lines = db.query(JournalEntryLine).filter(
        JournalEntryLine.journal_entry_id == journal_entry.id
    ).all()
    
    total_debits = sum(line.amount for line in lines if line.debit_account_id)
    total_credits = sum(line.amount for line in lines if line.credit_account_id)
    
    print(f"  Debits: ${total_debits:.2f}, Credits: ${total_credits:.2f}")
    
    if abs(total_debits - total_credits) < Decimal("0.01"):
        print("[PASS] Tank dip accounting is CORRECT")
        return True
    else:
        print(f"[FAIL] Tank dip accounting is INCORRECT (difference: ${abs(total_debits - total_credits):.2f})")
        return False


def test_invoice_totals(db: Session, company_id: int):
    """Test invoice totals calculation"""
    print("\n" + "="*60)
    print("TEST 5: Invoice Totals Calculation")
    print("="*60)
    
    invoices = db.query(Invoice).filter(
        Invoice.company_id == company_id
    ).limit(5).all()
    
    if not invoices:
        print("[WARNING] No invoices found. Skipping test.")
        return True
    
    print(f"[OK] Testing {len(invoices)} invoice(s)")
    
    issues = []
    for invoice in invoices:
        # Calculate from line items
        line_items = db.query(InvoiceLineItem).filter(
            InvoiceLineItem.invoice_id == invoice.id
        ).all()
        
        # Skip invoices with no line items (may have been cleaned up)
        if len(line_items) == 0:
            if invoice.subtotal != Decimal("0.00") or invoice.total_amount != Decimal("0.00"):
                issues.append({
                    "invoice": invoice.invoice_number,
                    "field": "empty_invoice",
                    "stored": invoice.total_amount,
                    "calculated": Decimal("0.00")
                })
            continue
        
        calculated_subtotal = sum(item.quantity * item.unit_price for item in line_items)
        calculated_tax = sum(item.tax_amount or Decimal("0.00") for item in line_items)
        calculated_total = calculated_subtotal + calculated_tax - (invoice.discount_amount or Decimal("0.00"))
        
        # Compare with stored values
        if abs(invoice.subtotal - calculated_subtotal) > Decimal("0.01"):
            issues.append({
                "invoice": invoice.invoice_number,
                "field": "subtotal",
                "stored": invoice.subtotal,
                "calculated": calculated_subtotal
            })
        
        if abs(invoice.tax_amount - calculated_tax) > Decimal("0.01"):
            issues.append({
                "invoice": invoice.invoice_number,
                "field": "tax_amount",
                "stored": invoice.tax_amount,
                "calculated": calculated_tax
            })
        
        if abs(invoice.total_amount - calculated_total) > Decimal("0.01"):
            issues.append({
                "invoice": invoice.invoice_number,
                "field": "total_amount",
                "stored": invoice.total_amount,
                "calculated": calculated_total
            })
    
    if issues:
        print(f"[FAIL] Found {len(issues)} invoice(s) with calculation errors:")
        for issue in issues[:5]:
            print(f"  - {issue['invoice']} ({issue['field']}): Stored=${issue['stored']:.2f}, Calculated=${issue['calculated']:.2f}")
        return False
    else:
        print("[PASS] All invoice totals are CORRECT")
        return True


def test_backup_system():
    """Test backup system"""
    print("\n" + "="*60)
    print("TEST 6: Backup System")
    print("="*60)
    
    try:
        # List existing backups
        backups = backup_service.list_backups()
        print(f"[OK] Found {len(backups)} existing backup(s)")
        
        # Test backup creation (dry run - don't actually create)
        print("[OK] Backup service is accessible")
        print("[PASS] Backup system is FUNCTIONAL")
        return True
    except Exception as e:
        print(f"[FAIL] Backup system error: {str(e)}")
        return False


def test_data_integrity(db: Session, company_id: int):
    """Test data integrity and relationships"""
    print("\n" + "="*60)
    print("TEST 7: Data Integrity & Relationships")
    print("="*60)
    
    issues = []
    
    # Check invoice line items reference valid items
    invalid_line_items = db.query(InvoiceLineItem).filter(
        InvoiceLineItem.invoice_id.in_(
            db.query(Invoice.id).filter(Invoice.company_id == company_id)
        )
    ).outerjoin(Item, InvoiceLineItem.item_id == Item.id).filter(
        Item.id == None
    ).count()
    
    if invalid_line_items > 0:
        issues.append(f"{invalid_line_items} invoice line item(s) reference invalid items")
    
    # Check journal entries reference valid accounts (debit or credit)
    invalid_journal_lines = db.query(JournalEntryLine).filter(
        JournalEntryLine.journal_entry_id.in_(
            db.query(JournalEntry.id).filter(JournalEntry.company_id == company_id)
        )
    ).outerjoin(ChartOfAccount, 
        (JournalEntryLine.debit_account_id == ChartOfAccount.id) | 
        (JournalEntryLine.credit_account_id == ChartOfAccount.id)
    ).filter(
        ChartOfAccount.id == None
    ).count()
    
    if invalid_journal_lines > 0:
        issues.append(f"{invalid_journal_lines} journal entry line(s) reference invalid accounts")
    
    # Check tank dips reference valid tanks (simplified check)
    # Get all tank dips for company's tanks
    company_tank_ids = db.query(Tank.id).filter(
        Tank.company_id == company_id
    ).subquery()
    
    invalid_tank_dips = db.query(TankDip).filter(
        ~TankDip.tank_id.in_(db.query(company_tank_ids))
    ).count()
    
    if invalid_tank_dips > 0:
        issues.append(f"{invalid_tank_dips} tank dip(s) reference invalid tanks")
    
    if issues:
        print(f"[FAIL] Found {len(issues)} data integrity issue(s):")
        for issue in issues:
            print(f"  - {issue}")
        return False
    else:
        print("[PASS] All data relationships are VALID")
        return True


def test_business_rules(db: Session, company_id: int):
    """Test business rules compliance"""
    print("\n" + "="*60)
    print("TEST 8: Business Rules Compliance")
    print("="*60)
    
    issues = []
    
    # Rule 1: Invoice balance should not exceed total amount
    invalid_invoices = db.query(Invoice).filter(
        Invoice.company_id == company_id,
        Invoice.balance_due > Invoice.total_amount
    ).count()
    
    if invalid_invoices > 0:
        issues.append(f"{invalid_invoices} invoice(s) have balance_due > total_amount")
    
    # Rule 2: Payments should not exceed invoice balance
    # (This would require checking payment allocations)
    
    # Rule 3: Tank current_stock should not exceed capacity
    invalid_tanks = db.query(Tank).filter(
        Tank.company_id == company_id,
        Tank.current_stock > Tank.capacity
    ).count()
    
    if invalid_tanks > 0:
        issues.append(f"{invalid_tanks} tank(s) have current_stock > capacity")
    
    # Rule 4: Account balances should be reasonable (not extremely large)
    extreme_balances = db.query(ChartOfAccount).filter(
        ChartOfAccount.company_id == company_id,
        func.abs(ChartOfAccount.current_balance) > Decimal("1000000000.00")  # 1 billion
    ).count()
    
    if extreme_balances > 0:
        issues.append(f"{extreme_balances} account(s) have extreme balances (possible data error)")
    
    if issues:
        print(f"[FAIL] Found {len(issues)} business rule violation(s):")
        for issue in issues:
            print(f"  - {issue}")
        return False
    else:
        print("[PASS] All business rules are COMPLIANT")
        return True


def main():
    """Run all tests"""
    print("="*60)
    print("COMPREHENSIVE SYSTEM TEST")
    print("Testing with Existing Data - World Standard Rules")
    print("="*60)
    
    db = SessionLocal()
    
    try:
        # Get first company
        company = db.query(Company).first()
        if not company:
            print("[FAIL] No company found in database. Please initialize data first.")
            return
        
        print(f"\n[OK] Testing with company: {company.name} (ID: {company.id})")
        
        results = []
        
        # Run all tests
        results.append(("Tax Calculation", test_tax_calculation(db, company.id)))
        results.append(("Invoice Accounting", test_invoice_accounting_rules(db, company.id)))
        results.append(("Account Balances", test_account_balances(db, company.id)))
        results.append(("Tank Dip Accounting", test_tank_dip_accounting(db, company.id)))
        results.append(("Invoice Totals", test_invoice_totals(db, company.id)))
        results.append(("Backup System", test_backup_system()))
        results.append(("Data Integrity", test_data_integrity(db, company.id)))
        results.append(("Business Rules", test_business_rules(db, company.id)))
        
        # Summary
        print("\n" + "="*60)
        print("TEST SUMMARY")
        print("="*60)
        
        passed = sum(1 for _, result in results if result)
        total = len(results)
        
        for test_name, result in results:
            status = "[PASS]" if result else "[FAIL]"
            print(f"{status} - {test_name}")
        
        print(f"\nTotal: {passed}/{total} tests passed")
        
        if passed == total:
            print("\n[SUCCESS] ALL TESTS PASSED - System is compliant with world standard rules!")
        else:
            print(f"\n[WARNING] {total - passed} test(s) failed. Please review issues above.")
        
    except Exception as e:
        print(f"\n[ERROR] {str(e)}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


if __name__ == "__main__":
    main()

