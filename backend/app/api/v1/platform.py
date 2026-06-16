"""
Platform/SaaS Management API
Master Company level APIs for managing all tenants
"""
import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from typing import Dict, List, Optional
from datetime import datetime, timedelta
from decimal import Decimal
from pydantic import BaseModel, EmailStr
from app.core.dependencies import get_db
from app.core.platform_auth import get_platform_user
from app.modules.tenancy.models import Tenant, User
from app.modules.platform.models import PlatformUser
from app.modules.platform.models import (
    PlatformUser, SubscriptionPlan, TenantSubscription, SubscriptionInvoice,
    PlatformAccount, PlatformJournalEntry, PlatformJournalLine, TenantActivity,
    PlatformSettings, Currency, UnitOfMeasure, PlatformBroadcast,
    SubscriptionStatus, PlanType,
)
from app.core.security import get_password_hash, verify_password, create_access_token
from app.core.config import settings
from app.db.session import engine
from app.modules.platform.tenant_backup_service import (
    export_tenant_payload,
    list_backup_files,
    resolve_backup_path,
    restore_tenant_payload,
    save_backup_file,
)

router = APIRouter()

# ==================== Pydantic Models ====================

class PlatformLoginRequest(BaseModel):
    email: EmailStr
    password: str

class PlatformLoginResponse(BaseModel):
    access_token: str
    token_type: str
    user: dict

class TenantResponse(BaseModel):
    id: int
    name: str
    domain: str
    is_active: bool
    created_at: datetime
    subscription: Optional[dict] = None
    user_count: Optional[int] = None
    
    class Config:
        from_attributes = True

class TenantCreate(BaseModel):
    name: str
    domain: str
    admin_email: EmailStr
    admin_password: str
    admin_name: str
    plan_id: Optional[int] = None

class SubscriptionPlanResponse(BaseModel):
    id: int
    name: str
    plan_type: str
    description: Optional[str]
    price_monthly: float
    price_yearly: Optional[float]
    max_users: Optional[int]
    max_storage_gb: Optional[int]
    is_active: bool
    
    class Config:
        from_attributes = True

class SubscriptionPlanUpdate(BaseModel):
    name: Optional[str] = None
    plan_type: Optional[str] = None
    description: Optional[str] = None
    price_monthly: Optional[float] = None
    price_yearly: Optional[float] = None
    max_users: Optional[int] = None
    max_storage_gb: Optional[int] = None
    is_active: Optional[bool] = None

class TenantSubscriptionResponse(BaseModel):
    id: int
    tenant_id: int
    tenant_name: Optional[str] = None
    tenant_domain: Optional[str] = None
    plan_id: int
    plan_name: Optional[str] = None
    status: str
    start_date: datetime
    end_date: Optional[datetime] = None
    trial_end_date: Optional[datetime] = None
    auto_renew: bool
    billing_cycle: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class TenantSubscriptionCreate(BaseModel):
    tenant_id: int
    plan_id: int
    status: Optional[str] = None  # trial/active/suspended/cancelled/expired
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    trial_end_date: Optional[datetime] = None
    auto_renew: bool = True
    billing_cycle: str = "monthly"  # monthly/yearly

class TenantSubscriptionUpdate(BaseModel):
    plan_id: Optional[int] = None
    status: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    trial_end_date: Optional[datetime] = None
    auto_renew: Optional[bool] = None
    billing_cycle: Optional[str] = None

class TenantStatsResponse(BaseModel):
    total_tenants: int
    active_tenants: int
    trial_tenants: int
    total_revenue: float
    monthly_revenue: float
    active_subscriptions: int

# ==================== Platform Authentication ====================

@router.post("/login", response_model=PlatformLoginResponse)
async def platform_login(
    credentials: PlatformLoginRequest,
    db: Session = Depends(get_db)
):
    """Platform-level login (Super Admin)"""
    user = db.query(PlatformUser).filter(
        PlatformUser.email == credentials.email,
        PlatformUser.is_active == True
    ).first()
    
    if not user or not verify_password(credentials.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    # Update last login
    user.last_login = datetime.utcnow()
    db.commit()
    
    # Create token
    access_token = create_access_token(data={"sub": user.email, "platform": True})
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "is_super_admin": user.is_super_admin
        }
    }

