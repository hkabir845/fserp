"""Seed platform subscription plans, tenant subscriptions, and invoices.

Creates:
- Subscription plans (Free/Basic/Professional/Enterprise)
- Assigns subscriptions to existing tenants
- Creates sample invoices (paid/pending/overdue)

Idempotent:
- Plans by (plan_type)
- Subscriptions by (tenant_id)
- Invoices by (invoice_number)

Run:
  python scripts/seed_platform_subscriptions_demo.py
"""

import os
import sys
from datetime import datetime, timedelta
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import SessionLocal
from app.modules.platform.models import (
    SubscriptionPlan,
    TenantSubscription,
    SubscriptionInvoice,
    PlanType,
    SubscriptionStatus,
)
from app.modules.tenancy.models import Tenant


def _dec(x: str) -> Decimal:
    return Decimal(x)


def seed_platform_subscriptions_demo() -> None:
    db = SessionLocal()
    try:
        # Plans
        plans_data = [
            {
                "name": "Free",
                "plan_type": PlanType.FREE,
                "description": "Starter plan for evaluation",
                "price_monthly": _dec("0.00"),
                "price_yearly": _dec("0.00"),
                "max_users_per_tenant": 3,
                "max_storage_gb": 2,
                "features": ["Core ERP", "Single warehouse", "Community support"],
            },
            {
                "name": "Basic",
                "plan_type": PlanType.BASIC,
                "description": "Small businesses and single-site operations",
                "price_monthly": _dec("49.00"),
                "price_yearly": _dec("499.00"),
                "max_users_per_tenant": 10,
                "max_storage_gb": 20,
                "features": ["Inventory", "Purchase", "Sales", "Manufacturing", "Email support"],
            },
            {
                "name": "Professional",
                "plan_type": PlanType.PROFESSIONAL,
                "description": "Multi-department operations and advanced manufacturing",
                "price_monthly": _dec("129.00"),
                "price_yearly": _dec("1299.00"),
                "max_users_per_tenant": 50,
                "max_storage_gb": 100,
                "features": ["All Basic features", "QC workflows", "Role-based access", "Priority support"],
            },
            {
                "name": "Enterprise",
                "plan_type": PlanType.ENTERPRISE,
                "description": "Large organizations with custom needs",
                "price_monthly": _dec("399.00"),
                "price_yearly": _dec("3999.00"),
                "max_users_per_tenant": None,
                "max_storage_gb": None,
                "features": ["SSO", "Audit logs", "Dedicated support", "SLA"],
            },
        ]

        plan_by_type: dict[PlanType, SubscriptionPlan] = {}
        created_plans = 0
        for p in plans_data:
            existing = db.query(SubscriptionPlan).filter(SubscriptionPlan.plan_type == p["plan_type"]).first()
            if existing:
                plan_by_type[p["plan_type"]] = existing
                continue
            plan = SubscriptionPlan(
                name=p["name"],
                plan_type=p["plan_type"],
                description=p.get("description"),
                price_monthly=p["price_monthly"],
                price_yearly=p.get("price_yearly"),
                max_users=p.get("max_users_per_tenant"),
                max_storage_gb=p.get("max_storage_gb"),
                # Store as JSON-like string for sqlite TEXT column
                features=str(p.get("features")) if p.get("features") else None,
                is_active=True,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            db.add(plan)
            db.flush()
            plan_by_type[p["plan_type"]] = plan
            created_plans += 1

        tenants = db.query(Tenant).order_by(Tenant.id.asc()).all()
        if not tenants:
            raise RuntimeError("No tenants found. Create at least one tenant first.")

        # Assign subscriptions
        created_subs = 0
        now = datetime.utcnow()

        def ensure_sub(tenant: Tenant, plan: SubscriptionPlan, status: SubscriptionStatus, cycle: str):
            nonlocal created_subs
            existing = db.query(TenantSubscription).filter(TenantSubscription.tenant_id == tenant.id).first()
            if not existing:
                sub = TenantSubscription(
                    tenant_id=tenant.id,
                    plan_id=plan.id,
                    status=status,
                    start_date=now - timedelta(days=30),
                    trial_end_date=(now + timedelta(days=14)) if status == SubscriptionStatus.TRIAL else None,
                    end_date=None,
                    auto_renew=True,
                    billing_cycle=cycle,
                    created_at=now,
                    updated_at=now,
                )
                db.add(sub)
                db.flush()
                created_subs += 1
                return sub
            # keep existing, but ensure plan exists
            return existing

        # Deterministic assignment: first tenant -> Professional active, second -> Basic trial, others -> Basic active
        subs: list[TenantSubscription] = []
        for idx, t in enumerate(tenants):
            if idx == 0:
                subs.append(ensure_sub(t, plan_by_type[PlanType.PROFESSIONAL], SubscriptionStatus.ACTIVE, "monthly"))
            elif idx == 1:
                subs.append(ensure_sub(t, plan_by_type[PlanType.BASIC], SubscriptionStatus.TRIAL, "monthly"))
            else:
                subs.append(ensure_sub(t, plan_by_type[PlanType.BASIC], SubscriptionStatus.ACTIVE, "yearly" if (idx % 2 == 0) else "monthly"))

        # Create invoices for the first few subscriptions
        created_invoices = 0
        for i, sub in enumerate(subs[:5]):
            # 3 invoices per subscription
            for j in range(3):
                inv_no = f"INV-SUB-{sub.id}-{(now - timedelta(days=30*j)).strftime('%Y%m')}"
                exists = db.query(SubscriptionInvoice).filter(SubscriptionInvoice.invoice_number == inv_no).first()
                if exists:
                    continue

                plan = db.query(SubscriptionPlan).filter(SubscriptionPlan.id == sub.plan_id).first()
                amount = Decimal(plan.price_monthly) if sub.billing_cycle == "monthly" else Decimal(plan.price_yearly or 0)
                tax = (amount * _dec("0.00"))
                total = amount + tax

                status = "paid" if j == 1 else ("overdue" if j == 2 else "pending")
                due_date = now - timedelta(days=10) if status in ("overdue", "paid") else now + timedelta(days=10)
                paid_date = (now - timedelta(days=5)) if status == "paid" else None

                inv = SubscriptionInvoice(
                    tenant_id=sub.tenant_id,
                    subscription_id=sub.id,
                    invoice_number=inv_no,
                    invoice_date=now - timedelta(days=30 * j),
                    amount=amount,
                    tax_amount=tax,
                    total_amount=total,
                    status=status,
                    due_date=due_date,
                    paid_date=paid_date,
                    payment_method=("Bank" if status == "paid" else None),
                    notes=("Auto-generated demo invoice" if j == 0 else None),
                    created_at=now,
                    updated_at=now,
                )
                db.add(inv)
                created_invoices += 1

        db.commit()

        print("[SUCCESS] Seeded platform subscriptions demo")
        print(f"  - plans created: {created_plans}")
        print(f"  - subscriptions created: {created_subs}")
        print(f"  - invoices created: {created_invoices}")

    finally:
        db.close()


if __name__ == "__main__":
    seed_platform_subscriptions_demo()
