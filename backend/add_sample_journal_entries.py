"""
Add Sample Journal Entries to Existing Database
This script adds sample journal entries for testing the journal entries page
"""
from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models.journal_entry import JournalEntry, JournalEntryLine
from app.models.chart_of_accounts import ChartOfAccount
from app.models.user import User, UserRole
from app.utils.auto_numbering import generate_next_number

def add_sample_journal_entries():
    """Add sample journal entries to the database"""
    
    print("\n" + "="*80)
    print("ADDING SAMPLE JOURNAL ENTRIES")
    print("="*80 + "\n")
    
    db = SessionLocal()
    
    try:
        # Get the first company (assuming single company setup)
        from app.models.company import Company
        company = db.query(Company).first()
        if not company:
            print("ERROR: No company found in database. Please run init_comprehensive_data.py first.")
            return
        
        company_id = company.id
        print(f"Company: {company.name} (ID: {company_id})\n")
        
        # Get admin user for created_by
        admin_user = db.query(User).filter(
            User.company_id == company_id,
            User.role == UserRole.ADMIN
        ).first()
        
        if not admin_user:
            admin_user = db.query(User).filter(User.company_id == company_id).first()
        
        if not admin_user:
            print("ERROR: No user found in database.")
            return
        
        print(f"Using user: {admin_user.username} (ID: {admin_user.id})\n")
        
        # Helper function to generate journal entry number
        def get_next_journal_entry_number():
            return generate_next_number(db, JournalEntry, 'entry_number', 'JE', 4, company_id)
        
        # Get accounts by account code (stored as string)
        def get_account(account_code):
            return db.query(ChartOfAccount).filter(
                ChartOfAccount.account_code == str(account_code),
                ChartOfAccount.company_id == company_id
            ).first()
        
        # Check if journal entries already exist
        existing_entries = db.query(JournalEntry).filter(
            JournalEntry.company_id == company_id
        ).count()
        
        if existing_entries > 0:
            print(f"Note: {existing_entries} journal entries already exist in the database.")
            response = input("Do you want to add more sample entries? (y/n): ")
            if response.lower() != 'y':
                print("Cancelled.")
                return
        
        # Sample Journal Entry 1: Office Supplies Purchase
        entry1_number = get_next_journal_entry_number()
        entry1 = JournalEntry(
            entry_number=entry1_number,
            entry_date=date(2024, 1, 15),
            reference="INV-001",
            description="Office supplies purchase for Q1 2024",
            total_debit=Decimal("250.00"),
            total_credit=Decimal("250.00"),
            is_posted=True,
            company_id=company_id,
            created_by=admin_user.id
        )
        db.add(entry1)
        db.flush()
        
        office_supplies_account = get_account(6500)
        accounts_payable_account = get_account(2000)
        
        if office_supplies_account and accounts_payable_account:
            line1_1 = JournalEntryLine(
                journal_entry_id=entry1.id,
                line_number=1,
                description="Office supplies purchase",
                debit_account_id=office_supplies_account.id,
                credit_account_id=None,
                amount=Decimal("250.00")
            )
            line1_2 = JournalEntryLine(
                journal_entry_id=entry1.id,
                line_number=2,
                description="Payment to vendor",
                debit_account_id=None,
                credit_account_id=accounts_payable_account.id,
                amount=Decimal("250.00")
            )
            db.add(line1_1)
            db.add(line1_2)
            # Update account balances
            office_supplies_account.current_balance = (office_supplies_account.current_balance or Decimal("0.00")) + Decimal("250.00")
            accounts_payable_account.current_balance = (accounts_payable_account.current_balance or Decimal("0.00")) + Decimal("250.00")
        
        print(f"  [OK] Journal Entry: {entry1_number} - Office Supplies Purchase")
        
        # Sample Journal Entry 2: Equipment Depreciation
        entry2_number = get_next_journal_entry_number()
        entry2 = JournalEntry(
            entry_number=entry2_number,
            entry_date=date(2024, 1, 31),
            reference="DEP-001",
            description="Monthly depreciation expense for equipment",
            total_debit=Decimal("1500.00"),
            total_credit=Decimal("1500.00"),
            is_posted=True,
            company_id=company_id,
            created_by=admin_user.id
        )
        db.add(entry2)
        db.flush()
        
        depreciation_expense_account = get_account(6900)
        accumulated_depreciation_account = get_account(1550)
        
        if depreciation_expense_account and accumulated_depreciation_account:
            line2_1 = JournalEntryLine(
                journal_entry_id=entry2.id,
                line_number=1,
                description="Monthly depreciation - equipment",
                debit_account_id=depreciation_expense_account.id,
                credit_account_id=None,
                amount=Decimal("1500.00")
            )
            line2_2 = JournalEntryLine(
                journal_entry_id=entry2.id,
                line_number=2,
                description="Accumulated depreciation",
                debit_account_id=None,
                credit_account_id=accumulated_depreciation_account.id,
                amount=Decimal("1500.00")
            )
            db.add(line2_1)
            db.add(line2_2)
            # Update account balances
            depreciation_expense_account.current_balance = (depreciation_expense_account.current_balance or Decimal("0.00")) + Decimal("1500.00")
            accumulated_depreciation_account.current_balance = (accumulated_depreciation_account.current_balance or Decimal("0.00")) - Decimal("1500.00")
        
        print(f"  [OK] Journal Entry: {entry2_number} - Equipment Depreciation")
        
        # Sample Journal Entry 3: Rent Payment
        entry3_number = get_next_journal_entry_number()
        entry3 = JournalEntry(
            entry_number=entry3_number,
            entry_date=date(2024, 2, 1),
            reference="RENT-001",
            description="Monthly rent payment for February 2024",
            total_debit=Decimal("5000.00"),
            total_credit=Decimal("5000.00"),
            is_posted=True,
            company_id=company_id,
            created_by=admin_user.id
        )
        db.add(entry3)
        db.flush()
        
        rent_expense_account = get_account(6100)
        bank_account = get_account(1020)
        
        if rent_expense_account and bank_account:
            line3_1 = JournalEntryLine(
                journal_entry_id=entry3.id,
                line_number=1,
                description="Monthly rent expense",
                debit_account_id=rent_expense_account.id,
                credit_account_id=None,
                amount=Decimal("5000.00")
            )
            line3_2 = JournalEntryLine(
                journal_entry_id=entry3.id,
                line_number=2,
                description="Bank payment",
                debit_account_id=None,
                credit_account_id=bank_account.id,
                amount=Decimal("5000.00")
            )
            db.add(line3_1)
            db.add(line3_2)
            # Update account balances
            rent_expense_account.current_balance = (rent_expense_account.current_balance or Decimal("0.00")) + Decimal("5000.00")
            bank_account.current_balance = (bank_account.current_balance or Decimal("0.00")) - Decimal("5000.00")
        
        print(f"  [OK] Journal Entry: {entry3_number} - Rent Payment")
        
        # Sample Journal Entry 4: Utility Bill Payment
        entry4_number = get_next_journal_entry_number()
        entry4 = JournalEntry(
            entry_number=entry4_number,
            entry_date=date(2024, 2, 5),
            reference="UTIL-001",
            description="Electricity bill payment for January 2024",
            total_debit=Decimal("850.00"),
            total_credit=Decimal("850.00"),
            is_posted=False,  # Not posted yet
            company_id=company_id,
            created_by=admin_user.id
        )
        db.add(entry4)
        db.flush()
        
        utilities_expense_account = get_account(6200)
        
        if utilities_expense_account and accounts_payable_account:
            line4_1 = JournalEntryLine(
                journal_entry_id=entry4.id,
                line_number=1,
                description="Electricity bill - January 2024",
                debit_account_id=utilities_expense_account.id,
                credit_account_id=None,
                amount=Decimal("850.00")
            )
            line4_2 = JournalEntryLine(
                journal_entry_id=entry4.id,
                line_number=2,
                description="Payable to utility company",
                debit_account_id=None,
                credit_account_id=accounts_payable_account.id,
                amount=Decimal("850.00")
            )
            db.add(line4_1)
            db.add(line4_2)
        
        print(f"  [OK] Journal Entry: {entry4_number} - Utility Bill (Unposted)")
        
        # Sample Journal Entry 5: Owner's Draw
        entry5_number = get_next_journal_entry_number()
        entry5 = JournalEntry(
            entry_number=entry5_number,
            entry_date=date(2024, 2, 10),
            reference="DRAW-001",
            description="Owner's personal draw",
            total_debit=Decimal("2000.00"),
            total_credit=Decimal("2000.00"),
            is_posted=True,
            company_id=company_id,
            created_by=admin_user.id
        )
        db.add(entry5)
        db.flush()
        
        owners_draw_account = get_account(3200)
        
        if owners_draw_account and bank_account:
            line5_1 = JournalEntryLine(
                journal_entry_id=entry5.id,
                line_number=1,
                description="Owner's personal withdrawal",
                debit_account_id=owners_draw_account.id,
                credit_account_id=None,
                amount=Decimal("2000.00")
            )
            line5_2 = JournalEntryLine(
                journal_entry_id=entry5.id,
                line_number=2,
                description="Bank payment",
                debit_account_id=None,
                credit_account_id=bank_account.id,
                amount=Decimal("2000.00")
            )
            db.add(line5_1)
            db.add(line5_2)
            # Update account balances
            owners_draw_account.current_balance = (owners_draw_account.current_balance or Decimal("0.00")) - Decimal("2000.00")
            bank_account.current_balance = (bank_account.current_balance or Decimal("0.00")) - Decimal("2000.00")
        
        print(f"  [OK] Journal Entry: {entry5_number} - Owner's Draw")
        
        # Commit all changes
        db.commit()
        print(f"\n[OK] 5 sample journal entries created successfully!\n")
        print("="*80)
        print("COMPLETE!")
        print("="*80 + "\n")
        
    except Exception as e:
        print(f"\nERROR: {str(e)}")
        db.rollback()
        import traceback
        traceback.print_exc()
        raise
    finally:
        db.close()

if __name__ == "__main__":
    add_sample_journal_entries()