# ==================== Tenant Management ====================

@router.get("/tenants", response_model=List[TenantResponse])
async def list_tenants(
    skip: int = 0,
    limit: int = 100,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user)
):
    """List all tenants (Platform view)"""
    # Log for debugging
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"Listing tenants for platform user: {current_user.email}")
    
    query = db.query(Tenant)
    
    if status == "active":
        query = query.filter(Tenant.is_active == True)
    elif status == "inactive":
        query = query.filter(Tenant.is_active == False)
    
    tenants = query.order_by(Tenant.created_at.desc()).offset(skip).limit(limit).all()
    
    logger.info(f"Found {len(tenants)} tenants in database")
    
    result = []
    for tenant in tenants:
        # Get subscription (handle case where subscription might not exist)
        subscription = None
        plan_name = None
        subscription_status = None
        subscription_id = None
        
        try:
            subscription = db.query(TenantSubscription).filter(
                TenantSubscription.tenant_id == tenant.id
            ).first()
            
            if subscription:
                subscription_id = subscription.id
                subscription_status = subscription.status.value if subscription.status else None
                # Safely access plan name
                try:
                    if subscription.plan:
                        plan_name = subscription.plan.name
                except Exception as e:
                    logger.warning(f"Error accessing plan for subscription {subscription.id}: {e}")
                    plan_name = None
        except Exception as e:
            logger.warning(f"Error fetching subscription for tenant {tenant.id}: {e}")
        
        # Get user count
        user_count = db.query(User).filter(User.tenant_id == tenant.id).count()
        
        tenant_dict = {
            "id": tenant.id,
            "name": tenant.name,
            "domain": tenant.domain,
            "is_active": tenant.is_active,
            "created_at": tenant.created_at,
            "subscription": {
                "id": subscription_id,
                "status": subscription_status,
                "plan_name": plan_name
            } if subscription else None,
            "user_count": user_count
        }
        result.append(tenant_dict)
    
    logger.info(f"Returning {len(result)} tenants")
    return result

@router.post("/tenants", response_model=TenantResponse)
async def create_tenant(
    tenant_data: TenantCreate,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user)
):
    """Create a new tenant"""
    # Check if domain exists
    existing = db.query(Tenant).filter(Tenant.domain == tenant_data.domain).first()
    if existing:
        raise HTTPException(status_code=400, detail="Domain already exists")
    
    # Create tenant
    tenant = Tenant(
        name=tenant_data.name,
        domain=tenant_data.domain,
        is_active=True,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db.add(tenant)
    db.flush()
    
    # Create admin user
    admin = User(
        tenant_id=tenant.id,
        email=tenant_data.admin_email,
        hashed_password=get_password_hash(tenant_data.admin_password),
        full_name=tenant_data.admin_name,
        is_active=True,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db.add(admin)
    db.flush()
    
    # Create subscription if plan provided
    if tenant_data.plan_id:
        plan = db.query(SubscriptionPlan).filter(SubscriptionPlan.id == tenant_data.plan_id).first()
        if plan:
            subscription = TenantSubscription(
                tenant_id=tenant.id,
                plan_id=plan.id,
                status=SubscriptionStatus.TRIAL,
                start_date=datetime.utcnow(),
                trial_end_date=datetime.utcnow() + timedelta(days=14),
                billing_cycle="monthly"
            )
            db.add(subscription)
    
    db.commit()
    db.refresh(tenant)
    
    return {
        "id": tenant.id,
        "name": tenant.name,
        "domain": tenant.domain,
        "is_active": tenant.is_active,
        "created_at": tenant.created_at,
        "subscription": None,
        "user_count": 1
    }

@router.get("/tenants/{tenant_id}", response_model=TenantResponse)
async def get_tenant(
    tenant_id: int,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user)
):
    """Get tenant details"""
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    
    subscription = db.query(TenantSubscription).filter(
        TenantSubscription.tenant_id == tenant.id
    ).first()
    
    user_count = db.query(User).filter(User.tenant_id == tenant.id).count()
    
    return {
        "id": tenant.id,
        "name": tenant.name,
        "domain": tenant.domain,
        "is_active": tenant.is_active,
        "created_at": tenant.created_at,
        "subscription": {
            "id": subscription.id,
            "status": subscription.status.value,
            "plan_name": subscription.plan.name if subscription else None
        } if subscription else None,
        "user_count": user_count
    }

@router.patch("/tenants/{tenant_id}")
async def update_tenant(
    tenant_id: int,
    is_active: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user)
):
    """Update tenant (activate/deactivate)"""
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    
    if is_active is not None:
        tenant.is_active = is_active
        tenant.updated_at = datetime.utcnow()
    
    db.commit()
    return {"message": "Tenant updated successfully"}

