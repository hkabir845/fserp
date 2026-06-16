"""
Seed script to create initial data
"""
import sys
import os

# Add parent directory to path so we can import app
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import Session
from datetime import datetime
from decimal import Decimal
from app.db.session import SessionLocal, engine
from app.db.base import Base
from app.modules.tenancy.models import Tenant, User, Role
from app.modules.catalog.models import UOM, Item, ItemCategory
from app.modules.inventory.models import Warehouse
from app.modules.procurement.models import Supplier
from app.modules.sales.models import Customer
from app.modules.accounting.models import Account
from app.core.security import get_password_hash

# Try to import platform models (may not exist in older versions)
try:
    from app.modules.platform.models import PlatformUser
    PLATFORM_AVAILABLE = True
except ImportError:
    PLATFORM_AVAILABLE = False

def init_db():
    """Initialize database"""
    Base.metadata.create_all(bind=engine)

def seed_data():
    """Seed initial data"""
    db = SessionLocal()
    try:
        # Create tenant
        tenant = db.query(Tenant).filter(Tenant.domain == "localhost").first()
        if not tenant:
            tenant = Tenant(
                name="Demo Tenant",
                domain="localhost",
                is_active=True,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(tenant)
            db.flush()
            print(f"Created tenant: {tenant.name}")
        else:
            print(f"Tenant already exists: {tenant.name}")
        
        # Create/Update superadmin user
        admin = db.query(User).filter(
            User.email == "superadmin@fmerp.com",
            User.tenant_id == tenant.id
        ).first()
        if not admin:
            admin = User(
                tenant_id=tenant.id,
                email="superadmin@fmerp.com",
                hashed_password=get_password_hash("Admin@123"),
                full_name="Super Admin",
                is_active=True,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(admin)
            db.flush()
            print(f"Created superadmin user: {admin.email}")
        else:
            # Update existing user with new password
            admin.hashed_password = get_password_hash("Admin@123")
            admin.full_name = "Super Admin"
            admin.updated_at = datetime.utcnow()
            print(f"Updated superadmin user: {admin.email}")
        
        # Create platform user for superadmin if platform module is available
        if PLATFORM_AVAILABLE:
            platform_user = db.query(PlatformUser).filter(
                PlatformUser.email == "superadmin@fmerp.com"
            ).first()
            if not platform_user:
                platform_user = PlatformUser(
                    email="superadmin@fmerp.com",
                    hashed_password=admin.hashed_password,  # Same password
                    full_name="Super Admin",
                    is_super_admin=True,
                    is_active=True,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                db.add(platform_user)
                db.flush()
                print(f"Created platform user for superadmin: {platform_user.email}")
            else:
                # Update password if changed
                platform_user.hashed_password = admin.hashed_password
                platform_user.full_name = "Super Admin"
                platform_user.is_super_admin = True
                platform_user.updated_at = datetime.utcnow()
                print(f"Updated platform user for superadmin: {platform_user.email}")
        
        # Create UOMs
        uoms_data = [
            {"code": "KG", "name": "Kilogram"},
            {"code": "MT", "name": "Metric Ton"},
            {"code": "L", "name": "Liter"},
            {"code": "NOS", "name": "Numbers"},
        ]
        for uom_data in uoms_data:
            uom = db.query(UOM).filter(
                UOM.tenant_id == tenant.id,
                UOM.code == uom_data["code"]
            ).first()
            if not uom:
                uom = UOM(
                    tenant_id=tenant.id,
                    code=uom_data["code"],
                    name=uom_data["name"],
                    created_by=admin.id
                )
                db.add(uom)
        
        db.flush()
        
        # Get UOMs
        kg_uom = db.query(UOM).filter(UOM.tenant_id == tenant.id, UOM.code == "KG").first()
        l_uom = db.query(UOM).filter(UOM.tenant_id == tenant.id, UOM.code == "L").first()
        nos_uom = db.query(UOM).filter(UOM.tenant_id == tenant.id, UOM.code == "NOS").first()
        
        # Create warehouse
        warehouse = db.query(Warehouse).filter(
            Warehouse.tenant_id == tenant.id,
            Warehouse.name == "Main Warehouse"
        ).first()
        if not warehouse:
            warehouse = Warehouse(
                tenant_id=tenant.id,
                name="Main Warehouse",
                address="123 Main St",
                created_by=admin.id
            )
            db.add(warehouse)
            db.flush()
            print("Created warehouse: Main Warehouse")
        
        # Create sample items
        items_data = [
            {"sku": "FEED-001", "name": "Cattle Feed", "type": "finished_good", "uom": kg_uom},
            {"sku": "FLOUR-001", "name": "Wheat Flour", "type": "finished_good", "uom": kg_uom},
            {"sku": "FS-FUEL-DIESEL", "name": "Diesel", "type": "fuel", "uom": l_uom},
        ]
        for item_data in items_data:
            item = db.query(Item).filter(
                Item.tenant_id == tenant.id,
                Item.sku == item_data["sku"]
            ).first()
            if not item:
                item = Item(
                    tenant_id=tenant.id,
                    sku=item_data["sku"],
                    name=item_data["name"],
                    type=item_data["type"],
                    uom_id=item_data["uom"].id,
                    is_stock_tracked=True,
                    is_active=True,
                    created_by=admin.id
                )
                db.add(item)
        
        # Create sample supplier
        supplier = db.query(Supplier).filter(
            Supplier.tenant_id == tenant.id,
            Supplier.name == "ABC Suppliers"
        ).first()
        if not supplier:
            supplier = Supplier(
                tenant_id=tenant.id,
                name="ABC Suppliers",
                phone="1234567890",
                created_by=admin.id
            )
            db.add(supplier)
            print("Created supplier: ABC Suppliers")
        
        # Create sample customer
        customer = db.query(Customer).filter(
            Customer.tenant_id == tenant.id,
            Customer.name == "XYZ Traders"
        ).first()
        if not customer:
            customer = Customer(
                tenant_id=tenant.id,
                name="XYZ Traders",
                phone="0987654321",
                created_by=admin.id
            )
            db.add(customer)
            print("Created customer: XYZ Traders")
        
        # Create chart of accounts
        accounts_data = [
            {"code": "1000", "name": "Cash", "type": "asset"},
            {"code": "1100", "name": "Bank", "type": "asset"},
            {"code": "1200", "name": "Inventory", "type": "asset"},
            {"code": "1300", "name": "Accounts Receivable", "type": "asset"},
            {"code": "2000", "name": "Accounts Payable", "type": "liability"},
            {"code": "2010", "name": "Goods Received Not Invoiced", "type": "liability"},
            {"code": "3000", "name": "Equity", "type": "equity"},
            {"code": "4000", "name": "Sales Revenue", "type": "income"},
            {"code": "5000", "name": "Cost of Goods Sold", "type": "expense"},
            {"code": "6000", "name": "Operating Expenses", "type": "expense"},
        ]
        for acc_data in accounts_data:
            account = db.query(Account).filter(
                Account.tenant_id == tenant.id,
                Account.code == acc_data["code"]
            ).first()
            if not account:
                account = Account(
                    tenant_id=tenant.id,
                    code=acc_data["code"],
                    name=acc_data["name"],
                    type=acc_data["type"],
                    is_active=True,
                    created_by=admin.id
                )
                db.add(account)
        
        db.commit()
        print("Seed data created successfully!")
        
    except Exception as e:
        db.rollback()
        print(f"Error seeding data: {e}")
        raise
    finally:
        db.close()

if __name__ == "__main__":
    print("Initializing database...")
    init_db()
    print("Seeding data...")
    seed_data()
    print("Done!")

