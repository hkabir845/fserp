"""
Database Initialization Script for FSMS
Creates sample data following FSMS Master Specification v1.0
"""
import sys
from datetime import datetime, date, time, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session
from app.database import engine, SessionLocal
from app.models.base import Base
from app.models import *

def create_tables():
    """Create all database tables"""
    print("Dropping existing tables...")
    Base.metadata.drop_all(bind=engine)
    print("[OK] Tables dropped")
    print("Creating database tables...")
    Base.metadata.create_all(bind=engine)
    print("[OK] Tables created")

def init_company(db: Session):
    """Initialize default company"""
    print("\nInitializing company...")
    
    company = Company(
        name="Adib Filling Station Ltd",
        legal_name="Adib Filling Station Limited",
        tax_id="FS-2025-001",
        email="info@mainfs.com",
        phone="+1-555-0100",
        address_line1="123 Highway Road",
        city="Capital City",
        state="State",
        postal_code="12345",
        country="USA",
        currency="USD",
        fiscal_year_start="01-01"
    )
    db.add(company)
    db.flush()
    print(f"[OK] Company created: {company.name}")
    return company

def init_users(db: Session, company_id: int):
    """Initialize users with different roles"""
    print("\nInitializing users...")
    
    from app.utils.security import get_password_hash
    
    users_data = [
        {
            "username": "admin",
            "hashed_password": get_password_hash("admin123"),
            "email": "admin@mainfs.com",
            "full_name": "System Administrator",
            "role": UserRole.ADMIN
        },
        {
            "username": "accountant",
            "hashed_password": get_password_hash("acc123"),
            "email": "accountant@mainfs.com",
            "full_name": "John Accountant",
            "role": UserRole.ACCOUNTANT
        },
        {
            "username": "cashier1",
            "hashed_password": get_password_hash("cash123"),
            "email": "cashier1@mainfs.com",
            "full_name": "Mary Cashier",
            "role": UserRole.CASHIER
        },
        {
            "username": "cashier2",
            "hashed_password": get_password_hash("cash123"),
            "email": "cashier2@mainfs.com",
            "full_name": "James Rodriguez",
            "role": UserRole.CASHIER
        }
    ]
    
    users = []
    for user_data in users_data:
        user_data['company_id'] = company_id
        user = User(**user_data)
        db.add(user)
        users.append(user)
    
    db.flush()
    print(f"[OK] Created {len(users)} users (admin, accountant, cashier1, cashier2)")
    return users

