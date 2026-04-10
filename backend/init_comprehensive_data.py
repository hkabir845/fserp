"""
Comprehensive Database Initialization with Complete Dummy Data
QuickBooks-style Filling Station ERP System
"""
import sys
from datetime import datetime, date, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session
from app.database import SessionLocal, engine
from app.models.base import Base
from app.models.company import Company
from app.models.user import User, UserRole
from app.models.station import Station
from app.models.island import Island
from app.models.dispenser import Dispenser
from app.models.meter import Meter
from app.models.nozzle import Nozzle
from app.models.tank import Tank
from app.models.item import Item, ItemType
from app.models.customer import Customer
from app.models.vendor import Vendor
from app.models.employee import Employee
from app.models.chart_of_accounts import ChartOfAccount, AccountType, AccountSubType
from app.models.bank_account import BankAccount
from app.models.journal_entry import JournalEntry, JournalEntryLine
from app.models.subscription import (
    SubscriptionPlan, Subscription, SubscriptionPayment, UsageTracking,
    PlanType, SubscriptionStatus, BillingCycle, PaymentStatus
)
from app.utils.security import get_password_hash
from app.utils.auto_numbering import generate_next_number

def init_database():
    """Initialize database with comprehensive dummy data"""
    
    print("\n" + "="*80)
    print("COMPREHENSIVE DATABASE INITIALIZATION")
    print("QuickBooks-style Filling Station ERP System")
    print("="*80 + "\n")
    
    # Create tables
    print("Creating database tables...")
    Base.metadata.create_all(bind=engine)
    print("[OK] Tables created\n")
    
    db = SessionLocal()
    
    try:
        # =================================================================
        # 1. COMPANY
        # =================================================================
        print("1. Creating Company...")
        company = Company(
            name="Premium Fuel Station Ltd.",
            legal_name="Premium Fuel Station Limited",
            tax_id="TAX-789456123",
            address_line1="123 Main Highway",
            city="Metro City",
            state="State Province",
            postal_code="12345",
            country="United States",
            phone="+1-555-0100",
            email="info@premiumfuel.com",
            website="www.premiumfuel.com",
            currency="USD",
            fiscal_year_start="01-01",
            timezone="America/New_York"
        )
        db.add(company)
        db.flush()
        company_id = company.id
        print(f"[OK] Company created: {company.name} (ID: {company_id})\n")
        
        # =================================================================
        # 2. USERS (Admin, Accountant, Cashiers)
        # =================================================================
        print("2. Creating Users...")
        users_data = [
            {
                "username": "admin",
                "email": "admin@premiumfuel.com",
                "full_name": "System Administrator",
                "password": "admin123",
                "role": UserRole.ADMIN,
                "is_active": True
            },
            {
                "username": "accountant",
                "email": "accountant@premiumfuel.com",
                "full_name": "John Accountant",
                "password": "acc123",
                "role": UserRole.ACCOUNTANT,
                "is_active": True
            },
            {
                "username": "cashier1",
                "email": "cashier1@premiumfuel.com",
                "full_name": "Sarah Cashier",
                "password": "cash123",
                "role": UserRole.CASHIER,
                "is_active": True
            },
            {
                "username": "cashier2",
                "email": "cashier2@premiumfuel.com",
                "full_name": "Mike Cashier",
                "password": "cash123",
                "role": UserRole.CASHIER,
                "is_active": True
            }
        ]
        
        users = []
        for user_data in users_data:
            password = user_data.pop("password")
            user = User(
                **user_data,
                hashed_password=get_password_hash(password),
                company_id=company_id
            )
            db.add(user)
            users.append(user)
            print(f"  [OK] User: {user.username} ({user.role.value})")
        
        db.flush()
        print(f"[OK] {len(users)} users created\n")
        
        # =================================================================
        # 3. CHART OF ACCOUNTS (QuickBooks-style)
        # =================================================================
        print("3. Creating Chart of Accounts (QuickBooks-style)...")
        accounts_data = [
            # ASSETS (1000-1999)
            {"account_number": 1000, "name": "Cash on Hand", "type": AccountType.ASSET, "subtype": AccountSubType.CASH, "balance": Decimal("5000.00")},
            {"account_number": 1010, "name": "Petty Cash", "type": AccountType.ASSET, "subtype": AccountSubType.CASH, "balance": Decimal("500.00")},
            {"account_number": 1020, "name": "Bank Account - Main", "type": AccountType.ASSET, "subtype": AccountSubType.BANK, "balance": Decimal("150000.00")},
            {"account_number": 1030, "name": "Bank Account - Payroll", "type": AccountType.ASSET, "subtype": AccountSubType.BANK, "balance": Decimal("25000.00")},
            {"account_number": 1100, "name": "Accounts Receivable", "type": AccountType.ASSET, "subtype": AccountSubType.ACCOUNTS_RECEIVABLE, "balance": Decimal("45000.00")},
            {"account_number": 1200, "name": "Fuel Inventory - Octane", "type": AccountType.ASSET, "subtype": AccountSubType.INVENTORY, "balance": Decimal("125000.00")},
            {"account_number": 1210, "name": "Fuel Inventory - Diesel", "type": AccountType.ASSET, "subtype": AccountSubType.INVENTORY, "balance": Decimal("98000.00")},
            {"account_number": 1220, "name": "Fuel Inventory - LPG", "type": AccountType.ASSET, "subtype": AccountSubType.INVENTORY, "balance": Decimal("42000.00")},
            {"account_number": 1300, "name": "Prepaid Insurance", "type": AccountType.ASSET, "subtype": AccountSubType.OTHER_CURRENT_ASSETS, "balance": Decimal("12000.00")},
            {"account_number": 1310, "name": "Prepaid Rent", "type": AccountType.ASSET, "subtype": AccountSubType.OTHER_CURRENT_ASSETS, "balance": Decimal("18000.00")},
            {"account_number": 1500, "name": "Land", "type": AccountType.ASSET, "subtype": AccountSubType.FIXED_ASSETS, "balance": Decimal("500000.00")},
            {"account_number": 1510, "name": "Buildings", "type": AccountType.ASSET, "subtype": AccountSubType.FIXED_ASSETS, "balance": Decimal("350000.00")},
            {"account_number": 1520, "name": "Fuel Dispensers & Equipment", "type": AccountType.ASSET, "subtype": AccountSubType.MACHINERY_AND_EQUIPMENT, "balance": Decimal("180000.00")},
            {"account_number": 1530, "name": "Storage Tanks", "type": AccountType.ASSET, "subtype": AccountSubType.MACHINERY_AND_EQUIPMENT, "balance": Decimal("220000.00")},
            {"account_number": 1540, "name": "Vehicles", "type": AccountType.ASSET, "subtype": AccountSubType.VEHICLES, "balance": Decimal("75000.00")},
            {"account_number": 1550, "name": "Accumulated Depreciation", "type": AccountType.ASSET, "subtype": AccountSubType.ACCUMULATED_DEPRECIATION, "balance": Decimal("-95000.00")},
            
            # LIABILITIES (2000-2999)
            {"account_number": 2000, "name": "Accounts Payable", "type": AccountType.LIABILITY, "subtype": AccountSubType.ACCOUNTS_PAYABLE, "balance": Decimal("38000.00")},
            {"account_number": 2100, "name": "Credit Card Payable", "type": AccountType.LIABILITY, "subtype": AccountSubType.CREDIT_CARD, "balance": Decimal("8500.00")},
            {"account_number": 2200, "name": "Sales Tax Payable", "type": AccountType.LIABILITY, "subtype": AccountSubType.OTHER_CURRENT_LIABILITIES, "balance": Decimal("5200.00")},
            {"account_number": 2210, "name": "Payroll Taxes Payable", "type": AccountType.LIABILITY, "subtype": AccountSubType.OTHER_CURRENT_LIABILITIES, "balance": Decimal("4800.00")},
            {"account_number": 2220, "name": "Employee Benefits Payable", "type": AccountType.LIABILITY, "subtype": AccountSubType.OTHER_CURRENT_LIABILITIES, "balance": Decimal("3200.00")},
            {"account_number": 2300, "name": "Short-term Loan", "type": AccountType.LIABILITY, "subtype": AccountSubType.OTHER_CURRENT_LIABILITIES, "balance": Decimal("25000.00")},
            {"account_number": 2500, "name": "Bank Loan - Equipment", "type": AccountType.LIABILITY, "subtype": AccountSubType.LOAN_PAYABLE, "balance": Decimal("120000.00")},
            {"account_number": 2510, "name": "Mortgage Payable", "type": AccountType.LIABILITY, "subtype": AccountSubType.LOAN_PAYABLE, "balance": Decimal("280000.00")},
            
            # EQUITY (3000-3999)
            {"account_number": 3000, "name": "Owner's Capital", "type": AccountType.EQUITY, "subtype": AccountSubType.OWNERS_EQUITY, "balance": Decimal("800000.00")},
            {"account_number": 3100, "name": "Retained Earnings", "type": AccountType.EQUITY, "subtype": AccountSubType.RETAINED_EARNINGS, "balance": Decimal("125000.00")},
            {"account_number": 3200, "name": "Owner's Draw", "type": AccountType.EQUITY, "subtype": AccountSubType.OWNERS_EQUITY, "balance": Decimal("-45000.00")},
            
            # INCOME (4000-4999)
            {"account_number": 4000, "name": "Fuel Sales - Octane", "type": AccountType.INCOME, "subtype": AccountSubType.SALES_REVENUE, "balance": Decimal("0.00")},
            {"account_number": 4010, "name": "Fuel Sales - Diesel", "type": AccountType.INCOME, "subtype": AccountSubType.SALES_REVENUE, "balance": Decimal("0.00")},
            {"account_number": 4020, "name": "Fuel Sales - LPG", "type": AccountType.INCOME, "subtype": AccountSubType.SALES_REVENUE, "balance": Decimal("0.00")},
            {"account_number": 4100, "name": "Service Revenue", "type": AccountType.INCOME, "subtype": AccountSubType.SERVICE_REVENUE, "balance": Decimal("0.00")},
            {"account_number": 4200, "name": "Other Income", "type": AccountType.INCOME, "subtype": AccountSubType.OTHER_INCOME, "balance": Decimal("0.00")},
            {"account_number": 4300, "name": "Interest Income", "type": AccountType.INCOME, "subtype": AccountSubType.OTHER_INCOME, "balance": Decimal("0.00")},
            
            # COST OF GOODS SOLD (5000-5999)
            {"account_number": 5000, "name": "Cost of Fuel Sold - Octane", "type": AccountType.COST_OF_GOODS_SOLD, "subtype": AccountSubType.COST_OF_GOODS_SOLD, "balance": Decimal("0.00")},
            {"account_number": 5010, "name": "Cost of Fuel Sold - Diesel", "type": AccountType.COST_OF_GOODS_SOLD, "subtype": AccountSubType.COST_OF_GOODS_SOLD, "balance": Decimal("0.00")},
            {"account_number": 5020, "name": "Cost of Fuel Sold - LPG", "type": AccountType.COST_OF_GOODS_SOLD, "subtype": AccountSubType.COST_OF_GOODS_SOLD, "balance": Decimal("0.00")},
            {"account_number": 5100, "name": "Freight & Delivery", "type": AccountType.COST_OF_GOODS_SOLD, "subtype": AccountSubType.COST_OF_GOODS_SOLD, "balance": Decimal("0.00")},
            
            # EXPENSES (6000-6999)
            {"account_number": 6000, "name": "Salaries & Wages", "type": AccountType.EXPENSE, "subtype": AccountSubType.PAYROLL_EXPENSES, "balance": Decimal("0.00")},
            {"account_number": 6010, "name": "Employee Benefits", "type": AccountType.EXPENSE, "subtype": AccountSubType.PAYROLL_EXPENSES, "balance": Decimal("0.00")},
            {"account_number": 6020, "name": "Payroll Taxes", "type": AccountType.EXPENSE, "subtype": AccountSubType.PAYROLL_EXPENSES, "balance": Decimal("0.00")},
            {"account_number": 6100, "name": "Rent Expense", "type": AccountType.EXPENSE, "subtype": AccountSubType.RENT_EXPENSE, "balance": Decimal("0.00")},
            {"account_number": 6200, "name": "Utilities - Electricity", "type": AccountType.EXPENSE, "subtype": AccountSubType.UTILITIES, "balance": Decimal("0.00")},
            {"account_number": 6210, "name": "Utilities - Water", "type": AccountType.EXPENSE, "subtype": AccountSubType.UTILITIES, "balance": Decimal("0.00")},
            {"account_number": 6300, "name": "Insurance Expense", "type": AccountType.EXPENSE, "subtype": AccountSubType.INSURANCE, "balance": Decimal("0.00")},
            {"account_number": 6400, "name": "Repairs & Maintenance", "type": AccountType.EXPENSE, "subtype": AccountSubType.REPAIRS_AND_MAINTENANCE, "balance": Decimal("0.00")},
            {"account_number": 6500, "name": "Office Supplies", "type": AccountType.EXPENSE, "subtype": AccountSubType.OFFICE_EXPENSES, "balance": Decimal("0.00")},
            {"account_number": 6600, "name": "Advertising & Marketing", "type": AccountType.EXPENSE, "subtype": AccountSubType.ADVERTISING, "balance": Decimal("0.00")},
            {"account_number": 6700, "name": "Bank Charges", "type": AccountType.EXPENSE, "subtype": AccountSubType.BANK_CHARGES, "balance": Decimal("0.00")},
            {"account_number": 6800, "name": "Interest Expense", "type": AccountType.EXPENSE, "subtype": AccountSubType.INTEREST_EXPENSE, "balance": Decimal("0.00")},
            {"account_number": 6900, "name": "Depreciation Expense", "type": AccountType.EXPENSE, "subtype": AccountSubType.DEPRECIATION, "balance": Decimal("0.00")},
        ]
        
        as_of_date = date(2024, 1, 1)  # Opening balances as of Jan 1, 2024
        
        accounts = []
        for acc_data in accounts_data:
            account = ChartOfAccount(
                **acc_data,
                company_id=company_id,
                opening_balance=acc_data["balance"],
                opening_balance_date=as_of_date,
                description=f"{acc_data['name']} - {acc_data['subtype'].value}",
                is_active=True
            )
            db.add(account)
            accounts.append(account)
        
        db.flush()
        print(f"[OK] {len(accounts)} accounts created with opening balances as of {as_of_date}\n")
        
        # =================================================================
        # 4. BANK ACCOUNTS
        # =================================================================
        print("4. Creating Bank Accounts...")
        bank_accounts_data = [
            {
                "account_name": "Main Operating Account",
                "bank_name": "City Bank",
                "account_number": "1234567890",
                "account_type": "Checking",
                "opening_balance": Decimal("150000.00"),
                "opening_balance_date": as_of_date,
                "current_balance": Decimal("150000.00"),
                "routing_number": "021000021",
                "swift_code": "CITBUS33"
            },
            {
                "account_name": "Payroll Account",
                "bank_name": "City Bank",
                "account_number": "0987654321",
                "account_type": "Checking",
                "opening_balance": Decimal("25000.00"),
                "opening_balance_date": as_of_date,
                "current_balance": Decimal("25000.00"),
                "routing_number": "021000021",
                "swift_code": "CITBUS33"
            },
            {
                "account_name": "Savings Account",
                "bank_name": "National Bank",
                "account_number": "SAV-556677",
                "account_type": "Savings",
                "opening_balance": Decimal("50000.00"),
                "opening_balance_date": as_of_date,
                "current_balance": Decimal("50000.00"),
                "routing_number": "021000089",
                "swift_code": "NATBUS44"
            }
        ]
        
        bank_accounts = []
        for ba_data in bank_accounts_data:
            bank_account = BankAccount(
                **ba_data,
                company_id=company_id,
                is_active=True
            )
            db.add(bank_account)
            bank_accounts.append(bank_account)
            print(f"  [OK] {ba_data['account_name']}: ${ba_data['opening_balance']}")
        
        db.flush()
        print(f"[OK] {len(bank_accounts)} bank accounts created\n")
        
        # =================================================================
        # 5. PRODUCTS (Octane, Diesel, LPG)
        # =================================================================
        print("5. Creating Products (Fuel & Services)...")
        products_data = [
            # FUEL PRODUCTS (Inventory)
            {
                "item_number": "FUEL-001",
                "name": "Premium Octane 95",
                "description": "High-grade premium octane fuel 95 RON",
                "item_type": ItemType.INVENTORY,
                "unit_price": Decimal("4.50"),
                "cost": Decimal("3.20"),
                "quantity_on_hand": Decimal("35000.00"),
                "unit": "Liters"
            },
            {
                "item_number": "FUEL-002",
                "name": "Regular Diesel",
                "description": "Standard diesel fuel",
                "item_type": ItemType.INVENTORY,
                "unit_price": Decimal("3.80"),
                "cost": Decimal("2.80"),
                "quantity_on_hand": Decimal("42000.00"),
                "unit": "Liters"
            },
            {
                "item_number": "FUEL-003",
                "name": "LPG (Liquefied Petroleum Gas)",
                "description": "Autogas LPG for vehicles",
                "item_type": ItemType.INVENTORY,
                "unit_price": Decimal("2.50"),
                "cost": Decimal("1.80"),
                "quantity_on_hand": Decimal("18000.00"),
                "unit": "Liters"
            },
            # SERVICES (Non-inventory)
            {
                "item_number": "SRV-001",
                "name": "Oil Change Service",
                "description": "Complete engine oil change",
                "item_type": ItemType.SERVICE,
                "unit_price": Decimal("45.00"),
                "cost": Decimal("25.00"),
                "quantity_on_hand": Decimal("0.00"),
                "unit": "Service"
            },
            {
                "item_number": "SRV-002",
                "name": "Car Wash - Basic",
                "description": "Basic exterior car wash",
                "item_type": ItemType.SERVICE,
                "unit_price": Decimal("15.00"),
                "cost": Decimal("5.00"),
                "quantity_on_hand": Decimal("0.00"),
                "unit": "Service"
            },
            {
                "item_number": "SRV-003",
                "name": "Tire Air Pressure Check",
                "description": "Check and adjust tire pressure",
                "item_type": ItemType.SERVICE,
                "unit_price": Decimal("5.00"),
                "cost": Decimal("1.00"),
                "quantity_on_hand": Decimal("0.00"),
                "unit": "Service"
            },
            # NON-INVENTORY ITEMS
            {
                "item_number": "ITM-001",
                "name": "Windshield Washer Fluid",
                "description": "1L windshield washer fluid",
                "item_type": ItemType.NON_INVENTORY,
                "unit_price": Decimal("8.00"),
                "cost": Decimal("4.00"),
                "quantity_on_hand": Decimal("0.00"),
                "unit": "Bottle"
            },
        ]
        
        products = []
        for prod_data in products_data:
            product = Item(
                **prod_data,
                company_id=company_id,
                is_active=True
            )
            db.add(product)
            products.append(product)
            print(f"  [OK] {prod_data['name']} ({prod_data['item_type'].value}): ${prod_data['unit_price']}/{prod_data['unit']}")
        
        db.flush()
        print(f"[OK] {len(products)} products created\n")
        
        # =================================================================
        # 6. STATION INFRASTRUCTURE
        # =================================================================
        print("6. Creating Station Infrastructure...")
        
        # 6.1 Station
        print("  6.1 Creating Station...")
        station = Station(
            station_number="STN-0001",
            station_name="Main Station - Highway 101",
            address_line1="101 Highway Road",
            city="Metro City",
            state="State Province",
            postal_code="12345",
            phone="+1-555-0101",
            company_id=company_id,
            is_active=True
        )
        db.add(station)
        db.flush()
        print(f"    [OK] Station: {station.station_name} ({station.station_number})")
        
        # 6.2 Tanks (3 tanks for 3 fuel types)
        print("  6.2 Creating Storage Tanks...")
        tanks_data = [
            {
                "tank_number": "TNK-0001",
                "tank_name": "Octane Storage Tank",
                "product": products[0],  # Premium Octane
                "capacity": Decimal("50000.00"),
                "current_stock": Decimal("35000.00"),
                "min_level": Decimal("5000.00")
            },
            {
                "tank_number": "TNK-0002",
                "tank_name": "Diesel Storage Tank",
                "product": products[1],  # Regular Diesel
                "capacity": Decimal("60000.00"),
                "current_stock": Decimal("42000.00"),
                "min_level": Decimal("8000.00")
            },
            {
                "tank_number": "TNK-0003",
                "tank_name": "LPG Storage Tank",
                "product": products[2],  # LPG
                "capacity": Decimal("30000.00"),
                "current_stock": Decimal("18000.00"),
                "min_level": Decimal("3000.00")
            }
        ]
        
        tanks = []
        for tank_data in tanks_data:
            product = tank_data.pop("product")
            tank = Tank(
                **tank_data,
                station_id=station.id,
                product_id=product.id,
                company_id=company_id,
                is_active=1
            )
            db.add(tank)
            tanks.append(tank)
            print(f"    [OK] Tank: {tank.tank_name} ({tank.tank_number}) - {product.name}")
        
        db.flush()
        
        # 6.3 Islands (2 islands)
        print("  6.3 Creating Islands...")
        islands_data = [
            {
                "island_number": "ISL-0001",
                "island_name": "Island 1 - North Side",
                "location_description": "North side of station, near entrance"
            },
            {
                "island_number": "ISL-0002",
                "island_name": "Island 2 - South Side",
                "location_description": "South side of station, near exit"
            }
        ]
        
        islands = []
        for island_data in islands_data:
            island = Island(
                **island_data,
                station_id=station.id,
                company_id=company_id,
                is_active=True
            )
            db.add(island)
            islands.append(island)
            print(f"    [OK] Island: {island.island_name} ({island.island_number})")
        
        db.flush()
        
        # 6.4 Dispensers (4 dispensers, 2 per island)
        print("  6.4 Creating Dispensers...")
        dispensers_data = [
            {"dispenser_number": "DSP-0001", "dispenser_name": "Dispenser 1A", "island": islands[0], "model": "Wayne Vista", "serial": "WV-2024-001"},
            {"dispenser_number": "DSP-0002", "dispenser_name": "Dispenser 1B", "island": islands[0], "model": "Wayne Vista", "serial": "WV-2024-002"},
            {"dispenser_number": "DSP-0003", "dispenser_name": "Dispenser 2A", "island": islands[1], "model": "Gilbarco Encore", "serial": "GE-2024-003"},
            {"dispenser_number": "DSP-0004", "dispenser_name": "Dispenser 2B", "island": islands[1], "model": "Gilbarco Encore", "serial": "GE-2024-004"},
        ]
        
        dispensers = []
        for disp_data in dispensers_data:
            island = disp_data.pop("island")
            dispenser = Dispenser(
                **disp_data,
                island_id=island.id,
                company_id=company_id,
                is_active=True,
                manufacturer="Wayne/Gilbarco"
            )
            db.add(dispenser)
            dispensers.append(dispenser)
            print(f"    [OK] Dispenser: {dispenser.dispenser_name} ({dispenser.dispenser_number}) on {island.island_name}")
        
        db.flush()
        
        # 6.5 Meters (12 meters, 3 per dispenser for 3 fuel types)
        print("  6.5 Creating Flow Meters...")
        meters_data = [
            # Dispenser 1A (DSP-0001) - 3 meters
            {"meter_number": "MTR-0001", "meter_name": "Meter 1A-Octane", "dispenser": dispensers[0], "opening_reading": Decimal("10000.00")},
            {"meter_number": "MTR-0002", "meter_name": "Meter 1A-Diesel", "dispenser": dispensers[0], "opening_reading": Decimal("8500.00")},
            {"meter_number": "MTR-0003", "meter_name": "Meter 1A-LPG", "dispenser": dispensers[0], "opening_reading": Decimal("5200.00")},
            
            # Dispenser 1B (DSP-0002) - 3 meters
            {"meter_number": "MTR-0004", "meter_name": "Meter 1B-Octane", "dispenser": dispensers[1], "opening_reading": Decimal("9800.00")},
            {"meter_number": "MTR-0005", "meter_name": "Meter 1B-Diesel", "dispenser": dispensers[1], "opening_reading": Decimal("11200.00")},
            {"meter_number": "MTR-0006", "meter_name": "Meter 1B-LPG", "dispenser": dispensers[1], "opening_reading": Decimal("4800.00")},
            
            # Dispenser 2A (DSP-0003) - 3 meters
            {"meter_number": "MTR-0007", "meter_name": "Meter 2A-Octane", "dispenser": dispensers[2], "opening_reading": Decimal("7500.00")},
            {"meter_number": "MTR-0008", "meter_name": "Meter 2A-Diesel", "dispenser": dispensers[2], "opening_reading": Decimal("9300.00")},
            {"meter_number": "MTR-0009", "meter_name": "Meter 2A-LPG", "dispenser": dispensers[2], "opening_reading": Decimal("6100.00")},
            
            # Dispenser 2B (DSP-0004) - 3 meters
            {"meter_number": "MTR-0010", "meter_name": "Meter 2B-Octane", "dispenser": dispensers[3], "opening_reading": Decimal("8900.00")},
            {"meter_number": "MTR-0011", "meter_name": "Meter 2B-Diesel", "dispenser": dispensers[3], "opening_reading": Decimal("10500.00")},
            {"meter_number": "MTR-0012", "meter_name": "Meter 2B-LPG", "dispenser": dispensers[3], "opening_reading": Decimal("5500.00")},
        ]
        
        meters = []
        for meter_data in meters_data:
            dispenser = meter_data.pop("dispenser")
            meter = Meter(
                **meter_data,
                dispenser_id=dispenser.id,
                current_reading=meter_data["opening_reading"],
                company_id=company_id
            )
            db.add(meter)
            meters.append(meter)
            print(f"    [OK] Meter: {meter.meter_name} ({meter.meter_number})")
        
        db.flush()
        
        # 6.6 Nozzles (12 nozzles, 1 per meter - 1-to-1 relationship)
        print("  6.6 Creating Nozzles (1 Nozzle per Meter)...")
        nozzles_data = [
            # Octane nozzles
            {"nozzle_name": "Premium Octane Nozzle 1", "meter": meters[0], "tank": tanks[0], "color": "#FF6B35"},
            {"nozzle_name": "Premium Octane Nozzle 2", "meter": meters[3], "tank": tanks[0], "color": "#FF6B35"},
            {"nozzle_name": "Premium Octane Nozzle 3", "meter": meters[6], "tank": tanks[0], "color": "#FF6B35"},
            {"nozzle_name": "Premium Octane Nozzle 4", "meter": meters[9], "tank": tanks[0], "color": "#FF6B35"},
            
            # Diesel nozzles
            {"nozzle_name": "Diesel Nozzle 1", "meter": meters[1], "tank": tanks[1], "color": "#4ECDC4"},
            {"nozzle_name": "Diesel Nozzle 2", "meter": meters[4], "tank": tanks[1], "color": "#4ECDC4"},
            {"nozzle_name": "Diesel Nozzle 3", "meter": meters[7], "tank": tanks[1], "color": "#4ECDC4"},
            {"nozzle_name": "Diesel Nozzle 4", "meter": meters[10], "tank": tanks[1], "color": "#4ECDC4"},
            
            # LPG nozzles
            {"nozzle_name": "LPG Nozzle 1", "meter": meters[2], "tank": tanks[2], "color": "#FFE66D"},
            {"nozzle_name": "LPG Nozzle 2", "meter": meters[5], "tank": tanks[2], "color": "#FFE66D"},
            {"nozzle_name": "LPG Nozzle 3", "meter": meters[8], "tank": tanks[2], "color": "#FFE66D"},
            {"nozzle_name": "LPG Nozzle 4", "meter": meters[11], "tank": tanks[2], "color": "#FFE66D"},
        ]
        
        nozzles = []
        for idx, nozzle_data in enumerate(nozzles_data):
            meter = nozzle_data.pop("meter")
            tank = nozzle_data.pop("tank")
            color = nozzle_data.pop("color")
            
            # Auto-generate nozzle number based on meter (1-to-1 relationship)
            meter_seq = meter.meter_number.split('-')[-1]
            nozzle_number = f"NOZ-{meter_seq}-A"
            
            nozzle = Nozzle(
                nozzle_number=nozzle_number,
                nozzle_name=nozzle_data["nozzle_name"],
                meter_id=meter.id,
                tank_id=tank.id,
                color_code=color,
                company_id=company_id,
                is_operational="Y"
            )
            db.add(nozzle)
            nozzles.append(nozzle)
            print(f"    [OK] Nozzle: {nozzle.nozzle_name} ({nozzle.nozzle_number}) → Meter {meter.meter_number} → Tank {tank.tank_name}")
        
        db.flush()
        print(f"[OK] Station infrastructure complete: 1 station, 3 tanks, 2 islands, 4 dispensers, 12 meters, 12 nozzles\n")
        
        # =================================================================
        # 7. CUSTOMERS (with opening balances)
        # =================================================================
        print("7. Creating Customers with Opening Balances...")
        customers_data = [
            {
                "customer_number": "CUST-0001",
                "display_name": "ABC Transport Company",
                "company_name": "ABC Transport Co.",
                "email": "accounts@abctransport.com",
                "phone": "+1-555-1001",
                "billing_address_line1": "100 Business Park",
                "billing_city": "Metro City",
                "opening_balance": Decimal("15000.00"),
                "opening_balance_date": as_of_date
            },
            {
                "customer_number": "CUST-0002",
                "display_name": "Metro Logistics Ltd",
                "company_name": "Metro Logistics Ltd.",
                "email": "billing@metrologistics.com",
                "phone": "+1-555-1002",
                "billing_address_line1": "250 Industrial Ave",
                "billing_city": "Metro City",
                "opening_balance": Decimal("22000.00"),
                "opening_balance_date": as_of_date
            },
            {
                "customer_number": "CUST-0003",
                "display_name": "City Taxi Service",
                "company_name": "City Taxi Service Inc.",
                "email": "admin@citytaxi.com",
                "phone": "+1-555-1003",
                "billing_address_line1": "45 Taxi Stand Road",
                "billing_city": "Metro City",
                "opening_balance": Decimal("8000.00"),
                "opening_balance_date": as_of_date
            },
            {
                "customer_number": "CUST-0004",
                "display_name": "Walk-in Customers",
                "company_name": "Cash Customers",
                "email": "cashier@premiumfuel.com",
                "phone": "+1-555-0100",
                "billing_address_line1": "Walk-in",
                "billing_city": "Metro City",
                "opening_balance": Decimal("0.00"),
                "opening_balance_date": as_of_date
            }
        ]
        
        customers = []
        for cust_data in customers_data:
            customer = Customer(
                **cust_data,
                company_id=company_id,
                is_active=True
            )
            db.add(customer)
            customers.append(customer)
            print(f"  [OK] Customer: {cust_data['display_name']} - Opening Balance: ${cust_data['opening_balance']}")
        
        db.flush()
        print(f"[OK] {len(customers)} customers created\n")
        
        # =================================================================
        # 8. VENDORS (with opening balances)
        # =================================================================
        print("8. Creating Vendors with Opening Balances...")
        vendors_data = [
            {
                "vendor_code": "VEND-0001",
                "display_name": "Global Fuel Suppliers Inc",
                "company_name": "Global Fuel Suppliers Inc.",
                "email": "sales@globalfuel.com",
                "phone": "+1-555-2001",
                "billing_address_line1": "500 Refinery Road",
                "billing_city": "Port City",
                "opening_balance": Decimal("28000.00"),
                "opening_balance_date": as_of_date,
                "payment_terms": "Net 30"
            },
            {
                "vendor_code": "VEND-0002",
                "display_name": "LPG Distributors LLC",
                "company_name": "LPG Distributors LLC",
                "email": "accounts@lpgdist.com",
                "phone": "+1-555-2002",
                "billing_address_line1": "300 Gas Plant Ave",
                "billing_city": "Industrial City",
                "opening_balance": Decimal("10000.00"),
                "opening_balance_date": as_of_date,
                "payment_terms": "Net 15"
            },
            {
                "vendor_code": "VEND-0003",
                "display_name": "Equipment Maintenance Co",
                "company_name": "Equipment Maintenance Co.",
                "email": "service@equipmaint.com",
                "phone": "+1-555-2003",
                "billing_address_line1": "75 Service Center",
                "billing_city": "Metro City",
                "opening_balance": Decimal("0.00"),
                "opening_balance_date": as_of_date,
                "payment_terms": "Due on Receipt"
            }
        ]
        
        vendors = []
        for vend_data in vendors_data:
            vendor = Vendor(
                **vend_data,
                company_id=company_id,
                is_active=True
            )
            db.add(vendor)
            vendors.append(vendor)
            print(f"  [OK] Vendor: {vend_data['display_name']} - Opening Balance: ${vend_data['opening_balance']}")
        
        db.flush()
        print(f"[OK] {len(vendors)} vendors created\n")
        
        # =================================================================
        # 9. EMPLOYEES
        # =================================================================
        print("9. Creating Employees...")
        employees_data = [
            {
                "employee_code": "EMP-0001",
                "full_name": "John Accountant",
                "email": "accountant@premiumfuel.com",
                "phone": "+1-555-3001",
                "position": "Accountant",
                "department": "Finance",
                "hire_date": date(2023, 3, 15),
                "salary": Decimal("4500.00"),
                "employment_type": "Full-time"
            },
            {
                "employee_code": "EMP-0002",
                "full_name": "Sarah Cashier",
                "email": "cashier1@premiumfuel.com",
                "phone": "+1-555-3002",
                "position": "Cashier",
                "department": "Operations",
                "hire_date": date(2023, 6, 1),
                "salary": Decimal("2800.00"),
                "employment_type": "Full-time"
            },
            {
                "employee_code": "EMP-0003",
                "full_name": "Mike Cashier",
                "email": "cashier2@premiumfuel.com",
                "phone": "+1-555-3003",
                "position": "Cashier",
                "department": "Operations",
                "hire_date": date(2023, 6, 1),
                "salary": Decimal("2800.00"),
                "employment_type": "Full-time"
            },
            {
                "employee_code": "EMP-0004",
                "full_name": "Tom Supervisor",
                "email": "supervisor@premiumfuel.com",
                "phone": "+1-555-3004",
                "position": "Station Supervisor",
                "department": "Operations",
                "hire_date": date(2022, 9, 1),
                "salary": Decimal("3800.00"),
                "employment_type": "Full-time"
            }
        ]
        
        employees = []
        for emp_data in employees_data:
            employee = Employee(
                **emp_data,
                company_id=company_id,
                is_active=True
            )
            db.add(employee)
            employees.append(employee)
            print(f"  [OK] Employee: {emp_data['full_name']} - {emp_data['position']} (${emp_data['salary']}/month)")
        
        db.flush()
        print(f"[OK] {len(employees)} employees created\n")
        
        # =================================================================
        # 10. JOURNAL ENTRIES (Sample Accounting Entries)
        # =================================================================
        print("10. Creating Sample Journal Entries...")
        
        # Helper function to generate journal entry number
        def get_next_journal_entry_number():
            return generate_next_number(db, JournalEntry, 'entry_number', 'JE', 4, company_id)
        
        # Get admin user for created_by
        admin_user = next((u for u in users if u.role == UserRole.ADMIN), users[0])
        
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
        
        # Entry 1 Lines: Debit Office Supplies, Credit Accounts Payable
        office_supplies_account = next((a for a in accounts if a.account_number == 6500), None)
        accounts_payable_account = next((a for a in accounts if a.account_number == 2000), None)
        
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
        
        # Entry 2 Lines: Debit Depreciation Expense, Credit Accumulated Depreciation
        depreciation_expense_account = next((a for a in accounts if a.account_number == 6900), None)
        accumulated_depreciation_account = next((a for a in accounts if a.account_number == 1550), None)
        
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
        
        # Entry 3 Lines: Debit Rent Expense, Credit Bank Account
        rent_expense_account = next((a for a in accounts if a.account_number == 6100), None)
        bank_account = next((a for a in accounts if a.account_number == 1020), None)
        
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
        
        # Entry 4 Lines: Debit Utilities Expense, Credit Accounts Payable
        utilities_expense_account = next((a for a in accounts if a.account_number == 6200), None)
        
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
        
        # Entry 5 Lines: Debit Owner's Draw, Credit Bank Account
        owners_draw_account = next((a for a in accounts if a.account_number == 3200), None)
        
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
        
        db.flush()
        print(f"[OK] 5 sample journal entries created\n")
        
        # =================================================================
        # 11. SUBSCRIPTION PLANS (SaaS Plans)
        # =================================================================
        print("11. Creating Subscription Plans...")
        
        plans_data = [
            {
                "plan_code": "FREE",
                "plan_name": "Free Plan",
                "plan_type": PlanType.FREE,
                "description": "Perfect for getting started. Try all features with basic limits.",
                "price_monthly": Decimal("0.00"),
                "price_quarterly": Decimal("0.00"),
                "price_yearly": Decimal("0.00"),
                "currency": "USD",
                "features": ["basic_erp", "single_station", "basic_reporting"],
                "limits": {"stations": 1, "users": 3, "storage_gb": 1},
                "trial_days": 14,
                "is_featured": False,
                "display_order": 1,
                "is_active": True
            },
            {
                "plan_code": "BASIC",
                "plan_name": "Basic Plan",
                "plan_type": PlanType.BASIC,
                "description": "For small filling stations. Manage one location with essential features.",
                "price_monthly": Decimal("49.00"),
                "price_quarterly": Decimal("135.00"),  # 10% discount
                "price_yearly": Decimal("490.00"),  # ~17% discount
                "currency": "USD",
                "features": ["full_erp", "single_station", "advanced_reporting", "email_support", "api_access"],
                "limits": {"stations": 1, "users": 5, "storage_gb": 10},
                "trial_days": 14,
                "is_featured": True,
                "display_order": 2,
                "is_active": True
            },
            {
                "plan_code": "PROFESSIONAL",
                "plan_name": "Professional Plan",
                "plan_type": PlanType.PROFESSIONAL,
                "description": "For growing businesses. Multiple locations with advanced features.",
                "price_monthly": Decimal("149.00"),
                "price_quarterly": Decimal("405.00"),  # 10% discount
                "price_yearly": Decimal("1490.00"),  # ~17% discount
                "currency": "USD",
                "features": ["full_erp", "multi_station", "advanced_reporting", "priority_support", "api_access", "custom_reports", "export_data"],
                "limits": {"stations": 5, "users": 20, "storage_gb": 100},
                "trial_days": 14,
                "is_featured": True,
                "display_order": 3,
                "is_active": True
            },
            {
                "plan_code": "ENTERPRISE",
                "plan_name": "Enterprise Plan",
                "plan_type": PlanType.ENTERPRISE,
                "description": "For large operations. Unlimited locations with premium features and dedicated support.",
                "price_monthly": Decimal("499.00"),
                "price_quarterly": Decimal("1347.00"),  # 10% discount
                "price_yearly": Decimal("4990.00"),  # ~17% discount
                "currency": "USD",
                "features": ["full_erp", "unlimited_stations", "advanced_reporting", "dedicated_support", "api_access", "custom_reports", "export_data", "custom_integrations", "white_label"],
                "limits": {"stations": -1, "users": -1, "storage_gb": -1},  # -1 means unlimited
                "trial_days": 30,
                "is_featured": False,
                "display_order": 4,
                "is_active": True
            }
        ]
        
        plans = []
        for plan_data in plans_data:
            plan = SubscriptionPlan(**plan_data)
            db.add(plan)
            plans.append(plan)
            print(f"  [OK] Plan: {plan.plan_name} ({plan.plan_code}) - ${plan.price_monthly}/month")
        
        db.flush()
        print(f"[OK] {len(plans)} subscription plans created\n")
        
        # =================================================================
        # 12. CREATE DEFAULT SUBSCRIPTION FOR COMPANY
        # =================================================================
        print("12. Creating Default Subscription...")
        
        # Get the Professional plan (or first active plan)
        default_plan = next((p for p in plans if p.plan_code == "PROFESSIONAL"), plans[0] if plans else None)
        
        if default_plan:
            # Create subscription for the company
            today = date.today()
            trial_end = today + timedelta(days=default_plan.trial_days) if default_plan.trial_days > 0 else None
            
            subscription = Subscription(
                company_id=company_id,
                plan_id=default_plan.id,
                status=SubscriptionStatus.TRIAL if default_plan.trial_days > 0 else SubscriptionStatus.ACTIVE,
                billing_cycle=BillingCycle.MONTHLY,
                price=default_plan.price_monthly,
                trial_start_date=today if default_plan.trial_days > 0 else None,
                trial_end_date=trial_end,
                current_period_start=today,
                current_period_end=today + timedelta(days=30),
                cancel_at_period_end=False
            )
            
            db.add(subscription)
            db.flush()
            print(f"  [OK] Subscription created: {default_plan.plan_name} (Status: {subscription.status.value})")
            print(f"[OK] Default subscription created\n")
        
        # =================================================================
        # COMMIT ALL DATA
        # =================================================================
        print("Committing all data to database...")
        db.commit()
        print("[OK] All data committed successfully!\n")
        
        # =================================================================
        # SUMMARY
        # =================================================================
        print("="*80)
        print("DATABASE INITIALIZATION COMPLETE")
        print("="*80)
        print(f"\nCompany:           {company.name}")
        print(f"Users:             {len(users)}")
        print(f"Chart of Accounts: {len(accounts)}")
        print(f"Bank Accounts:     {len(bank_accounts)}")
        print(f"Products/Services: {len(products)}")
        print(f"  - Fuel Products: 3 (Octane, Diesel, LPG)")
        print(f"  - Services:      3")
        print(f"  - Other Items:   1")
        print(f"\nStation Infrastructure:")
        print(f"  - Stations:      1")
        print(f"  - Storage Tanks: 3")
        print(f"  - Islands:       2")
        print(f"  - Dispensers:    4")
        print(f"  - Meters:        12")
        print(f"  - Nozzles:       12 (1-to-1 with meters)")
        print(f"\nCustomers:         {len(customers)}")
        print(f"Vendors:           {len(vendors)}")
        print(f"Employees:         {len(employees)}")
        print(f"Journal Entries:   5 (4 posted, 1 unposted)")
        print(f"Subscription Plans: 4 (Free, Basic, Professional, Enterprise)")
        print(f"Default Subscription: Professional Plan (Trial)")
        print(f"\n Opening Balances: As of {as_of_date}")
        print(f"  - Total Assets:    $1,693,200.00")
        print(f"  - Total Liabilities: $484,700.00")
        print(f"  - Total Equity:    $880,000.00")
        print(f"\nLogin Credentials:")
        print(f"  Admin:       admin / admin123")
        print(f"  Accountant:  accountant / acc123")
        print(f"  Cashier 1:   cashier1 / cash123")
        print(f"  Cashier 2:   cashier2 / cash123")
        print("\n" + "="*80)
        print("READY FOR OPERATIONS!")
        print("="*80 + "\n")
        
    except Exception as e:
        print(f"\nERROR: {str(e)}")
        db.rollback()
        raise
    finally:
        db.close()

if __name__ == "__main__":
    init_database()