# ==================== Subscription Plans ====================

@router.get("/plans", response_model=List[SubscriptionPlanResponse])
async def list_plans(
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user)
):
    """List subscription plans. Default: active only. Use include_inactive=true for admin/archive view."""
    q = db.query(SubscriptionPlan)
    if not include_inactive:
        q = q.filter(SubscriptionPlan.is_active == True)
    plans = q.order_by(SubscriptionPlan.price_monthly, SubscriptionPlan.id).all()
    return plans


@router.patch("/plans/{plan_id}", response_model=SubscriptionPlanResponse)
async def update_plan(
    plan_id: int,
    payload: SubscriptionPlanUpdate,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user)
):
    """Update a subscription plan."""
    plan = db.query(SubscriptionPlan).filter(SubscriptionPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    data = payload.model_dump(exclude_unset=True)
    if "plan_type" in data and data["plan_type"] is not None:
        try:
            plan.plan_type = PlanType(str(data["plan_type"]).lower())
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid plan_type. Use one of: {[e.value for e in PlanType]}",
            )
        del data["plan_type"]

    for key, val in data.items():
        if key in ("price_monthly", "price_yearly"):
            setattr(plan, key, Decimal(str(val)) if val is not None else None)
        elif key in ("max_users", "max_storage_gb"):
            setattr(plan, key, val)
        elif key == "is_active":
            setattr(plan, key, bool(val))
        else:
            setattr(plan, key, val)

    plan.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(plan)
    return plan


@router.delete("/plans/{plan_id}")
async def archive_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user)
):
    """
    Archive a plan (soft-delete: is_active=false).
    Existing tenant subscriptions keep this plan_id until changed in Subscriptions.
    """
    plan = db.query(SubscriptionPlan).filter(SubscriptionPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    sub_count = (
        db.query(TenantSubscription)
        .filter(TenantSubscription.plan_id == plan_id)
        .count()
    )

    plan.is_active = False
    plan.updated_at = datetime.utcnow()
    db.commit()

    return {
        "message": "Plan archived. It will no longer be offered to new subscriptions.",
        "subscription_count": sub_count,
        "plan_id": plan_id,
    }

# ==================== Tenant Subscriptions ====================

@router.get("/subscriptions", response_model=List[TenantSubscriptionResponse])
async def list_subscriptions(
    q: Optional[str] = None,
    status: Optional[str] = None,
    plan_id: Optional[int] = None,
    billing_cycle: Optional[str] = None,
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user)
):
    """List tenant subscriptions with tenant + plan summary."""
    query = db.query(TenantSubscription)

    if status:
        try:
            query = query.filter(TenantSubscription.status == SubscriptionStatus(status))
        except Exception:
            # unknown status -> empty
            return []

    if plan_id:
        query = query.filter(TenantSubscription.plan_id == plan_id)

    if billing_cycle:
        query = query.filter(TenantSubscription.billing_cycle == billing_cycle)

    subs = query.order_by(TenantSubscription.updated_at.desc()).offset(skip).limit(limit).all()

    # Enrich with tenant/plan info and optional search
    results: list[dict] = []
    q_norm = (q or "").strip().lower()
    for s in subs:
        tenant_name = None
        tenant_domain = None
        try:
            if s.tenant:
                tenant_name = s.tenant.name
                tenant_domain = s.tenant.domain
        except Exception:
            tenant_name = None
            tenant_domain = None

        plan_name = None
        try:
            if s.plan:
                plan_name = s.plan.name
        except Exception:
            plan_name = None

        if q_norm:
            hay = " ".join([tenant_name or "", tenant_domain or "", plan_name or "", str(s.id)]).lower()
            if q_norm not in hay:
                continue

        results.append(
            {
                "id": s.id,
                "tenant_id": s.tenant_id,
                "tenant_name": tenant_name,
                "tenant_domain": tenant_domain,
                "plan_id": s.plan_id,
                "plan_name": plan_name,
                "status": s.status.value if s.status else None,
                "start_date": s.start_date,
                "end_date": s.end_date,
                "trial_end_date": s.trial_end_date,
                "auto_renew": s.auto_renew,
                "billing_cycle": s.billing_cycle,
                "created_at": s.created_at,
                "updated_at": s.updated_at,
            }
        )

    return results