def init_chart_of_accounts(db: Session, company_id: int):
    """Initialize Chart of Accounts (QuickBooks-style)"""
    print("\nInitializing Chart of Accounts...")
    
    accounts = [
        # ASSETS
        {"code": "1000", "name": "Cash", "type": AccountType.ASSET, "subtype": AccountSubType.CASH_ON_HAND},
        {"code": "1010", "name": "Petty Cash", "type": AccountType.ASSET, "subtype": AccountSubType.CASH_ON_HAND},
        {"code": "1100", "name": "Checking Account", "type": AccountType.ASSET, "subtype": AccountSubType.CHECKING},
        {"code": "1200", "name": "Accounts Receivable", "type": AccountType.ASSET, "subtype": AccountSubType.ACCOUNTS_RECEIVABLE},
        {"code": "1300", "name": "Inventory - Diesel", "type": AccountType.ASSET, "subtype": AccountSubType.INVENTORY},
        {"code": "1301", "name": "Inventory - Petrol Octane 87", "type": AccountType.ASSET, "subtype": AccountSubType.INVENTORY},
        {"code": "1302", "name": "Inventory - Petrol Octane 91", "type": AccountType.ASSET, "subtype": AccountSubType.INVENTORY},
        {"code": "1303", "name": "Inventory - LPG", "type": AccountType.ASSET, "subtype": AccountSubType.INVENTORY},
        {"code": "1400", "name": "Prepaid Expenses", "type": AccountType.ASSET, "subtype": AccountSubType.PREPAID_EXPENSES},
        {"code": "1500", "name": "Equipment", "type": AccountType.ASSET, "subtype": AccountSubType.MACHINERY_AND_EQUIPMENT},
        {"code": "1600", "name": "Vehicles", "type": AccountType.ASSET, "subtype": AccountSubType.VEHICLES},
        
        # LIABILITIES
        {"code": "2000", "name": "Accounts Payable", "type": AccountType.LIABILITY, "subtype": AccountSubType.ACCOUNTS_PAYABLE},
        {"code": "2100", "name": "Sales Tax Payable", "type": AccountType.LIABILITY, "subtype": AccountSubType.SALES_TAX_PAYABLE},
        {"code": "2200", "name": "Customer Deposits", "type": AccountType.LIABILITY, "subtype": AccountSubType.OTHER_CURRENT_LIABILITIES},
        {"code": "2300", "name": "Short-term Loan", "type": AccountType.LIABILITY, "subtype": AccountSubType.LOAN_PAYABLE},
        
        # EQUITY
        {"code": "3000", "name": "Owner's Equity", "type": AccountType.EQUITY, "subtype": AccountSubType.OWNER_EQUITY},
        {"code": "3100", "name": "Owner's Draw", "type": AccountType.EQUITY, "subtype": AccountSubType.OWNERS_DRAW},
        {"code": "3900", "name": "Retained Earnings", "type": AccountType.EQUITY, "subtype": AccountSubType.RETAINED_EARNINGS},
        
        # INCOME
        {"code": "4000", "name": "Fuel Sales - Diesel", "type": AccountType.INCOME, "subtype": AccountSubType.SALES_OF_PRODUCT_INCOME},
        {"code": "4001", "name": "Fuel Sales - Petrol Octane 87", "type": AccountType.INCOME, "subtype": AccountSubType.SALES_OF_PRODUCT_INCOME},
        {"code": "4002", "name": "Fuel Sales - Petrol Octane 91", "type": AccountType.INCOME, "subtype": AccountSubType.SALES_OF_PRODUCT_INCOME},
        {"code": "4003", "name": "Fuel Sales - LPG", "type": AccountType.INCOME, "subtype": AccountSubType.SALES_OF_PRODUCT_INCOME},
        {"code": "4100", "name": "Service Income", "type": AccountType.INCOME, "subtype": AccountSubType.SERVICE_FEE_INCOME},
        {"code": "4900", "name": "Fuel Gain (Other Income)", "type": AccountType.INCOME, "subtype": AccountSubType.OTHER_INCOME},
        
        # COST OF GOODS SOLD
        {"code": "5000", "name": "Cost of Fuel - Diesel", "type": AccountType.COST_OF_GOODS_SOLD, "subtype": AccountSubType.SUPPLIES_MATERIALS_COGS},
        {"code": "5001", "name": "Cost of Fuel - Petrol Octane 87", "type": AccountType.COST_OF_GOODS_SOLD, "subtype": AccountSubType.SUPPLIES_MATERIALS_COGS},
        {"code": "5002", "name": "Cost of Fuel - Petrol Octane 91", "type": AccountType.COST_OF_GOODS_SOLD, "subtype": AccountSubType.SUPPLIES_MATERIALS_COGS},
        {"code": "5003", "name": "Cost of Fuel - LPG", "type": AccountType.COST_OF_GOODS_SOLD, "subtype": AccountSubType.SUPPLIES_MATERIALS_COGS},
        
        # EXPENSES
        {"code": "6000", "name": "Salaries Expense", "type": AccountType.EXPENSE, "subtype": AccountSubType.PAYROLL_EXPENSES},
        {"code": "6100", "name": "Rent Expense", "type": AccountType.EXPENSE, "subtype": AccountSubType.RENT_OR_LEASE_OF_BUILDINGS},
        {"code": "6200", "name": "Utilities - Electricity", "type": AccountType.EXPENSE, "subtype": AccountSubType.UTILITIES},
        {"code": "6300", "name": "Maintenance Expense", "type": AccountType.EXPENSE, "subtype": AccountSubType.REPAIR_MAINTENANCE},
        {"code": "6400", "name": "Fuel Loss/Wastage", "type": AccountType.EXPENSE, "subtype": AccountSubType.SUPPLIES_MATERIALS},
        {"code": "6500", "name": "Delivery Expense", "type": AccountType.EXPENSE, "subtype": AccountSubType.SHIPPING_FREIGHT_DELIVERY},
        {"code": "6600", "name": "Insurance Expense", "type": AccountType.EXPENSE, "subtype": AccountSubType.INSURANCE},
        {"code": "6700", "name": "Office Supplies", "type": AccountType.EXPENSE, "subtype": AccountSubType.OFFICE_GENERAL_ADMINISTRATIVE_EXPENSES},
    ]
    
    created_accounts = []
    for acc_data in accounts:
        account = ChartOfAccount(
            account_code=acc_data["code"],
            account_name=acc_data["name"],
            account_type=acc_data["type"],
            account_sub_type=acc_data["subtype"],
            company_id=company_id,
            opening_balance=Decimal("0.00"),
            current_balance=Decimal("0.00"),
            is_active=True
        )
        db.add(account)
        created_accounts.append(account)
    
    db.flush()
    print(f"[OK] Created {len(created_accounts)} accounts")
    return created_accounts

