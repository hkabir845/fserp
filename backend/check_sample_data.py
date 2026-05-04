"""
Check if sample data exists in the database
"""
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import (
    Company, User, Customer, Vendor, Item, Station, Tank, Island, 
    Dispenser, Meter, Nozzle, ChartOfAccount, BankAccount, Employee
)

def check_sample_data():
    """Check if sample data exists"""
    db = SessionLocal()
    
    try:
        print("="*60)
        print("CHECKING SAMPLE DATA")
        print("="*60)
        print()
        
        # Check companies
        companies = db.query(Company).filter(Company.is_deleted == False).all()
        print(f"Companies: {len(companies)}")
        for company in companies:
            print(f"  - {company.name} (ID: {company.id}, Active: {company.is_active})")
        print()
        
        # Check users
        users = db.query(User).filter(User.is_deleted == False).all()
        print(f"Users: {len(users)}")
        for user in users:
            company_name = "N/A"
            if user.company_id:
                company = db.query(Company).filter(Company.id == user.company_id).first()
                if company:
                    company_name = company.name
            print(f"  - {user.username} ({user.role.value}) - Company: {company_name}")
        print()
        
        # Check customers
        customers = db.query(Customer).filter(Customer.is_deleted == False).all()
        print(f"Customers: {len(customers)}")
        if customers:
            for customer in customers[:5]:  # Show first 5
                company = db.query(Company).filter(Company.id == customer.company_id).first()
                company_name = company.name if company else f"Company ID: {customer.company_id}"
                print(f"  - {customer.display_name} (Company: {company_name})")
            if len(customers) > 5:
                print(f"  ... and {len(customers) - 5} more")
        print()
        
        # Check vendors
        vendors = db.query(Vendor).filter(Vendor.is_deleted == False).all()
        print(f"Vendors: {len(vendors)}")
        if vendors:
            for vendor in vendors[:5]:  # Show first 5
                company = db.query(Company).filter(Company.id == vendor.company_id).first()
                company_name = company.name if company else f"Company ID: {vendor.company_id}"
                print(f"  - {vendor.display_name} (Company: {company_name})")
            if len(vendors) > 5:
                print(f"  ... and {len(vendors) - 5} more")
        print()
        
        # Check products/items
        items = db.query(Item).filter(Item.is_deleted == False).all()
        print(f"Products/Items: {len(items)}")
        if items:
            for item in items[:5]:  # Show first 5
                company = db.query(Company).filter(Company.id == item.company_id).first()
                company_name = company.name if company else f"Company ID: {item.company_id}"
                print(f"  - {item.name} (Company: {company_name})")
            if len(items) > 5:
                print(f"  ... and {len(items) - 5} more")
        print()
        
        # Check stations
        stations = db.query(Station).filter(Station.is_deleted == False).all()
        print(f"Stations: {len(stations)}")
        if stations:
            for station in stations:
                company = db.query(Company).filter(Company.id == station.company_id).first()
                company_name = company.name if company else f"Company ID: {station.company_id}"
                station_name = getattr(station, 'name', getattr(station, 'station_name', f"Station ID: {station.id}"))
                print(f"  - {station_name} (Company: {company_name})")
        print()
        
        # Check tanks
        tanks = db.query(Tank).filter(Tank.is_deleted == False).all()
        print(f"Tanks: {len(tanks)}")
        print()
        
        # Check islands
        islands = db.query(Island).filter(Island.is_deleted == False).all()
        print(f"Islands: {len(islands)}")
        print()
        
        # Check dispensers
        dispensers = db.query(Dispenser).filter(Dispenser.is_deleted == False).all()
        print(f"Dispensers: {len(dispensers)}")
        print()
        
        # Check meters
        meters = db.query(Meter).filter(Meter.is_deleted == False).all()
        print(f"Meters: {len(meters)}")
        print()
        
        # Check nozzles
        nozzles = db.query(Nozzle).filter(Nozzle.is_deleted == False).all()
        print(f"Nozzles: {len(nozzles)}")
        print()
        
        # Check chart of accounts
        accounts = db.query(ChartOfAccount).filter(ChartOfAccount.is_deleted == False).all()
        print(f"Chart of Accounts: {len(accounts)}")
        print()
        
        # Check bank accounts
        bank_accounts = db.query(BankAccount).filter(BankAccount.is_deleted == False).all()
        print(f"Bank Accounts: {len(bank_accounts)}")
        print()
        
        # Check employees
        employees = db.query(Employee).filter(Employee.is_deleted == False).all()
        print(f"Employees: {len(employees)}")
        print()
        
        print("="*60)
        print("SUMMARY")
        print("="*60)
        print(f"Total Companies: {len(companies)}")
        print(f"Total Users: {len(users)}")
        print(f"Total Customers: {len(customers)}")
        print(f"Total Vendors: {len(vendors)}")
        print(f"Total Products: {len(items)}")
        print(f"Total Stations: {len(stations)}")
        print(f"Total Tanks: {len(tanks)}")
        print(f"Total Nozzles: {len(nozzles)}")
        print()
        
        if len(companies) == 0:
            print("⚠️  WARNING: No companies found!")
            print("   Run: python init_database.py to create sample data")
        elif len(customers) == 0 and len(vendors) == 0 and len(items) == 0:
            print("⚠️  WARNING: Sample data appears to be missing!")
            print("   Run: python init_database.py to create sample data")
        else:
            print("✓ Sample data appears to be present")
            print()
            print("If you can't see the data in the application:")
            print("  1. Make sure you're logged in with the correct company")
            print("  2. Check that your user's company_id matches the sample data company")
            print("  3. For superadmin: Select the company from the company switcher")
        
    except Exception as e:
        print(f"Error checking sample data: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    check_sample_data()

