"""
Seed script for Master Company / Platform Setup
Creates platform users, subscription plans, and initial setup
"""
import sys
import os

# Add parent directory to path so we can import app
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from decimal import Decimal
from app.db.session import SessionLocal
from app.modules.platform.models import (
    PlatformUser, SubscriptionPlan, PlatformAccount, PlanType
)
from app.core.security import get_password_hash

def seed_master_company():
    """Seed Master Company / Platform setup"""
    db = SessionLocal()
    try:
        print("\n" + "="*60)
        print("Creating Master Company / Platform Setup")
        print("="*60 + "\n")
        
        # ========== Create Platform Users (Super Admins) ==========
        print("Creating Platform Users...")
        platform_users_data = [
            {
                "email": "platform@fmerp.com",
                "password": "Platform@123",
                "full_name": "Platform Super Admin",
                "is_super_admin": True
            },
            {
                "email": "admin@fmerp.com",
                "password": "Admin@123",
                "full_name": "Platform Admin",
                "is_super_admin": False
            },
        ]
        
        for user_data in platform_users_data:
            user = db.query(PlatformUser).filter(
                PlatformUser.email == user_data["email"]
            ).first()
            
            if not user:
                user = PlatformUser(
                    email=user_data["email"],
                    hashed_password=get_password_hash(user_data["password"]),
                    full_name=user_data["full_name"],
                    is_super_admin=user_data["is_super_admin"],
                    is_active=True,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                db.add(user)
                print(f"  [OK] Created platform user: {user_data['email']}")
            else:
                user.hashed_password = get_password_hash(user_data["password"])
                user.full_name = user_data["full_name"]
                user.is_super_admin = user_data["is_super_admin"]
                user.updated_at = datetime.utcnow()
                print(f"  [OK] Updated platform user: {user_data['email']}")
        
        db.flush()
        
        # ========== Create Subscription Plans ==========
        print("\nCreating Subscription Plans...")
        plans_data = [
            {
                "name": "Free",
                "plan_type": PlanType.FREE,
                "description": "Free tier for small businesses",
                "price_monthly": Decimal("0"),
                "price_yearly": Decimal("0"),
                "max_users": 3,
                "max_storage_gb": 5,
                "features": '["Basic ERP", "Up to 3 users", "5GB storage", "Email support"]'
            },
            {
                "name": "Basic",
                "plan_type": PlanType.BASIC,
                "description": "Basic plan for growing businesses",
                "price_monthly": Decimal("2999"),
                "price_yearly": Decimal("29999"),
                "max_users": 10,
                "max_storage_gb": 50,
                "features": '["Full ERP", "Up to 10 users", "50GB storage", "Priority support", "Advanced reporting"]'
            },
            {
                "name": "Professional",
                "plan_type": PlanType.PROFESSIONAL,
                "description": "Professional plan for established businesses",
                "price_monthly": Decimal("9999"),
                "price_yearly": Decimal("99999"),
                "max_users": 50,
                "max_storage_gb": 200,
                "features": '["Full ERP", "Up to 50 users", "200GB storage", "24/7 support", "Advanced analytics", "API access", "Custom integrations"]'
            },
            {
                "name": "Enterprise",
                "plan_type": PlanType.ENTERPRISE,
                "description": "Enterprise plan for large organizations",
                "price_monthly": Decimal("29999"),
                "price_yearly": Decimal("299999"),
                "max_users": None,  # Unlimited
                "max_storage_gb": None,  # Unlimited
                "features": '["Full ERP", "Unlimited users", "Unlimited storage", "Dedicated support", "Custom development", "SLA guarantee", "On-premise option"]'
            },
        ]
        
        created_plans = {}
        for plan_data in plans_data:
            plan = db.query(SubscriptionPlan).filter(
                SubscriptionPlan.name == plan_data["name"]
            ).first()
            
            if not plan:
                plan = SubscriptionPlan(
                    name=plan_data["name"],
                    plan_type=plan_data["plan_type"],
                    description=plan_data["description"],
                    price_monthly=plan_data["price_monthly"],
                    price_yearly=plan_data.get("price_yearly"),
                    max_users=plan_data.get("max_users"),
                    max_storage_gb=plan_data.get("max_storage_gb"),
                    features=plan_data.get("features"),
                    is_active=True,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                db.add(plan)
                created_plans[plan_data["name"]] = plan
                print(f"  [OK] Created plan: {plan_data['name']} - Rs.{plan_data['price_monthly']}/month")
            else:
                created_plans[plan_data["name"]] = plan
        
        db.flush()
        
        # ========== Create Platform Chart of Accounts ==========
        print("\nCreating Platform Chart of Accounts...")
        accounts_data = [
            # Assets
            {"code": "1000", "name": "Cash", "type": "asset", "parent": None},
            {"code": "1100", "name": "Bank Accounts", "type": "asset", "parent": None},
            {"code": "1110", "name": "Operating Account", "type": "asset", "parent": "1100"},
            {"code": "1200", "name": "Accounts Receivable", "type": "asset", "parent": None},
            {"code": "1300", "name": "Fixed Assets", "type": "asset", "parent": None},
            {"code": "1310", "name": "Servers & Infrastructure", "type": "asset", "parent": "1300"},
            {"code": "1320", "name": "Software Licenses", "type": "asset", "parent": "1300"},
            
            # Liabilities
            {"code": "2000", "name": "Accounts Payable", "type": "liability", "parent": None},
            {"code": "2100", "name": "Deferred Revenue", "type": "liability", "parent": None},
            {"code": "2200", "name": "Loans", "type": "liability", "parent": None},
            
            # Equity
            {"code": "3000", "name": "Share Capital", "type": "equity", "parent": None},
            {"code": "3100", "name": "Retained Earnings", "type": "equity", "parent": None},
            
            # Income
            {"code": "4000", "name": "Subscription Revenue", "type": "income", "parent": None},
            {"code": "4100", "name": "Setup Fees", "type": "income", "parent": None},
            {"code": "4200", "name": "Support Revenue", "type": "income", "parent": None},
            {"code": "4300", "name": "Other Income", "type": "income", "parent": None},
            
            # Expenses
            {"code": "5000", "name": "Cost of Services", "type": "expense", "parent": None},
            {"code": "5100", "name": "Server Costs", "type": "expense", "parent": "5000"},
            {"code": "5200", "name": "Cloud Infrastructure", "type": "expense", "parent": "5000"},
            {"code": "5300", "name": "Third-party Services", "type": "expense", "parent": "5000"},
            {"code": "6000", "name": "Operating Expenses", "type": "expense", "parent": None},
            {"code": "6100", "name": "Salaries & Wages", "type": "expense", "parent": "6000"},
            {"code": "6200", "name": "Marketing", "type": "expense", "parent": "6000"},
            {"code": "6300", "name": "Rent & Utilities", "type": "expense", "parent": "6000"},
            {"code": "6400", "name": "Software & Tools", "type": "expense", "parent": "6000"},
            {"code": "6500", "name": "Professional Services", "type": "expense", "parent": "6000"},
        ]
        
        account_map = {}
        for acc_data in accounts_data:
            parent_account = account_map.get(acc_data.get("parent")) if acc_data.get("parent") else None
            account = db.query(PlatformAccount).filter(
                PlatformAccount.code == acc_data["code"]
            ).first()
            
            if not account:
                account = PlatformAccount(
                    code=acc_data["code"],
                    name=acc_data["name"],
                    type=acc_data["type"],
                    parent_id=parent_account.id if parent_account else None,
                    is_active=True,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                db.add(account)
                account_map[acc_data["code"]] = account
                print(f"  [OK] {acc_data['code']} - {acc_data['name']}")
            else:
                account_map[acc_data["code"]] = account
        
        db.flush()
        
        db.commit()
        
        print("\n" + "="*60)
        print("[SUCCESS] Master Company / Platform Setup Completed!")
        print("="*60)
        print(f"\nPlatform Users:")
        print(f"  - platform@fmerp.com / Platform@123 (Super Admin)")
        print(f"  - admin@fmerp.com / Admin@123 (Admin)")
        print(f"\nSubscription Plans Created: {len(created_plans)}")
        print(f"Platform Accounts Created: {len(account_map)}")
        print("\n" + "="*60 + "\n")
        
    except Exception as e:
        db.rollback()
        print(f"\n[ERROR] Error seeding master company: {e}")
        import traceback
        traceback.print_exc()
        raise
    finally:
        db.close()

if __name__ == "__main__":
    seed_master_company()

