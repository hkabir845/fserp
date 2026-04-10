"""
Create Tenant Companies with Subscriptions and Invoices
Creates Adib Filling Station and Bismillah Filling Station as tenants
with complete subscription data, invoices, and payment history
"""
import sys
from datetime import datetime, date, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models.company import Company
from app.models.subscription import (
    SubscriptionPlan, Subscription, SubscriptionPayment, UsageTracking,
    PlanType, SubscriptionStatus, BillingCycle, PaymentStatus
)


def get_or_create_company(db: Session, name: str, legal_name: str, **kwargs) -> Company:
    """Get existing company or create new one"""
    company = db.query(Company).filter(
        Company.name == name,
        Company.is_deleted == False
    ).first()
    
    if company:
        # Update to ensure it's a tenant (not master)
        company.is_master = "false"
        company.legal_name = legal_name
        for key, value in kwargs.items():
            if hasattr(company, key):
                setattr(company, key, value)
        db.commit()
        db.refresh(company)
        print(f"[OK] Found existing company: {company.name} (ID: {company.id})")
        return company
    
    # Create new company - ensure is_master is set to false
    kwargs['is_master'] = "false"  # Ensure it's a tenant
    company = Company(
        name=name,
        legal_name=legal_name,
        **kwargs
    )
    db.add(company)
    db.flush()
    print(f"[OK] Created company: {company.name} (ID: {company.id})")
    return company


def get_or_create_plan(db: Session, plan_code: str, **kwargs) -> SubscriptionPlan:
    """Get existing plan or create new one"""
    plan = db.query(SubscriptionPlan).filter(
        SubscriptionPlan.plan_code == plan_code,
        SubscriptionPlan.is_deleted == False
    ).first()
    
    if plan:
        print(f"[OK] Found existing plan: {plan.plan_name} (Code: {plan.plan_code})")
        return plan
    
    # Ensure plan_code is in kwargs
    kwargs['plan_code'] = plan_code
    plan = SubscriptionPlan(**kwargs)
    db.add(plan)
    db.flush()
    print(f"[OK] Created plan: {plan.plan_name} (Code: {plan.plan_code})")
    return plan


def create_subscription(
    db: Session,
    company: Company,
    plan: SubscriptionPlan,
    billing_cycle: BillingCycle,
    status: SubscriptionStatus = SubscriptionStatus.ACTIVE,
    days_from_now: int = 0,
    duration_days: int = 30
) -> Subscription:
    """Create or update subscription for company"""
    # Check if subscription exists
    subscription = db.query(Subscription).filter(
        Subscription.company_id == company.id,
        Subscription.is_deleted == False
    ).first()
    
    today = date.today() + timedelta(days=days_from_now)
    period_end = today + timedelta(days=duration_days)
    
    # Calculate price based on billing cycle
    if billing_cycle == BillingCycle.MONTHLY:
        price = plan.price_monthly
    elif billing_cycle == BillingCycle.QUARTERLY:
        price = plan.price_quarterly
    elif billing_cycle == BillingCycle.YEARLY:
        price = plan.price_yearly
    else:
        price = plan.price_monthly
    
    if subscription:
        # Update existing subscription
        subscription.plan_id = plan.id
        subscription.billing_cycle = billing_cycle
        subscription.price = price
        subscription.status = status
        subscription.current_period_start = today
        subscription.current_period_end = period_end
        db.commit()
        db.refresh(subscription)
        print(f"[OK] Updated subscription for {company.name}")
    else:
        # Create new subscription
        subscription = Subscription(
            company_id=company.id,
            plan_id=plan.id,
            status=status,
            billing_cycle=billing_cycle,
            price=price,
            current_period_start=today,
            current_period_end=period_end,
            trial_start_date=None,
            trial_end_date=None
        )
        db.add(subscription)
        db.flush()
        print(f"[OK] Created subscription for {company.name}")
    
    return subscription


def generate_payment_number(db: Session, year: int = None) -> str:
    """Generate unique subscription payment number"""
    if year is None:
        year = datetime.now().year
    
    last_payment = db.query(SubscriptionPayment).filter(
        SubscriptionPayment.payment_number.like(f"SUB-INV-{year}-%")
    ).order_by(SubscriptionPayment.payment_number.desc()).first()
    
    if last_payment:
        try:
            seq = int(last_payment.payment_number.split('-')[-1])
            seq += 1
        except:
            seq = 1
    else:
        seq = 1
    
    return f"SUB-INV-{year}-{seq:04d}"


def create_subscription_payment(
    db: Session,
    subscription: Subscription,
    company: Company,
    period_start: date,
    period_end: date,
    amount: Decimal,
    status: PaymentStatus = PaymentStatus.PAID,
    paid_date: date = None,
    due_date: date = None
) -> SubscriptionPayment:
    """Create subscription payment/invoice"""
    if due_date is None:
        due_date = period_start + timedelta(days=7)
    
    if paid_date is None and status == PaymentStatus.PAID:
        paid_date = period_start + timedelta(days=2)
    
    payment_number = generate_payment_number(db, period_start.year)
    
    payment = SubscriptionPayment(
        subscription_id=subscription.id,
        company_id=company.id,
        payment_number=payment_number,
        amount=amount,
        currency=company.currency or "BDT",
        status=status,
        due_date=due_date,
        paid_date=paid_date,
        period_start=period_start,
        period_end=period_end,
        notes=f"Subscription payment for {subscription.billing_cycle.value} billing cycle"
    )
    
    db.add(payment)
    db.flush()
    print(f"[OK] Created payment {payment_number} - {status.value} - {amount} {payment.currency}")
    return payment


