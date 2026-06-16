"""
Seed script for KNB Agro Industries Ltd.
Creates Master Company and Tenant with complete setup
"""
import sys
import os

# Add parent directory to path so we can import app
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import Session
from datetime import datetime
from decimal import Decimal
from app.db.session import SessionLocal
from app.modules.tenancy.models import Tenant, User, Role
from app.modules.catalog.models import UOM, Item, ItemCategory
from app.modules.inventory.models import Warehouse
from app.modules.procurement.models import Supplier
from app.modules.sales.models import Customer
from app.modules.accounting.models import Account
from app.core.security import get_password_hash

# Try to import platform models for subscription
try:
    from app.modules.platform.models import SubscriptionPlan, TenantSubscription, SubscriptionStatus
    PLATFORM_AVAILABLE = True
except ImportError:
    PLATFORM_AVAILABLE = False

def seed_knb_agro():
    """Seed KNB Agro Industries Ltd. - Master Company and Tenant"""
    db = SessionLocal()
    try:
        print("\n" + "="*60)
        print("Creating KNB Agro Industries Ltd. - Master Company Setup")
        print("="*60 + "\n")
        
        # ========== Create Tenant ==========
        tenant_domain = "knbgroup.com.bd"
        tenant = db.query(Tenant).filter(Tenant.domain == tenant_domain).first()
        
        if not tenant:
            tenant = Tenant(
                name="KNB Agro Industries Ltd.",
                domain=tenant_domain,
                is_active=True,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(tenant)
            db.flush()
            print(f"[OK] Created tenant: {tenant.name} (Domain: {tenant.domain})")
        else:
            print(f"[OK] Tenant already exists: {tenant.name}")
        
        # ========== Create Admin User ==========
        admin_email = "admin@knbgroup.com.bd"
        admin = db.query(User).filter(
            User.email == admin_email,
            User.tenant_id == tenant.id
        ).first()
        
        if not admin:
            admin = User(
                tenant_id=tenant.id,
                email=admin_email,
                hashed_password=get_password_hash("Admin@123"),
                full_name="KNB Admin",
                is_active=True,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(admin)
            db.flush()
            print(f"[OK] Created admin user: {admin.email}")
        else:
            admin.hashed_password = get_password_hash("Admin@123")
            admin.full_name = "KNB Admin"
            admin.updated_at = datetime.utcnow()
            print(f"[OK] Updated admin user: {admin.email}")
        
        # ========== Create Roles ==========
        roles_data = [
            {"name": "Super Admin", "description": "Full system access"},
            {"name": "Admin", "description": "Administrative access"},
            {"name": "Manager", "description": "Management access"},
            {"name": "Accountant", "description": "Accounting access"},
            {"name": "Operator", "description": "Operational access"},
        ]
        
        created_roles = {}
        for role_data in roles_data:
            role = db.query(Role).filter(
                Role.tenant_id == tenant.id,
                Role.name == role_data["name"]
            ).first()
            if not role:
                role = Role(
                    tenant_id=tenant.id,
                    name=role_data["name"],
                    description=role_data["description"],
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                db.add(role)
                created_roles[role_data["name"]] = role
                print(f"  [OK] Created role: {role_data['name']}")
        
        db.flush()

        # Requisition approval roles (assign explicitly to users as needed)
        for role_data in [
            {"name": "Sales Person", "description": "Creates sales requisitions"},
            {"name": "Sales Head", "description": "Department approval for sales requisitions"},
            {"name": "Procurement Officer", "description": "Creates purchase requisitions"},
            {"name": "Procurement Head", "description": "Department approval for purchase requisitions"},
            {"name": "General Manager", "description": "Executive approval for requisitions"},
        ]:
            if not db.query(Role).filter(Role.tenant_id == tenant.id, Role.name == role_data["name"]).first():
                db.add(
                    Role(
                        tenant_id=tenant.id,
                        name=role_data["name"],
                        description=role_data["description"],
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow(),
                    )
                )
        db.flush()

        super_admin_role = db.query(Role).filter(Role.tenant_id == tenant.id, Role.name == "Super Admin").first()
        if super_admin_role and super_admin_role not in admin.roles:
            admin.roles.append(super_admin_role)
        
        # ========== Create UOMs (Units of Measure) ==========
        print("\nCreating Units of Measure...")
        uoms_data = [
            {"code": "KG", "name": "Kilogram"},
            {"code": "MT", "name": "Metric Ton"},
            {"code": "TON", "name": "Ton"},
            {"code": "L", "name": "Liter"},
            {"code": "KL", "name": "Kiloliter"},
            {"code": "NOS", "name": "Numbers"},
            {"code": "BAG", "name": "Bag"},
            {"code": "PKT", "name": "Packet"},
            {"code": "BOX", "name": "Box"},
            {"code": "CARTON", "name": "Carton"},
        ]
        
        created_uoms = {}
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
                created_uoms[uom_data["code"]] = uom
                print(f"  [OK] {uom_data['code']} - {uom_data['name']}")
        
        db.flush()
        
        # Get commonly used UOMs
        kg_uom = created_uoms.get("KG") or db.query(UOM).filter(UOM.tenant_id == tenant.id, UOM.code == "KG").first()
        mt_uom = created_uoms.get("MT") or db.query(UOM).filter(UOM.tenant_id == tenant.id, UOM.code == "MT").first()
        l_uom = created_uoms.get("L") or db.query(UOM).filter(UOM.tenant_id == tenant.id, UOM.code == "L").first()
        nos_uom = created_uoms.get("NOS") or db.query(UOM).filter(UOM.tenant_id == tenant.id, UOM.code == "NOS").first()
        
        # ========== Create Item Categories ==========
        print("\nCreating Item Categories...")
        categories_data = [
            {"name": "Raw Materials", "parent_id": None},
            {"name": "Finished Goods", "parent_id": None},
            {"name": "Feed Products", "parent_id": None},
            {"name": "Flour Products", "parent_id": None},
            {"name": "Fuel", "parent_id": None},
            {"name": "Packaging", "parent_id": None},
            {"name": "Spare Parts", "parent_id": None},
        ]
        
        created_categories = {}
        for cat_data in categories_data:
            category = db.query(ItemCategory).filter(
                ItemCategory.tenant_id == tenant.id,
                ItemCategory.name == cat_data["name"]
            ).first()
            if not category:
                category = ItemCategory(
                    tenant_id=tenant.id,
                    name=cat_data["name"],
                    parent_id=cat_data.get("parent_id"),
                    created_by=admin.id
                )
                db.add(category)
                created_categories[cat_data["name"]] = category
                print(f"  [OK] {cat_data['name']}")
        
        db.flush()
        
        # ========== Create Warehouses ==========
        print("\nCreating Warehouses...")
        warehouses_data = [
            {"name": "Main Warehouse", "address": "KNB Agro Industries Ltd., Main Factory, Industrial Area"},
            {"name": "Feed Production Unit", "address": "Feed Manufacturing Unit, KNB Agro Industries Ltd."},
            {"name": "Flour Mill Warehouse", "address": "Flour Mill Unit, KNB Agro Industries Ltd."},
            {"name": "Finished Goods Warehouse", "address": "Finished Goods Storage, KNB Agro Industries Ltd."},
            {"name": "Raw Material Storage", "address": "Raw Material Storage Area, KNB Agro Industries Ltd."},
        ]
        
        created_warehouses = {}
        for wh_data in warehouses_data:
            warehouse = db.query(Warehouse).filter(
                Warehouse.tenant_id == tenant.id,
                Warehouse.name == wh_data["name"]
            ).first()
            if not warehouse:
                warehouse = Warehouse(
                    tenant_id=tenant.id,
                    name=wh_data["name"],
                    address=wh_data["address"],
                    is_active=True,
                    created_by=admin.id
                )
                db.add(warehouse)
                created_warehouses[wh_data["name"]] = warehouse
                print(f"  [OK] {wh_data['name']}")
        
        db.flush()
        
        main_warehouse = created_warehouses.get("Main Warehouse") or db.query(Warehouse).filter(
            Warehouse.tenant_id == tenant.id,
            Warehouse.name == "Main Warehouse"
        ).first()
        
        # ========== Create Master Items ==========
        print("\nCreating Master Items...")
        items_data = [
            # Raw Materials
            {"sku": "RM-WHEAT-001", "name": "Wheat Grain", "type": "raw_material", "uom": kg_uom, "category": "Raw Materials", "stock_tracked": True, "cost": 25.00},
            {"sku": "RM-CORN-001", "name": "Corn Grain", "type": "raw_material", "uom": kg_uom, "category": "Raw Materials", "stock_tracked": True, "cost": 22.00},
            {"sku": "RM-SOYBEAN-001", "name": "Soybean Meal", "type": "raw_material", "uom": kg_uom, "category": "Raw Materials", "stock_tracked": True, "cost": 45.00},
            {"sku": "RM-FISHMEAL-001", "name": "Fish Meal", "type": "raw_material", "uom": kg_uom, "category": "Raw Materials", "stock_tracked": True, "cost": 80.00},
            {"sku": "RM-RICEBRAN-001", "name": "Rice Bran", "type": "raw_material", "uom": kg_uom, "category": "Raw Materials", "stock_tracked": True, "cost": 18.00},
            {"sku": "RM-PALMOIL-001", "name": "Palm Oil", "type": "raw_material", "uom": l_uom, "category": "Raw Materials", "stock_tracked": True, "cost": 65.00},
            {"sku": "RM-FISHOIL-001", "name": "Fish Oil", "type": "raw_material", "uom": l_uom, "category": "Raw Materials", "stock_tracked": True, "cost": 120.00},
            
            # Finished Goods - Feed
            {"sku": "FG-FEED-CATTLE-001", "name": "Cattle Feed Premium", "type": "finished_good", "uom": kg_uom, "category": "Feed Products", "stock_tracked": True, "cost": 35.00},
            {"sku": "FG-FEED-POULTRY-001", "name": "Poultry Starter Feed", "type": "finished_good", "uom": kg_uom, "category": "Feed Products", "stock_tracked": True, "cost": 32.00},
            {"sku": "FG-FEED-FISH-001", "name": "Fish Floating Feed", "type": "finished_good", "uom": kg_uom, "category": "Feed Products", "stock_tracked": True, "cost": 45.00},
            
            # Finished Goods - Flour
            {"sku": "FG-FLOUR-WHEAT-001", "name": "Wheat Flour Premium", "type": "finished_good", "uom": kg_uom, "category": "Flour Products", "stock_tracked": True, "cost": 40.00},
            {"sku": "FG-FLOUR-MAIDA-001", "name": "Maida (Refined Flour)", "type": "finished_good", "uom": kg_uom, "category": "Flour Products", "stock_tracked": True, "cost": 42.00},
            
            # Fuel
            {"sku": "FS-FUEL-DIESEL", "name": "Diesel", "type": "fuel", "uom": l_uom, "category": "Fuel", "stock_tracked": True, "cost": 85.00},
            {"sku": "FUEL-PETROL-001", "name": "Petrol", "type": "fuel", "uom": l_uom, "category": "Fuel", "stock_tracked": True, "cost": 95.00},
            
            # Packaging
            {"sku": "PKG-BAG-50KG-001", "name": "PP Bag 50kg", "type": "raw_material", "uom": nos_uom, "category": "Packaging", "stock_tracked": True, "cost": 15.00},
            {"sku": "PKG-BAG-25KG-001", "name": "PP Bag 25kg", "type": "raw_material", "uom": nos_uom, "category": "Packaging", "stock_tracked": True, "cost": 8.00},
        ]
        
        created_items = {}
        for item_data in items_data:
            item = db.query(Item).filter(
                Item.tenant_id == tenant.id,
                Item.sku == item_data["sku"]
            ).first()
            if not item:
                category = created_categories.get(item_data.get("category"))
                item = Item(
                    tenant_id=tenant.id,
                    sku=item_data["sku"],
                    name=item_data["name"],
                    type=item_data["type"],
                    uom_id=item_data["uom"].id,
                    category_id=category.id if category else None,
                    is_stock_tracked=item_data.get("stock_tracked", True),
                    is_active=True,
                    standard_cost=Decimal(str(item_data.get("cost", 0))) if item_data.get("cost") else None,
                    created_by=admin.id
                )
                db.add(item)
                created_items[item_data["sku"]] = item
                print(f"  [OK] {item_data['sku']} - {item_data['name']}")
        
        db.flush()
        
        # ========== Create Suppliers ==========
        print("\nCreating Suppliers...")
        suppliers_data = [
            {"name": "Agri Supply Co.", "phone": "+91-9876543210", "email": "contact@agrisupply.com", "address": "123 Agricultural Market, City"},
            {"name": "Grain Traders Ltd.", "phone": "+91-9876543211", "email": "sales@graintraders.com", "address": "456 Grain Market, City"},
            {"name": "Oil & Fats Suppliers", "phone": "+91-9876543212", "email": "info@oilfats.com", "address": "789 Oil Market, City"},
            {"name": "Packaging Solutions", "phone": "+91-9876543213", "email": "sales@packaging.com", "address": "321 Industrial Area, City"},
        ]
        
        created_suppliers = {}
        for sup_data in suppliers_data:
            supplier = db.query(Supplier).filter(
                Supplier.tenant_id == tenant.id,
                Supplier.name == sup_data["name"]
            ).first()
            if not supplier:
                supplier = Supplier(
                    tenant_id=tenant.id,
                    name=sup_data["name"],
                    phone=sup_data.get("phone"),
                    email=sup_data.get("email"),
                    address=sup_data.get("address"),
                    is_active=True,
                    created_by=admin.id
                )
                db.add(supplier)
                created_suppliers[sup_data["name"]] = supplier
                print(f"  [OK] {sup_data['name']}")
        
        db.flush()
        
        # ========== Create Customers ==========
        print("\nCreating Customers...")
        customers_data = [
            {"name": "Farm Fresh Distributors", "phone": "+91-9876543220", "email": "orders@farmfresh.com", "address": "100 Distribution Center, City"},
            {"name": "Retail Chain Stores", "phone": "+91-9876543221", "email": "procurement@retailchain.com", "address": "200 Retail Hub, City"},
            {"name": "Bulk Feed Buyers", "phone": "+91-9876543222", "email": "purchase@bulkfeed.com", "address": "300 Bulk Market, City"},
            {"name": "Flour Mill Outlets", "phone": "+91-9876543223", "email": "sales@flouroutlets.com", "address": "400 Mill Market, City"},
        ]
        
        created_customers = {}
        for cust_data in customers_data:
            customer = db.query(Customer).filter(
                Customer.tenant_id == tenant.id,
                Customer.name == cust_data["name"]
            ).first()
            if not customer:
                customer = Customer(
                    tenant_id=tenant.id,
                    name=cust_data["name"],
                    phone=cust_data.get("phone"),
                    email=cust_data.get("email"),
                    address=cust_data.get("address"),
                    is_active=True,
                    created_by=admin.id
                )
                db.add(customer)
                created_customers[cust_data["name"]] = customer
                print(f"  [OK] {cust_data['name']}")
        
        db.flush()
        
        # ========== Create Chart of Accounts ==========
        print("\nCreating Chart of Accounts...")
        accounts_data = [
            # Assets
            {"code": "1000", "name": "Cash", "type": "asset", "parent": None},
            {"code": "1100", "name": "Bank Accounts", "type": "asset", "parent": None},
            {"code": "1110", "name": "Current Account", "type": "asset", "parent": "1100"},
            {"code": "1120", "name": "Savings Account", "type": "asset", "parent": "1100"},
            {"code": "1200", "name": "Inventory", "type": "asset", "parent": None},
            {"code": "1210", "name": "Raw Materials Inventory", "type": "asset", "parent": "1200"},
            {"code": "1220", "name": "Finished Goods Inventory", "type": "asset", "parent": "1200"},
            {"code": "1300", "name": "Accounts Receivable", "type": "asset", "parent": None},
            {"code": "1400", "name": "Fixed Assets", "type": "asset", "parent": None},
            {"code": "1410", "name": "Plant & Machinery", "type": "asset", "parent": "1400"},
            {"code": "1420", "name": "Vehicles", "type": "asset", "parent": "1400"},
            {"code": "1430", "name": "Buildings", "type": "asset", "parent": "1400"},
            
            # Liabilities
            {"code": "2000", "name": "Accounts Payable", "type": "liability", "parent": None},
            {"code": "2010", "name": "Goods Received Not Invoiced", "type": "liability", "parent": None},
            {"code": "2100", "name": "Short Term Loans", "type": "liability", "parent": None},
            {"code": "2200", "name": "Long Term Loans", "type": "liability", "parent": None},
            
            # Equity
            {"code": "3000", "name": "Share Capital", "type": "equity", "parent": None},
            {"code": "3100", "name": "Retained Earnings", "type": "equity", "parent": None},
            
            # Income
            {"code": "4000", "name": "Sales Revenue", "type": "income", "parent": None},
            {"code": "4100", "name": "Feed Sales", "type": "income", "parent": "4000"},
            {"code": "4200", "name": "Flour Sales", "type": "income", "parent": "4000"},
            {"code": "4300", "name": "Other Income", "type": "income", "parent": "4000"},
            
            # Expenses
            {"code": "5000", "name": "Cost of Goods Sold", "type": "expense", "parent": None},
            {"code": "5100", "name": "Raw Material Cost", "type": "expense", "parent": "5000"},
            {"code": "5200", "name": "Manufacturing Cost", "type": "expense", "parent": "5000"},
            {"code": "6000", "name": "Operating Expenses", "type": "expense", "parent": None},
            {"code": "6100", "name": "Salaries & Wages", "type": "expense", "parent": "6000"},
            {"code": "6200", "name": "Rent & Utilities", "type": "expense", "parent": "6000"},
            {"code": "6300", "name": "Transportation", "type": "expense", "parent": "6000"},
            {"code": "6400", "name": "Fuel Expenses", "type": "expense", "parent": "6000"},
            {"code": "6500", "name": "Maintenance", "type": "expense", "parent": "6000"},
        ]
        
        # Create accounts with parent relationships
        account_map = {}
        for acc_data in accounts_data:
            parent_account = account_map.get(acc_data.get("parent")) if acc_data.get("parent") else None
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
                    parent_id=parent_account.id if parent_account else None,
                    is_active=True,
                    created_by=admin.id
                )
                db.add(account)
                account_map[acc_data["code"]] = account
                print(f"  [OK] {acc_data['code']} - {acc_data['name']}")
            else:
                account_map[acc_data["code"]] = account
        
        db.flush()
        
        # ========== Create Subscription (if platform available) ==========
        if PLATFORM_AVAILABLE:
            print("\nCreating Subscription...")
            # Get or create a Professional plan
            plan = db.query(SubscriptionPlan).filter(
                SubscriptionPlan.name == "Professional"
            ).first()
            
            if plan:
                subscription = db.query(TenantSubscription).filter(
                    TenantSubscription.tenant_id == tenant.id
                ).first()
                
                if not subscription:
                    subscription = TenantSubscription(
                        tenant_id=tenant.id,
                        plan_id=plan.id,
                        status=SubscriptionStatus.ACTIVE,
                        start_date=datetime.utcnow(),
                        billing_cycle="monthly",
                        auto_renew=True
                    )
                    db.add(subscription)
                    db.flush()
                    print(f"  [OK] Created subscription: {plan.name} (Status: {subscription.status.value})")
                else:
                    print(f"  [OK] Subscription already exists: {plan.name}")
            else:
                print("  [!] Professional plan not found. Run seed_master_company.py first.")
        
        db.commit()
        
        print("\n" + "="*60)
        print("[SUCCESS] KNB Agro Industries Ltd. Setup Completed Successfully!")
        print("="*60)
        print(f"\nTenant Details:")
        print(f"  Name: {tenant.name}")
        print(f"  Domain: {tenant.domain}")
        print(f"  Admin Email: {admin_email}")
        print(f"  Admin Password: Admin@123")
        print(f"\nCreated:")
        print(f"  - {len(created_roles)} Roles")
        print(f"  - {len(created_uoms)} Units of Measure")
        print(f"  - {len(created_categories)} Item Categories")
        print(f"  - {len(created_warehouses)} Warehouses")
        print(f"  - {len(created_items)} Master Items")
        print(f"  - {len(created_suppliers)} Suppliers")
        print(f"  - {len(created_customers)} Customers")
        print(f"  - {len(account_map)} Chart of Accounts")
        print("\n" + "="*60 + "\n")
        
    except Exception as e:
        db.rollback()
        print(f"\n[ERROR] Error seeding KNB Agro data: {e}")
        import traceback
        traceback.print_exc()
        raise
    finally:
        db.close()

if __name__ == "__main__":
    seed_knb_agro()

