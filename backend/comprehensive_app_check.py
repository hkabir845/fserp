"""
Comprehensive Application Check
Tests all modules, data connectivity, and relationships
"""
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import (
    Company, User, Customer, Vendor, Item, Station, Tank, Island, 
    Dispenser, Meter, Nozzle, ChartOfAccount, BankAccount, Employee,
    Invoice, Bill, Payment, JournalEntry, ShiftSession
)

def check_all_modules():
    """Comprehensive check of all application modules"""
    db = SessionLocal()
    
    try:
        print("="*80)
        print("COMPREHENSIVE APPLICATION CHECK")
        print("="*80)
        print()
        
        # 1. Check Companies
        print("1. COMPANIES")
        print("-" * 80)
        companies = db.query(Company).filter(Company.is_deleted == False).all()
        print(f"   Total Companies: {len(companies)}")
        for company in companies:
            print(f"   - {company.name} (ID: {company.id}, Active: {company.is_active})")
        print()
        
        # 2. Check Users and Company Assignments
        print("2. USERS & COMPANY ASSIGNMENTS")
        print("-" * 80)
        users = db.query(User).filter(User.is_deleted == False).all()
        users_without_company = [u for u in users if not u.company_id]
        print(f"   Total Users: {len(users)}")
        print(f"   Users without company_id: {len(users_without_company)}")
        if users_without_company:
            print("   WARNING: Users without company assignment:")
            for user in users_without_company:
                print(f"      - {user.username} ({user.role.value})")
        print()
        
        # 3. Check Station Infrastructure (Critical for POS/Cashier)
        print("3. STATION INFRASTRUCTURE")
        print("-" * 80)
        for company in companies:
            company_id = company.id
            stations = db.query(Station).filter(
                Station.company_id == company_id,
                Station.is_deleted == False
            ).all()
            
            print(f"   Company: {company.name} (ID: {company_id})")
            print(f"      Stations: {len(stations)}")
            
            for station in stations:
                tanks = db.query(Tank).filter(
                    Tank.station_id == station.id,
                    Tank.is_deleted == False
                ).all()
                
                islands = db.query(Island).filter(
                    Island.station_id == station.id,
                    Island.is_deleted == False
                ).all()
                
                dispensers = []
                meters = []
                nozzles = []
                
                for island in islands:
                    island_dispensers = db.query(Dispenser).filter(
                        Dispenser.island_id == island.id,
                        Dispenser.is_deleted == False
                    ).all()
                    dispensers.extend(island_dispensers)
                    
                    for dispenser in island_dispensers:
                        dispenser_meters = db.query(Meter).filter(
                            Meter.dispenser_id == dispenser.id,
                            Meter.is_deleted == False
                        ).all()
                        meters.extend(dispenser_meters)
                        
                        for meter in dispenser_meters:
                            meter_nozzles = db.query(Nozzle).filter(
                                Nozzle.meter_id == meter.id,
                                Nozzle.is_deleted == False
                            ).all()
                            nozzles.extend(meter_nozzles)
                
                print(f"      Station: {station.station_name}")
                print(f"         Tanks: {len(tanks)}")
                print(f"         Islands: {len(islands)}")
                print(f"         Dispensers: {len(dispensers)}")
                print(f"         Meters: {len(meters)}")
                print(f"         Nozzles: {len(nozzles)}")
                
                # Check for broken relationships
                broken_relationships = []
                for nozzle in nozzles:
                    if not nozzle.tank_id:
                        broken_relationships.append(f"Nozzle {nozzle.nozzle_number} has no tank_id")
                    if not nozzle.meter_id:
                        broken_relationships.append(f"Nozzle {nozzle.nozzle_number} has no meter_id")
                
                if broken_relationships:
                    print(f"         WARNING: Broken relationships: {len(broken_relationships)}")
                    for br in broken_relationships[:3]:
                        print(f"            - {br}")
        print()
        
        # 4. Check Customers & Vendors
        print("4. CUSTOMERS & VENDORS")
        print("-" * 80)
        for company in companies:
            company_id = company.id
            customers = db.query(Customer).filter(
                Customer.company_id == company_id,
                Customer.is_deleted == False
            ).count()
            vendors = db.query(Vendor).filter(
                Vendor.company_id == company_id,
                Vendor.is_deleted == False
            ).count()
            print(f"   {company.name}: Customers: {customers}, Vendors: {vendors}")
        print()
        
        # 5. Check Products/Items
        print("5. PRODUCTS/ITEMS")
        print("-" * 80)
        for company in companies:
            company_id = company.id
            items = db.query(Item).filter(
                Item.company_id == company_id,
                Item.is_deleted == False
            ).count()
            pos_items = db.query(Item).filter(
                Item.company_id == company_id,
                Item.is_deleted == False,
                Item.is_pos_available == True
            ).count()
            print(f"   {company.name}: Total Items: {items}, POS Available: {pos_items}")
        print()
        
        # 6. Check Accounting Data
        print("6. ACCOUNTING DATA")
        print("-" * 80)
        for company in companies:
            company_id = company.id
            accounts = db.query(ChartOfAccount).filter(
                ChartOfAccount.company_id == company_id,
                ChartOfAccount.is_deleted == False
            ).count()
            bank_accounts = db.query(BankAccount).filter(
                BankAccount.company_id == company_id,
                BankAccount.is_deleted == False
            ).count()
            invoices = db.query(Invoice).filter(
                Invoice.company_id == company_id,
                Invoice.is_deleted == False
            ).count()
            bills = db.query(Bill).filter(
                Bill.company_id == company_id,
                Bill.is_deleted == False
            ).count()
            journal_entries = db.query(JournalEntry).filter(
                JournalEntry.company_id == company_id,
                JournalEntry.is_deleted == False
            ).count()
            print(f"   {company.name}:")
            print(f"      Chart of Accounts: {accounts}")
            print(f"      Bank Accounts: {bank_accounts}")
            print(f"      Invoices: {invoices}")
            print(f"      Bills: {bills}")
            print(f"      Journal Entries: {journal_entries}")
        print()
        
        # 7. Check HR Data
        print("7. HR DATA")
        print("-" * 80)
        for company in companies:
            company_id = company.id
            employees = db.query(Employee).filter(
                Employee.company_id == company_id,
                Employee.is_deleted == False
            ).count()
            # ShiftSession doesn't have company_id, check by cashier's company
            shift_sessions = 0
            company_users = db.query(User).filter(User.company_id == company_id).all()
            if company_users:
                user_ids = [u.id for u in company_users]
                shift_sessions = db.query(ShiftSession).filter(
                    ShiftSession.cashier_id.in_(user_ids)
                ).count()
            print(f"   {company.name}: Employees: {employees}, Shift Sessions: {shift_sessions}")
        print()
        
        # 8. Summary & Recommendations
        print("="*80)
        print("SUMMARY & RECOMMENDATIONS")
        print("="*80)
        print()
        
        issues_found = []
        
        if users_without_company:
            issues_found.append(f"{len(users_without_company)} users without company_id")
        
        if len(companies) == 0:
            issues_found.append("No companies found - run init_database.py")
        
        sample_company = db.query(Company).filter(Company.id == 1).first()
        if sample_company:
            sample_stations = db.query(Station).filter(
                Station.company_id == 1,
                Station.is_deleted == False
            ).count()
            sample_nozzles = db.query(Nozzle).filter(
                Nozzle.company_id == 1,
                Nozzle.is_deleted == False
            ).count()
            sample_customers = db.query(Customer).filter(
                Customer.company_id == 1,
                Customer.is_deleted == False
            ).count()
            
            if sample_stations == 0:
                issues_found.append("Company ID 1 has no stations")
            if sample_nozzles == 0:
                issues_found.append("Company ID 1 has no nozzles (cashier page won't work)")
            if sample_customers == 0:
                issues_found.append("Company ID 1 has no customers")
        
        if issues_found:
            print("ISSUES FOUND:")
            for issue in issues_found:
                print(f"   - {issue}")
            print()
            print("RECOMMENDED ACTIONS:")
            if users_without_company:
                print("   1. Run: python fix_cashier_company.py (fixes user company assignments)")
            if len(companies) == 0 or (sample_company and sample_stations == 0):
                print("   2. Run: python init_database.py (creates sample data - WARNING: deletes existing data)")
            print()
        else:
            print("OK: No critical issues found!")
            print("   All modules appear to have proper data and relationships.")
            print()
        
        print("="*80)
        print("CHECK COMPLETE")
        print("="*80)
        
    except Exception as e:
        print(f"Error during check: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    check_all_modules()