@router.post("/subscriptions", response_model=TenantSubscriptionResponse)
async def create_subscription(
    payload: TenantSubscriptionCreate,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user)
):
    """Create or replace a tenant subscription (one per tenant)."""
    tenant = db.query(Tenant).filter(Tenant.id == payload.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    plan = db.query(SubscriptionPlan).filter(SubscriptionPlan.id == payload.plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    existing = db.query(TenantSubscription).filter(TenantSubscription.tenant_id == tenant.id).first()
    if existing:
        db.delete(existing)
        db.flush()

    status_val = SubscriptionStatus.TRIAL
    if payload.status:
        try:
            status_val = SubscriptionStatus(payload.status)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid status")

    start_date = payload.start_date or datetime.utcnow()
    sub = TenantSubscription(
        tenant_id=tenant.id,
        plan_id=plan.id,
        status=status_val,
        start_date=start_date,
        end_date=payload.end_date,
        trial_end_date=payload.trial_end_date,
        auto_renew=payload.auto_renew,
        billing_cycle=payload.billing_cycle,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return {
        "id": sub.id,
        "tenant_id": sub.tenant_id,
        "tenant_name": tenant.name,
        "tenant_domain": tenant.domain,
        "plan_id": sub.plan_id,
        "plan_name": plan.name,
        "status": sub.status.value,
        "start_date": sub.start_date,
        "end_date": sub.end_date,
        "trial_end_date": sub.trial_end_date,
        "auto_renew": sub.auto_renew,
        "billing_cycle": sub.billing_cycle,
        "created_at": sub.created_at,
        "updated_at": sub.updated_at,
    }


@router.patch("/subscriptions/{subscription_id}", response_model=TenantSubscriptionResponse)
async def update_subscription(
    subscription_id: int,
    payload: TenantSubscriptionUpdate,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user)
):
    """Update subscription status/plan/dates."""
    sub = db.query(TenantSubscription).filter(TenantSubscription.id == subscription_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")

    tenant = db.query(Tenant).filter(Tenant.id == sub.tenant_id).first()

    if payload.plan_id is not None:
        plan = db.query(SubscriptionPlan).filter(SubscriptionPlan.id == payload.plan_id).first()
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found")
        sub.plan_id = plan.id

    if payload.status is not None:
        try:
            sub.status = SubscriptionStatus(payload.status)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid status")

    if payload.start_date is not None:
        sub.start_date = payload.start_date
    if payload.end_date is not None:
        sub.end_date = payload.end_date
    if payload.trial_end_date is not None:
        sub.trial_end_date = payload.trial_end_date
    if payload.auto_renew is not None:
        sub.auto_renew = payload.auto_renew
    if payload.billing_cycle is not None:
        sub.billing_cycle = payload.billing_cycle

    sub.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(sub)

    plan_name = None
    try:
        if sub.plan:
            plan_name = sub.plan.name
    except Exception:
        plan_name = None

    return {
        "id": sub.id,
        "tenant_id": sub.tenant_id,
        "tenant_name": tenant.name if tenant else None,
        "tenant_domain": tenant.domain if tenant else None,
        "plan_id": sub.plan_id,
        "plan_name": plan_name,
        "status": sub.status.value if sub.status else None,
        "start_date": sub.start_date,
        "end_date": sub.end_date,
        "trial_end_date": sub.trial_end_date,
        "auto_renew": sub.auto_renew,
        "billing_cycle": sub.billing_cycle,
        "created_at": sub.created_at,
        "updated_at": sub.updated_at,
    }

# ==================== Subscription invoices ====================


class SubscriptionInvoiceResponse(BaseModel):
    id: int
    tenant_id: int
    tenant_name: Optional[str] = None
    tenant_domain: Optional[str] = None
    subscription_id: int
    invoice_number: str
    invoice_date: datetime
    amount: float
    tax_amount: Optional[float] = None
    total_amount: float
    status: str
    due_date: datetime
    paid_date: Optional[datetime] = None
    payment_method: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime


@router.get("/subscription-invoices", response_model=List[SubscriptionInvoiceResponse])
async def list_subscription_invoices(
    skip: int = 0,
    limit: int = 200,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user),
):
    """Tenant subscription billing documents (platform SaaS invoices)."""
    q = db.query(SubscriptionInvoice).order_by(SubscriptionInvoice.invoice_date.desc(), SubscriptionInvoice.id.desc())
    if status:
        q = q.filter(SubscriptionInvoice.status == status)
    rows = q.offset(skip).limit(min(limit, 500)).all()
    out: List[SubscriptionInvoiceResponse] = []
    for inv in rows:
        tn = db.query(Tenant).filter(Tenant.id == inv.tenant_id).first()
        out.append(
            SubscriptionInvoiceResponse(
                id=inv.id,
                tenant_id=inv.tenant_id,
                tenant_name=tn.name if tn else None,
                tenant_domain=tn.domain if tn else None,
                subscription_id=inv.subscription_id,
                invoice_number=inv.invoice_number,
                invoice_date=inv.invoice_date,
                amount=float(inv.amount),
                tax_amount=float(inv.tax_amount) if inv.tax_amount is not None else None,
                total_amount=float(inv.total_amount),
                status=inv.status,
                due_date=inv.due_date,
                paid_date=inv.paid_date,
                payment_method=inv.payment_method,
                notes=inv.notes,
                created_at=inv.created_at,
            )
        )
    return out


# ==================== Dashboard Stats ====================

@router.get("/stats", response_model=TenantStatsResponse)
async def get_platform_stats(
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user)
):
    """Get platform statistics"""
    total_tenants = db.query(Tenant).count()
    active_tenants = db.query(Tenant).filter(Tenant.is_active == True).count()
    
    # Get trial tenants
    trial_subscriptions = db.query(TenantSubscription).filter(
        TenantSubscription.status == SubscriptionStatus.TRIAL
    ).count()
    
    # Get revenue
    paid_invoices = db.query(SubscriptionInvoice).filter(
        SubscriptionInvoice.status == "paid"
    ).all()
    
    total_revenue = sum(float(inv.total_amount) for inv in paid_invoices)
    
    # Monthly revenue (current month)
    current_month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    monthly_invoices = db.query(SubscriptionInvoice).filter(
        SubscriptionInvoice.status == "paid",
        SubscriptionInvoice.paid_date >= current_month_start
    ).all()
    monthly_revenue = sum(float(inv.total_amount) for inv in monthly_invoices)
    
    # Active subscriptions
    active_subscriptions = db.query(TenantSubscription).filter(
        TenantSubscription.status == SubscriptionStatus.ACTIVE
    ).count()
    
    return {
        "total_tenants": total_tenants,
        "active_tenants": active_tenants,
        "trial_tenants": trial_subscriptions,
        "total_revenue": total_revenue,
        "monthly_revenue": monthly_revenue,
        "active_subscriptions": active_subscriptions
    }

# ==================== Platform Settings ====================

class SettingUpdate(BaseModel):
    value: str
    value_type: Optional[str] = "string"

class SettingResponse(BaseModel):
    key: str
    value: str
    value_type: str
    category: str
    description: Optional[str]
    is_public: bool
    
    class Config:
        from_attributes = True

@router.get("/settings", response_model=List[SettingResponse])
async def get_settings(
    category: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user)
):
    """Get platform settings"""
    query = db.query(PlatformSettings)
    if category:
        query = query.filter(PlatformSettings.category == category)
    settings = query.order_by(PlatformSettings.category, PlatformSettings.key).all()
    return settings