def create_usage_tracking(
    db: Session,
    subscription: Subscription,
    company: Company,
    metric_name: str,
    metric_value: int,
    period_start: date,
    period_end: date
) -> UsageTracking:
    """Create usage tracking record"""
    usage = UsageTracking(
        subscription_id=subscription.id,
        company_id=company.id,
        metric_name=metric_name,
        metric_value=metric_value,
        period_start=period_start,
        period_end=period_end,
        tracked_at=date.today()
    )
    
    db.add(usage)
    db.flush()
    return usage


def main():
    """Main function to create tenant companies with subscriptions"""
    
    print("\n" + "="*80)
    print("CREATING TENANT COMPANIES WITH SUBSCRIPTIONS")
    print("="*80 + "\n")
    
    db = SessionLocal()
    
    try:
        # =================================================================
        # 1. CREATE SUBSCRIPTION PLANS
        # =================================================================
        print("1. Creating Subscription Plans...")
        
        basic_plan = get_or_create_plan(
            db,
            plan_code="BASIC",
            plan_name="Basic Plan",
            plan_type=PlanType.BASIC,
            description="Basic plan for small filling stations",
            price_monthly=Decimal("5000.00"),  # 5000 BDT per month
            price_quarterly=Decimal("13500.00"),  # 5% discount
            price_yearly=Decimal("51000.00"),  # 15% discount
            currency="BDT",
            features=["basic_reporting", "single_station", "up_to_5_users"],
            limits={"stations": 1, "users": 5, "storage_gb": 10},
            trial_days=14,
            is_featured=False,
            display_order=1,
            is_active=True
        )
        
        professional_plan = get_or_create_plan(
            db,
            plan_code="PROFESSIONAL",
            plan_name="Professional Plan",
            plan_type=PlanType.PROFESSIONAL,
            description="Professional plan for medium-sized operations",
            price_monthly=Decimal("10000.00"),  # 10000 BDT per month
            price_quarterly=Decimal("27000.00"),  # 5% discount
            price_yearly=Decimal("102000.00"),  # 15% discount
            currency="BDT",
            features=["advanced_reporting", "multi_station", "up_to_20_users", "api_access"],
            limits={"stations": 5, "users": 20, "storage_gb": 50},
            trial_days=14,
            is_featured=True,
            display_order=2,
            is_active=True
        )
        
        enterprise_plan = get_or_create_plan(
            db,
            plan_code="ENTERPRISE",
            plan_name="Enterprise Plan",
            plan_type=PlanType.ENTERPRISE,
            description="Enterprise plan for large operations",
            price_monthly=Decimal("20000.00"),  # 20000 BDT per month
            price_quarterly=Decimal("54000.00"),  # 5% discount
            price_yearly=Decimal("204000.00"),  # 15% discount
            currency="BDT",
            features=["premium_reporting", "unlimited_stations", "unlimited_users", "api_access", "priority_support"],
            limits={"stations": -1, "users": -1, "storage_gb": 200},
            trial_days=30,
            is_featured=True,
            display_order=3,
            is_active=True
        )
        
        db.commit()
        print()
        
        # =================================================================
        # 2. CREATE ADIB FILLING STATION (Tenant)
        # =================================================================
        print("2. Creating/Updating Adib Filling Station...")
        
        adib_company = get_or_create_company(
            db,
            name="Adib Filling Station",
            legal_name="Adib Filling Station Limited",
            tax_id="TAX-ADIB-001",
            email="info@adibfilling.com",
            phone="+880-1712-345678",
            address_line1="123 Highway Road",
            address_line2="Near City Center",
            city="Dhaka",
            state="Dhaka",
            postal_code="1200",
            country="Bangladesh",
            currency="BDT",
            fiscal_year_start="01-01",
            timezone="Asia/Dhaka",
            subdomain="adib"
        )
        
        db.commit()
        print()
        
        # Create subscription for Adib Filling Station (Professional Plan, Monthly)
        print("3. Creating subscription for Adib Filling Station...")
        adib_subscription = create_subscription(
            db,
            adib_company,
            professional_plan,
            BillingCycle.MONTHLY,
            SubscriptionStatus.ACTIVE,
            days_from_now=0,
            duration_days=30
        )
        db.commit()
        print()
        
        # Create subscription payments/invoices for Adib (last 3 months + current)
        print("4. Creating subscription invoices for Adib Filling Station...")
        today = date.today()
        
        # Last 3 months (paid)
        for i in range(3, 0, -1):
            period_start = today - timedelta(days=30 * i)
            period_end = period_start + timedelta(days=30)
            create_subscription_payment(
                db,
                adib_subscription,
                adib_company,
                period_start,
                period_end,
                professional_plan.price_monthly,
                PaymentStatus.PAID,
                paid_date=period_start + timedelta(days=2),
                due_date=period_start + timedelta(days=7)
            )
        
        # Current month (paid)
        current_start = today.replace(day=1)
        current_end = (current_start + timedelta(days=32)).replace(day=1) - timedelta(days=1)
        create_subscription_payment(
            db,
            adib_subscription,
            adib_company,
            current_start,
            current_end,
            professional_plan.price_monthly,
            PaymentStatus.PAID,
            paid_date=current_start + timedelta(days=1),
            due_date=current_start + timedelta(days=7)
        )
        
        # Create usage tracking for Adib
        create_usage_tracking(
            db,
            adib_subscription,
            adib_company,
            "stations",
            2,
            current_start,
            current_end
        )
        create_usage_tracking(
            db,
            adib_subscription,
            adib_company,
            "users",
            8,
            current_start,
            current_end
        )
        
        db.commit()
        print()
        
        # =================================================================
        # 3. CREATE BISMILLAH FILLING STATION (Tenant)
        # =================================================================
        print("5. Creating Bismillah Filling Station...")
        
        bismillah_company = get_or_create_company(
            db,
            name="Bismillah Filling Station",
            legal_name="Bismillah Filling Station Limited",
            tax_id="TAX-BISMILLAH-001",
            email="info@bismillahfilling.com",
            phone="+880-1712-987654",
            address_line1="456 Main Street",
            address_line2="Commercial Area",
            city="Chittagong",
            state="Chittagong",
            postal_code="4000",
            country="Bangladesh",
            currency="BDT",
            fiscal_year_start="01-01",
            timezone="Asia/Dhaka",
            subdomain="bismillah"
        )
        
        db.commit()
        print()
        
        # Create subscription for Bismillah Filling Station (Basic Plan, Quarterly)
        print("6. Creating subscription for Bismillah Filling Station...")
        bismillah_subscription = create_subscription(
            db,
            bismillah_company,
            basic_plan,
            BillingCycle.QUARTERLY,
            SubscriptionStatus.ACTIVE,
            days_from_now=0,
            duration_days=90
        )
        db.commit()
        print()
        
        # Create subscription payments/invoices for Bismillah (last 2 quarters + current)
        print("7. Creating subscription invoices for Bismillah Filling Station...")
        
        # Last 2 quarters (paid)
        for i in range(2, 0, -1):
            period_start = today - timedelta(days=90 * i)
            period_end = period_start + timedelta(days=90)
            create_subscription_payment(
                db,
                bismillah_subscription,
                bismillah_company,
                period_start,
                period_end,
                basic_plan.price_quarterly,
                PaymentStatus.PAID,
                paid_date=period_start + timedelta(days=3),
                due_date=period_start + timedelta(days=7)
            )
        
        # Current quarter (pending - not yet paid)
        quarter_start = today.replace(month=((today.month - 1) // 3) * 3 + 1, day=1)
        quarter_end = (quarter_start + timedelta(days=95)).replace(day=1) - timedelta(days=1)
        create_subscription_payment(
            db,
            bismillah_subscription,
            bismillah_company,
            quarter_start,
            quarter_end,
            basic_plan.price_quarterly,
            PaymentStatus.PENDING,
            paid_date=None,
            due_date=quarter_start + timedelta(days=7)
        )
        
        # Create usage tracking for Bismillah
        create_usage_tracking(
            db,
            bismillah_subscription,
            bismillah_company,
            "stations",
            1,
            quarter_start,
            quarter_end
        )
        create_usage_tracking(
            db,
            bismillah_subscription,
            bismillah_company,
            "users",
            3,
            quarter_start,
            quarter_end
        )
        
        db.commit()
        print()
        
        # =================================================================
        # SUMMARY
        # =================================================================
        print("\n" + "="*80)
        print("SUMMARY")
        print("="*80)
        print(f"\n[OK] Adib Filling Station (ID: {adib_company.id})")
        print(f"  - Plan: {professional_plan.plan_name}")
        print(f"  - Billing Cycle: Monthly")
        print(f"  - Status: Active")
        print(f"  - Invoices: 4 (3 past paid + 1 current paid)")
        
        print(f"\n[OK] Bismillah Filling Station (ID: {bismillah_company.id})")
        print(f"  - Plan: {basic_plan.plan_name}")
        print(f"  - Billing Cycle: Quarterly")
        print(f"  - Status: Active")
        print(f"  - Invoices: 3 (2 past paid + 1 current pending)")
        
        print(f"\n[OK] Subscription Plans Created:")
        print(f"  - {basic_plan.plan_name} (Code: {basic_plan.plan_code})")
        print(f"  - {professional_plan.plan_name} (Code: {professional_plan.plan_code})")
        print(f"  - {enterprise_plan.plan_name} (Code: {enterprise_plan.plan_code})")
        
        print("\n" + "="*80)
        print("SUCCESS! Tenant companies created with subscriptions and invoices.")
        print("="*80 + "\n")
        
    except Exception as e:
        db.rollback()
        print(f"\n[ERROR] {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()