def init_products(db: Session, company_id: int):
    """Initialize fuel products"""
    print("\nInitializing products...")
    
    products_data = [
        {"number": "ITEM-001", "name": "Diesel", "type": ItemType.INVENTORY, "unit": "Liter", "cost": Decimal("1.20"), "price": Decimal("1.50")},
        {"number": "ITEM-002", "name": "Petrol Octane 87", "type": ItemType.INVENTORY, "unit": "Liter", "cost": Decimal("1.30"), "price": Decimal("1.60")},
        {"number": "ITEM-003", "name": "Petrol Octane 91", "type": ItemType.INVENTORY, "unit": "Liter", "cost": Decimal("1.40"), "price": Decimal("1.75")},
        {"number": "ITEM-004", "name": "LPG", "type": ItemType.INVENTORY, "unit": "Liter", "cost": Decimal("0.80"), "price": Decimal("1.00")},
        {"number": "ITEM-005", "name": "Car Wash", "type": ItemType.SERVICE, "unit": "Service", "cost": Decimal("5.00"), "price": Decimal("15.00")},
    ]
    
    products = []
    for prod_data in products_data:
        product = Item(
            item_number=prod_data["number"],
            name=prod_data["name"],
            item_type=prod_data["type"],
            unit=prod_data["unit"],
            cost=prod_data["cost"],
            unit_price=prod_data["price"],
            quantity_on_hand=Decimal("0.00") if prod_data["type"] == ItemType.INVENTORY else Decimal("0.00"),
            reorder_point=Decimal("1000.00") if prod_data["type"] == ItemType.INVENTORY else None,
            company_id=company_id
        )
        db.add(product)
        products.append(product)
    
    db.flush()
    print(f"[OK] Created {len(products)} products")
    return products

def init_station_infrastructure(db: Session, company_id: int, products: list):
    """Initialize station, islands, dispensers, meters, nozzles, tanks"""
    print("\nInitializing station infrastructure...")
    
    # Station
    station = Station(
        station_number="STN-0001",
        station_name="Main Station - Highway 101",
        address_line1="123 Highway 101",
        city="Capital City",
        state="State",
        phone="+1-555-0101",
        manager_name="Bob Manager",
        company_id=company_id
    )
    db.add(station)
    db.flush()
    print(f"[OK] Station: {station.station_name}")
    
    # Tanks (one for each fuel product)
    tanks = []
    fuel_products = [p for p in products if p.item_type == ItemType.INVENTORY]
    for idx, product in enumerate(fuel_products):
        tank = Tank(
            tank_number=f"TNK-{idx+1:04d}",
            tank_name=f"Tank {idx+1} - {product.name}",
            station_id=station.id,
            product_id=product.id,
            capacity=Decimal("10000.00"),
            current_stock=Decimal("5000.00"),
            min_level=Decimal("1000.00"),
            company_id=company_id
        )
        db.add(tank)
        tanks.append(tank)
    
    db.flush()
    print(f"[OK] Created {len(tanks)} tanks")
    
    # Island
    island = Island(
        island_number="IL-0001",
        island_name="Island 1",
        station_id=station.id,
        company_id=company_id
    )
    db.add(island)
    db.flush()
    print(f"[OK] Island: {island.island_name}")
    
    # Dispensers
    dispensers = []
    for i in range(2):
        dispenser = Dispenser(
            dispenser_number=f"DSP-{i+1:04d}",
            dispenser_name=f"Dispenser {i+1}",
            island_id=island.id,
            company_id=company_id
        )
        db.add(dispenser)
        dispensers.append(dispenser)
    
    db.flush()
    print(f"[OK] Created {len(dispensers)} dispensers")
    
    # Meters & Nozzles
    meters = []
    nozzles = []
    nozzle_num = 1
    for dispenser in dispensers:
        for tank in tanks[:2]:  # 2 products per dispenser
            # Meter
            meter = Meter(
                meter_number=f"MTR-{len(meters)+1:04d}",
                meter_name=f"Meter {len(meters)+1}",
                dispenser_id=dispenser.id,
                current_reading=Decimal("0.00"),
                company_id=company_id
            )
            db.add(meter)
            meters.append(meter)
            db.flush()
            
            # Nozzle
            nozzle = Nozzle(
                nozzle_number=f"NZL-{nozzle_num:04d}",
                nozzle_name=f"Nozzle {nozzle_num}",
                meter_id=meter.id,
                tank_id=tank.id,
                color_code="#3B82F6" if "Diesel" in tank.tank_name else "#10B981",
                is_operational="Y",
                company_id=company_id
            )
            db.add(nozzle)
            nozzles.append(nozzle)
            nozzle_num += 1
    
    db.flush()
    print(f"[OK] Created {len(meters)} meters and {len(nozzles)} nozzles")
    
    return station, tanks, island, dispensers, meters, nozzles