@router.get("/settings/{key}", response_model=SettingResponse)
async def get_setting(
    key: str,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user)
):
    """Get a specific setting"""
    setting = db.query(PlatformSettings).filter(PlatformSettings.key == key).first()
    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")
    return setting

@router.put("/settings/{key}")
async def update_setting(
    key: str,
    setting_data: SettingUpdate,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user)
):
    """Update a setting"""
    setting = db.query(PlatformSettings).filter(PlatformSettings.key == key).first()
    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")
    
    setting.value = setting_data.value
    setting.value_type = setting_data.value_type
    setting.updated_at = datetime.utcnow()
    db.commit()
    return {"message": "Setting updated successfully"}

# ==================== Currencies ====================

class CurrencyCreate(BaseModel):
    code: str
    name: str
    symbol: str
    decimal_places: int = 2
    exchange_rate: Optional[float] = None
    is_default: bool = False

class CurrencyUpdate(BaseModel):
    name: Optional[str] = None
    symbol: Optional[str] = None
    decimal_places: Optional[int] = None
    exchange_rate: Optional[float] = None
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None

class CurrencyResponse(BaseModel):
    id: int
    code: str
    name: str
    symbol: str
    is_default: bool
    is_active: bool
    decimal_places: int
    exchange_rate: Optional[float]
    
    class Config:
        from_attributes = True

