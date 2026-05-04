"""
Check Cashier Data Availability
This script checks if the cashier user has access to the required data
"""
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import (
    Company, User, Customer, Item, Station, Tank, Island, 
    Dispenser, Meter, Nozzle
)

def check_cashier_data():
    """Check if cashier has access to required data"""
    db = SessionLocal()
    
    try:
        print("="*60)
        print("CHECKING CASHIER DATA AVAILABILITY")
        print("="*60)
        print()
        
        # Check cashier users
        cashiers = db.query(User).filter(
            User.role == "cashier",
            User.is_deleted == False
        ).all()
        
        print(f"Cashier Users: {len(cashiers)}")
        for cashier in cashiers:
            company = None
            if cashier.company_id:
                company = db.query(Company).filter(Company.id == cashier.company_id).first()
            
            print(f"  - {cashier.username} (ID: {cashier.id})")
            print(f"    Company ID: {cashier.company_id}")
            print(f"    Company Name: {company.name if company else 'NONE - THIS IS THE PROBLEM!'}")
            print()
            
            if cashier.company_id:
                company_id = cashier.company_id
                
                # Check data for this company
                customers = db.query(Customer).filter(
                    Customer.company_id == company_id,
                    Customer.is_deleted == False
                ).count()
                
                nozzles = db.query(Nozzle).filter(
                    Nozzle.company_id == company_id,
                    Nozzle.is_deleted == False
                ).count()
                
                tanks = db.query(Tank).filter(
                    Tank.company_id == company_id,
                    Tank.is_deleted == False
                ).count()
                
                items = db.query(Item).filter(
                    Item.company_id == company_id,
                    Item.is_deleted == False
                ).count()
                
                stations = db.query(Station).filter(
                    Station.company_id == company_id,
                    Station.is_deleted == False
                ).count()
                
                print(f"    Data for Company ID {company_id}:")
                print(f"      Customers: {customers}")
                print(f"      Nozzles: {nozzles}")
                print(f"      Tanks: {tanks}")
                print(f"      Items: {items}")
                print(f"      Stations: {stations}")
                
                if customers == 0 and nozzles == 0 and tanks == 0:
                    print(f"    ⚠️  WARNING: No data found for this company!")
                    print(f"    Solution: Run 'python init_database.py' to create sample data")
                elif nozzles == 0:
                    print(f"    ⚠️  WARNING: No nozzles found - cashier page won't work!")
                elif customers == 0:
                    print(f"    ⚠️  WARNING: No customers found!")
                else:
                    print(f"    OK: Data available")
            else:
                print(f"    ERROR: Cashier has no company_id assigned!")
                print(f"    Solution: Assign cashier to a company (Company ID: 1 for sample data)")
            print()
        
        # Check sample data company
        sample_company = db.query(Company).filter(Company.id == 1).first()
        if sample_company:
            print(f"Sample Data Company: {sample_company.name} (ID: 1)")
            print(f"  Customers: {db.query(Customer).filter(Customer.company_id == 1, Customer.is_deleted == False).count()}")
            print(f"  Nozzles: {db.query(Nozzle).filter(Nozzle.company_id == 1, Nozzle.is_deleted == False).count()}")
            print(f"  Tanks: {db.query(Tank).filter(Tank.company_id == 1, Tank.is_deleted == False).count()}")
            print(f"  Items: {db.query(Item).filter(Item.company_id == 1, Item.is_deleted == False).count()}")
            print()
        
        print("="*60)
        print("RECOMMENDATIONS")
        print("="*60)
        print()
        print("If cashier has no company_id:")
        print("  1. Login as admin/superadmin")
        print("  2. Go to Users management")
        print("  3. Edit the cashier user and assign them to Company ID: 1")
        print()
        print("If cashier has company_id but no data:")
        print("  1. Run: python init_database.py (WARNING: deletes existing data)")
        print("  2. Or assign cashier to Company ID: 1 which has sample data")
        print()
        
    except Exception as e:
        print(f"Error checking cashier data: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    check_cashier_data()