def init_shift_templates(db: Session):
    """Initialize shift templates for 24-hour operation"""
    print("\nInitializing shift templates...")
    
    templates_data = [
        {"name": "Morning Shift", "start": time(6, 0), "end": time(14, 0), "cross_midnight": False},
        {"name": "Evening Shift", "start": time(14, 0), "end": time(22, 0), "cross_midnight": False},
        {"name": "Night Shift", "start": time(22, 0), "end": time(6, 0), "cross_midnight": True},
    ]
    
    templates = []
    for tpl_data in templates_data:
        template = ShiftTemplate(
            name=tpl_data["name"],
            start_time=tpl_data["start"],
            end_time=tpl_data["end"],
            is_cross_midnight=tpl_data["cross_midnight"],
            is_active=True
        )
        db.add(template)
        templates.append(template)
    
    db.flush()
    print(f"[OK] Created {len(templates)} shift templates")
    return templates

def init_customers_vendors(db: Session, company_id: int):
    """Initialize sample customers and vendors"""
    print("\nInitializing customers and vendors...")
    
    # Customers
    customers_data = [
        {"name": "ABC Transport Co.", "email": "abc@transport.com", "phone": "+1-555-1001", "type": "BUSINESS", "address": "456 Industrial Ave"},
        {"name": "Walk-in Customer", "email": None, "phone": None, "type": "INDIVIDUAL", "address": None},
        {"name": "XYZ Logistics", "email": "xyz@logistics.com", "phone": "+1-555-1002", "type": "BUSINESS", "address": "789 Commerce St"},
        {"name": "John Smith", "email": "john.smith@email.com", "phone": "+1-555-1003", "type": "INDIVIDUAL", "address": "321 Main Street"},
    ]
    
    customers = []
    for idx, cust_data in enumerate(customers_data):
        customer = Customer(
            customer_number=f"CUST-{idx+1:04d}",
            display_name=cust_data["name"],
            email=cust_data["email"],
            phone=cust_data["phone"],
            billing_address_line1=cust_data.get("address"),
            opening_balance=Decimal("0.00"),
            opening_balance_date=date.today(),
            current_balance=Decimal("0.00"),
            company_id=company_id
        )
        db.add(customer)
        customers.append(customer)
    
    db.flush()
    print(f"[OK] Created {len(customers)} customers")
    
    # Vendors
    vendors_data = [
        {"name": "Main Fuel Supplier Ltd", "email": "sales@fuelsupplier.com", "phone": "+1-555-2001"},
        {"name": "Equipment Maintenance Co.", "email": "service@equipment.com", "phone": "+1-555-2002"},
        {"name": "Parts & Supplies Inc", "email": "orders@partsupplies.com", "phone": "+1-555-2003"},
        {"name": "Office Depot", "email": "business@officedepot.com", "phone": "+1-555-2004"},
    ]
    
    vendors = []
    for idx, vend_data in enumerate(vendors_data):
        vendor = Vendor(
            vendor_number=f"VEND-{idx+1:04d}",
            company_name=vend_data["name"],
            display_name=vend_data["name"],
            email=vend_data["email"],
            phone=vend_data["phone"],
            opening_balance=Decimal("0.00"),
            opening_balance_date=date.today(),
            current_balance=Decimal("0.00"),
            company_id=company_id
        )
        db.add(vendor)
        vendors.append(vendor)
    
    db.flush()
    print(f"[OK] Created {len(vendors)} vendors")
    
    return customers, vendors