@router.get("/currencies", response_model=List[CurrencyResponse])
async def list_currencies(
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user)
):
    """List all currencies"""
    currencies = db.query(Currency).order_by(Currency.is_default.desc(), Currency.code).all()
    return currencies

@router.post("/currencies", response_model=CurrencyResponse)
async def create_currency(
    currency_data: CurrencyCreate,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user)
):
    """Create a new currency"""
    # Check if code exists
    existing = db.query(Currency).filter(Currency.code == currency_data.code).first()
    if existing:
        raise HTTPException(status_code=400, detail="Currency code already exists")
    
    # If setting as default, unset other defaults
    if currency_data.is_default:
        db.query(Currency).filter(Currency.is_default == True).update({"is_default": False})
    
    currency = Currency(
        code=currency_data.code,
        name=currency_data.name,
        symbol=currency_data.symbol,
        decimal_places=currency_data.decimal_places,
        exchange_rate=Decimal(str(currency_data.exchange_rate)) if currency_data.exchange_rate else None,
        is_default=currency_data.is_default,
        is_active=True
    )
    db.add(currency)
    db.commit()
    db.refresh(currency)
    return currency

@router.put("/currencies/{currency_id}", response_model=CurrencyResponse)
async def update_currency(
    currency_id: int,
    currency_data: CurrencyUpdate,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user)
):
    """Update a currency"""
    currency = db.query(Currency).filter(Currency.id == currency_id).first()
    if not currency:
        raise HTTPException(status_code=404, detail="Currency not found")
    
    # If setting as default, unset other defaults
    if currency_data.is_default and not currency.is_default:
        db.query(Currency).filter(Currency.is_default == True).update({"is_default": False})
    
    if currency_data.name is not None:
        currency.name = currency_data.name
    if currency_data.symbol is not None:
        currency.symbol = currency_data.symbol
    if currency_data.decimal_places is not None:
        currency.decimal_places = currency_data.decimal_places
    if currency_data.exchange_rate is not None:
        currency.exchange_rate = Decimal(str(currency_data.exchange_rate))
    if currency_data.is_default is not None:
        currency.is_default = currency_data.is_default
    if currency_data.is_active is not None:
        currency.is_active = currency_data.is_active
    
    currency.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(currency)
    return currency

# ==================== Units of Measure ====================

class UOMCreate(BaseModel):
    code: str
    name: str
    category: str
    base_unit: Optional[str] = None
    conversion_factor: float = 1.0

class UOMUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    base_unit: Optional[str] = None
    conversion_factor: Optional[float] = None
    is_active: Optional[bool] = None

class UOMResponse(BaseModel):
    id: int
    code: str
    name: str
    category: str
    base_unit: Optional[str]
    conversion_factor: float
    is_active: bool
    
    class Config:
        from_attributes = True