def init_bank_accounts(db: Session, company_id: int):
    """Initialize bank accounts"""
    print("\nInitializing bank accounts...")
    
    bank_accounts_data = [
        {"name": "Main Operating Account", "number": "1234567890", "bank": "National Bank", "type": "CHECKING", "balance": Decimal("50000.00")},
        {"name": "Savings Account", "number": "0987654321", "bank": "National Bank", "type": "SAVINGS", "balance": Decimal("100000.00")},
        {"name": "Business Credit Card", "number": "4532-****-****-1234", "bank": "Global Bank", "type": "CREDIT_CARD", "balance": Decimal("-5000.00")},
    ]
    
    bank_accounts = []
    for acc_data in bank_accounts_data:
        bank_account = BankAccount(
            account_name=acc_data["name"],
            account_number=acc_data["number"],
            bank_name=acc_data["bank"],
            account_type=acc_data["type"],
            opening_balance=acc_data["balance"],
            opening_balance_date=date.today(),
            current_balance=acc_data["balance"],
            company_id=company_id
        )
        db.add(bank_account)
        bank_accounts.append(bank_account)
    
    db.flush()
    print(f"[OK] Created {len(bank_accounts)} bank accounts")
    
    return bank_accounts

def init_employees(db: Session, company_id: int):
    """Initialize employees"""
    print("\nInitializing employees...")
    
    employees_data = [
        {"first": "Robert", "last": "Johnson", "display": "Robert Johnson", "email": "robert.j@mainfs.com", "phone": "+1-555-3001", "job_title": "Station Manager", "dept": "Operations", "salary": Decimal("4500.00")},
        {"first": "Sarah", "last": "Williams", "display": "Sarah Williams", "email": "sarah.w@mainfs.com", "phone": "+1-555-3002", "job_title": "Shift Supervisor", "dept": "Operations", "salary": Decimal("3500.00")},
        {"first": "Michael", "last": "Brown", "display": "Michael Brown", "email": "michael.b@mainfs.com", "phone": "+1-555-3003", "job_title": "Cashier", "dept": "Sales", "salary": Decimal("2500.00")},
        {"first": "Lisa", "last": "Davis", "display": "Lisa Davis", "email": "lisa.d@mainfs.com", "phone": "+1-555-3004", "job_title": "Accountant", "dept": "Finance", "salary": Decimal("4000.00")},
    ]
    
    employees = []
    for idx, emp_data in enumerate(employees_data):
        employee = Employee(
            employee_number=f"EMP-{idx+1:04d}",
            first_name=emp_data["first"],
            last_name=emp_data["last"],
            display_name=emp_data["display"],
            email=emp_data["email"],
            phone=emp_data["phone"],
            job_title=emp_data["job_title"],
            department=emp_data["dept"],
            hire_date=date.today() - timedelta(days=365*(idx+1)),  # Hired 1-4 years ago
            salary=emp_data["salary"],
            is_active=True,
            company_id=company_id
        )
        db.add(employee)
        employees.append(employee)
    
    db.flush()
    print(f"[OK] Created {len(employees)} employees")
    
    return employees

def init_tax_codes(db: Session, company_id: int):
    """Initialize Bangladesh-compliant tax codes"""
    print("\nInitializing tax codes (Bangladesh)...")
    
    from app.models.tax import TaxRate
    from decimal import Decimal
    
    # Bangladesh Tax Codes as per NBR (National Board of Revenue)
    tax_codes_data = [
        {
            "code": "VAT-15",
            "name": "Value Added Tax",
            "type": "VAT",
            "desc": "Standard VAT rate for fuel sales as per Bangladesh VAT Act 2012",
            "rates": [
                {"name": "Standard VAT Rate", "rate": Decimal("15.00"), "agency": "NBR"}
            ]
        },
        {
            "code": "SD-PETROL",
            "name": "Supplementary Duty - Petrol",
            "type": "SD",
            "desc": "Supplementary Duty on Petrol/Octane as per Bangladesh Customs Act",
            "rates": [
                {"name": "Petrol SD Rate", "rate": Decimal("37.00"), "agency": "NBR"}
            ]
        },
        {
            "code": "SD-DIESEL",
            "name": "Supplementary Duty - Diesel",
            "type": "SD",
            "desc": "Supplementary Duty on Diesel as per Bangladesh Customs Act",
            "rates": [
                {"name": "Diesel SD Rate", "rate": Decimal("20.00"), "agency": "NBR"}
            ]
        },
        {
            "code": "AIT",
            "name": "Advance Income Tax",
            "type": "AIT",
            "desc": "Advance Income Tax on certain transactions as per Income Tax Ordinance 1984",
            "rates": [
                {"name": "Standard AIT Rate", "rate": Decimal("3.00"), "agency": "NBR"}
            ]
        }
    ]
    
    tax_codes = []
    for tax_data in tax_codes_data:
        # Check if tax code already exists
        existing = db.query(TaxCode).filter(
            TaxCode.code == tax_data["code"],
            TaxCode.company_id == company_id
        ).first()
        
        if existing:
            print(f"  [SKIP] Tax code '{tax_data['code']}' already exists")
            tax_codes.append(existing)
            continue
        
        tax_code = TaxCode(
            code=tax_data["code"],
            name=tax_data["name"],
            tax_type=tax_data["type"],
            description=tax_data["desc"],
            is_active=True,
            company_id=company_id
        )
        db.add(tax_code)
        db.flush()  # Flush to get the ID
        
        # Add tax rates
        for rate_data in tax_data.get("rates", []):
            tax_rate = TaxRate(
                name=rate_data["name"],
                rate=rate_data["rate"],
                tax_agency=rate_data["agency"],
                tax_code_id=tax_code.id,
                company_id=company_id
            )
            db.add(tax_rate)
        
        tax_codes.append(tax_code)
    
    db.commit()
    print(f"[OK] Created {len(tax_codes)} tax codes with rates")
    
    return tax_codes

def main():
    """Main initialization function"""
    print("="*60)
    print("FSMS Database Initialization")
    print("="*60)
    
    # Create tables
    create_tables()
    
    # Create session
    db = SessionLocal()
    
    try:
        # Initialize data
        company = init_company(db)
        users = init_users(db, company.id)
        accounts = init_chart_of_accounts(db, company.id)
        products = init_products(db, company.id)
        station, tanks, island, dispensers, meters, nozzles = init_station_infrastructure(db, company.id, products)
        templates = init_shift_templates(db)
        customers, vendors = init_customers_vendors(db, company.id)
        bank_accounts = init_bank_accounts(db, company.id)
        employees = init_employees(db, company.id)
        tax_codes = init_tax_codes(db, company.id)
        
        # Commit all changes
        db.commit()
        
        print("\n" + "="*60)
        print("DATABASE INITIALIZATION COMPLETE")
        print("="*60)
        print("\nSUMMARY:")
        print(f"  Company: {company.name}")
        print(f"  Users: {len(users)} (admin, accountant, cashier1)")
        print(f"  Chart of Accounts: {len(accounts)} accounts")
        print(f"  Products: {len(products)} items")
        print(f"  Station Infrastructure:")
        print(f"    - 1 Station")
        print(f"    - {len(tanks)} Tanks")
        print(f"    - {len([island])} Island")
        print(f"    - {len(dispensers)} Dispensers")
        print(f"    - {len(meters)} Meters")
        print(f"    - {len(nozzles)} Nozzles")
        print(f"  Shift Templates: {len(templates)}")
        print(f"  Customers: {len(customers)}")
        print(f"  Vendors: {len(vendors)}")
        print(f"  Bank Accounts: {len(bank_accounts)}")
        print(f"  Employees: {len(employees)}")
        print(f"  Tax Codes: {len(tax_codes)}")
        
        print("\nLOGIN CREDENTIALS:")
        print("  Admin:      username: admin      password: admin123")
        print("  Accountant: username: accountant password: acc123")
        print("  Cashier 1:  username: cashier1   password: cash123")
        print("  Cashier 2:  username: cashier2   password: cash123")
        
        print("\nNEXT STEPS:")
        print("  1. Start backend: python -m uvicorn app.main:app --reload")
        print("  2. Access API docs: https://localhost:8000/api/docs")
        print("  3. Access frontend: http://localhost:3000")
        print("\n" + "="*60)
        
    except Exception as e:
        print(f"\n ERROR: {e}")
        db.rollback()
        raise
    finally:
        db.close()

if __name__ == "__main__":
    main()