@router.get("/uoms", response_model=List[UOMResponse])
async def list_uoms(
    category: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user)
):
    """List all units of measure"""
    query = db.query(UnitOfMeasure)
    if category:
        query = query.filter(UnitOfMeasure.category == category)
    uoms = query.order_by(UnitOfMeasure.category, UnitOfMeasure.code).all()
    return uoms

@router.post("/uoms", response_model=UOMResponse)
async def create_uom(
    uom_data: UOMCreate,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user)
):
    """Create a new unit of measure"""
    # Check if code exists
    existing = db.query(UnitOfMeasure).filter(UnitOfMeasure.code == uom_data.code).first()
    if existing:
        raise HTTPException(status_code=400, detail="UOM code already exists")
    
    uom = UnitOfMeasure(
        code=uom_data.code,
        name=uom_data.name,
        category=uom_data.category,
        base_unit=uom_data.base_unit,
        conversion_factor=Decimal(str(uom_data.conversion_factor)),
        is_active=True
    )
    db.add(uom)
    db.commit()
    db.refresh(uom)
    return uom

@router.put("/uoms/{uom_id}", response_model=UOMResponse)
async def update_uom(
    uom_id: int,
    uom_data: UOMUpdate,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user)
):
    """Update a unit of measure"""
    uom = db.query(UnitOfMeasure).filter(UnitOfMeasure.id == uom_id).first()
    if not uom:
        raise HTTPException(status_code=404, detail="UOM not found")
    
    if uom_data.name is not None:
        uom.name = uom_data.name
    if uom_data.category is not None:
        uom.category = uom_data.category
    if uom_data.base_unit is not None:
        uom.base_unit = uom_data.base_unit
    if uom_data.conversion_factor is not None:
        uom.conversion_factor = Decimal(str(uom_data.conversion_factor))
    if uom_data.is_active is not None:
        uom.is_active = uom_data.is_active
    
    uom.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(uom)
    return uom


# ==================== Broadcast messages (tenant announcements) ====================

class BroadcastCreate(BaseModel):
    title: str
    message: str
    priority: str = "medium"
    status: str = "draft"
    target_tenant_domains: Optional[list[str]] = None  # None = all tenants
    scheduled_at: Optional[datetime] = None


class BroadcastUpdate(BaseModel):
    title: Optional[str] = None
    message: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    target_tenant_domains: Optional[list[str]] = None
    scheduled_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None


class BroadcastResponse(BaseModel):
    id: int
    title: str
    message: str
    priority: str
    status: str
    target_tenants: Optional[list[str]] = None  # domain list for API/frontend parity
    scheduled_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    created_at: datetime
    created_by: str

    class Config:
        from_attributes = True


class TenantBackupFileMeta(BaseModel):
    filename: str
    size_bytes: int
    modified_at: str


class TenantRestoreResult(BaseModel):
    message: str
    tables_touched: int
    row_counts: Dict[str, int]


def _broadcast_to_response(row: PlatformBroadcast, created_by_label: str) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "message": row.message,
        "priority": row.priority,
        "status": row.status,
        "target_tenants": row.target_tenant_domains,
        "scheduled_at": row.scheduled_at,
        "sent_at": row.sent_at,
        "created_at": row.created_at,
        "created_by": created_by_label,
    }


@router.get("/broadcasts", response_model=List[BroadcastResponse])
async def list_broadcasts(
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user),
):
    rows = (
        db.query(PlatformBroadcast)
        .order_by(PlatformBroadcast.created_at.desc())
        .offset(skip)
        .limit(min(limit, 500))
        .all()
    )
    out: List[dict] = []
    for r in rows:
        author = None
        if r.created_by_user_id:
            author = db.query(PlatformUser).filter(PlatformUser.id == r.created_by_user_id).first()
        label = author.email if author else "system"
        out.append(_broadcast_to_response(r, label))
    return out


@router.post("/broadcasts", response_model=BroadcastResponse)
async def create_broadcast(
    body: BroadcastCreate,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user),
):
    row = PlatformBroadcast(
        title=body.title.strip(),
        message=body.message.strip(),
        priority=body.priority or "medium",
        status=body.status or "draft",
        target_tenant_domains=body.target_tenant_domains,
        scheduled_at=body.scheduled_at,
        sent_at=datetime.utcnow() if body.status == "sent" else None,
        created_by_user_id=current_user.id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _broadcast_to_response(row, current_user.email)


@router.patch("/broadcasts/{broadcast_id}", response_model=BroadcastResponse)
async def update_broadcast(
    broadcast_id: int,
    body: BroadcastUpdate,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user),
):
    row = db.query(PlatformBroadcast).filter(PlatformBroadcast.id == broadcast_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Broadcast not found")

    if body.title is not None:
        row.title = body.title.strip()
    if body.message is not None:
        row.message = body.message.strip()
    if body.priority is not None:
        row.priority = body.priority
    if body.status is not None:
        row.status = body.status
    if body.target_tenant_domains is not None:
        row.target_tenant_domains = body.target_tenant_domains
    if body.scheduled_at is not None:
        row.scheduled_at = body.scheduled_at
    if body.sent_at is not None:
        row.sent_at = body.sent_at
    if body.status == "sent" and row.sent_at is None:
        row.sent_at = datetime.utcnow()

    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)

    author = (
        db.query(PlatformUser).filter(PlatformUser.id == row.created_by_user_id).first()
        if row.created_by_user_id
        else None
    )
    label = author.email if author else current_user.email
    return _broadcast_to_response(row, label)


# ==================== Tenant backup / restore (SaaS admin) ====================


@router.get("/tenants/{tenant_id}/backup/export")
async def export_tenant_backup_download(
    tenant_id: int,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user),
):
    """
    Download a full logical JSON backup for one tenant (all tables with tenant_id,
    tenant row, user_roles for that tenant, tenant_subscriptions, etc.).
    """
    import json as _json

    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    with engine.connect() as conn:
        payload = export_tenant_payload(conn, tenant_id)

    body = _json.dumps(payload, ensure_ascii=False).encode("utf-8")
    filename = f"tenant_{tenant_id}_{tenant.domain}_export.json".replace("/", "_")
    return StreamingResponse(
        iter([body]),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/tenants/{tenant_id}/backup")
async def create_tenant_backup_on_disk(
    tenant_id: int,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user),
):
    """Write a timestamped JSON backup file on the server (see TENANT_BACKUP_DIR)."""
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    with engine.connect() as conn:
        payload = export_tenant_payload(conn, tenant_id)

    fn = save_backup_file(tenant_id, tenant.domain, payload)
    path = os.path.join(settings.TENANT_BACKUP_DIR, fn)
    size = os.path.getsize(path) if os.path.isfile(path) else 0
    return {
        "filename": fn,
        "path": path,
        "size_bytes": size,
        "table_row_counts": payload.get("table_row_counts"),
        "exported_at": payload.get("exported_at"),
    }


@router.get("/tenants/{tenant_id}/backups", response_model=List[TenantBackupFileMeta])
async def list_tenant_backups_on_disk(
    tenant_id: int,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user),
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return list_backup_files(tenant_id)


@router.get("/tenants/{tenant_id}/backups/{filename}")
async def download_saved_tenant_backup(
    tenant_id: int,
    filename: str,
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user),
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    try:
        path = resolve_backup_path(tenant_id, filename)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    return FileResponse(path, media_type="application/json", filename=filename)


@router.post("/tenants/{tenant_id}/restore", response_model=TenantRestoreResult)
async def restore_tenant_from_upload(
    tenant_id: int,
    confirm_domain: str = Form(..., description="Must match the tenant domain inside the backup file"),
    file: UploadFile = File(..., description="JSON backup from export or server backup"),
    db: Session = Depends(get_db),
    current_user: PlatformUser = Depends(get_platform_user),
):
    """
    **Destructive**: deletes all tenant-scoped rows for this tenant id, then inserts from backup.
    Subscription plan rows are not included — existing platform plans must still exist.
    """
    import json as _json

    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    raw = await file.read()
    try:
        payload = _json.loads(raw.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON backup file")

    try:
        with engine.begin() as conn:
            n_tables, counts = restore_tenant_payload(
                conn, engine, tenant_id, payload, confirm_domain=confirm_domain
            )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return TenantRestoreResult(
        message="Restore completed. All users should re-login; verify subscription and integrations.",
        tables_touched=n_tables,
        row_counts=counts,
    )

