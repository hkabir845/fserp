"""
Platform/SaaS Management Models
Master Company level models for managing all tenants
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Numeric, Enum as SQLEnum, Text, JSON
from sqlalchemy.orm import relationship
from app.db.session import Base
from datetime import datetime
import enum

# Import Tenant for relationship - use TYPE_CHECKING to avoid circular imports
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from app.modules.tenancy.models import Tenant

class SubscriptionStatus(str, enum.Enum):
    TRIAL = "trial"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    CANCELLED = "cancelled"
    EXPIRED = "expired"

class PlanType(str, enum.Enum):
    FREE = "free"
    BASIC = "basic"
    PROFESSIONAL = "professional"
    ENTERPRISE = "enterprise"
    CUSTOM = "custom"

class PlatformUser(Base):
    """Platform-level users (Super Admins) - not tenant-specific"""
    __tablename__ = "platform_users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, nullable=False)
    is_super_admin = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    last_login = Column(DateTime, nullable=True)

class SubscriptionPlan(Base):
    """Subscription plans available for tenants"""
    __tablename__ = "subscription_plans"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)  # Free, Basic, Professional, Enterprise
    plan_type = Column(SQLEnum(PlanType), nullable=False)
    description = Column(Text, nullable=True)
    price_monthly = Column(Numeric(10, 2), nullable=False, default=0)
    price_yearly = Column(Numeric(10, 2), nullable=True)
    # NOTE: align with existing sqlite schema (erp.db)
    max_users = Column(Integer, nullable=True)
    max_storage_gb = Column(Integer, nullable=True)
    # Stored as TEXT in sqlite (can be JSON string)
    features = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

class TenantSubscription(Base):
    """Tenant subscription information"""
    __tablename__ = "tenant_subscriptions"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, unique=True, index=True)
    plan_id = Column(Integer, ForeignKey("subscription_plans.id"), nullable=False)
    status = Column(SQLEnum(SubscriptionStatus), nullable=False, default=SubscriptionStatus.TRIAL)
    start_date = Column(DateTime, nullable=False)
    end_date = Column(DateTime, nullable=True)  # None for ongoing
    trial_end_date = Column(DateTime, nullable=True)
    auto_renew = Column(Boolean, default=True)
    billing_cycle = Column(String, nullable=False, default="monthly")  # monthly, yearly
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Relationship to Tenant - will be resolved at runtime
    tenant = relationship("Tenant", foreign_keys=[tenant_id], backref="subscription")
    plan = relationship("SubscriptionPlan")

class SubscriptionInvoice(Base):
    """Invoices for tenant subscriptions"""
    __tablename__ = "subscription_invoices"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    subscription_id = Column(Integer, ForeignKey("tenant_subscriptions.id"), nullable=False)
    invoice_number = Column(String, unique=True, nullable=False, index=True)
    invoice_date = Column(DateTime, nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)
    tax_amount = Column(Numeric(10, 2), nullable=True, default=0)
    total_amount = Column(Numeric(10, 2), nullable=False)
    status = Column(String, nullable=False, default="pending")  # pending, paid, overdue, cancelled
    due_date = Column(DateTime, nullable=False)
    paid_date = Column(DateTime, nullable=True)
    payment_method = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    subscription = relationship("TenantSubscription")
    tenant = relationship("Tenant", foreign_keys=[tenant_id])

class PlatformAccount(Base):
    """Platform-level chart of accounts (for SaaS company accounting)"""
    __tablename__ = "platform_accounts"
    
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)  # asset, liability, equity, income, expense
    parent_id = Column(Integer, ForeignKey("platform_accounts.id"), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    parent = relationship("PlatformAccount", remote_side="PlatformAccount.id", foreign_keys=[parent_id], back_populates="children")
    children = relationship("PlatformAccount", foreign_keys=[parent_id], back_populates="parent")

class PlatformJournalEntry(Base):
    """Platform-level journal entries (for SaaS company accounting)"""
    __tablename__ = "platform_journal_entries"
    
    id = Column(Integer, primary_key=True, index=True)
    entry_number = Column(String, unique=True, nullable=False, index=True)
    entry_date = Column(DateTime, nullable=False)
    description = Column(Text, nullable=True)
    reference = Column(String, nullable=True)
    created_by = Column(Integer, nullable=False)  # Platform user ID
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    lines = relationship("PlatformJournalLine", back_populates="entry", cascade="all, delete-orphan")

class PlatformJournalLine(Base):
    """Journal entry lines for platform accounting"""
    __tablename__ = "platform_journal_lines"
    
    id = Column(Integer, primary_key=True, index=True)
    entry_id = Column(Integer, ForeignKey("platform_journal_entries.id"), nullable=False)
    account_id = Column(Integer, ForeignKey("platform_accounts.id"), nullable=False)
    debit = Column(Numeric(15, 2), nullable=False, default=0)
    credit = Column(Numeric(15, 2), nullable=False, default=0)
    description = Column(Text, nullable=True)
    
    entry = relationship("PlatformJournalEntry", back_populates="lines")
    account = relationship("PlatformAccount")

class TenantActivity(Base):
    """Activity log for tenant actions"""
    __tablename__ = "tenant_activities"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    activity_type = Column(String, nullable=False)  # login, subscription_change, etc.
    activity_data = Column(JSON, nullable=True)  # Additional activity data
    ip_address = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    
    tenant = relationship("Tenant", foreign_keys=[tenant_id])

class PlatformSettings(Base):
    """Platform-level global settings"""
    __tablename__ = "platform_settings"
    
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, nullable=False, index=True)
    value = Column(Text, nullable=True)
    value_type = Column(String, nullable=False, default="string")  # string, number, boolean, json
    category = Column(String, nullable=False, default="general")  # general, currency, units, etc.
    description = Column(Text, nullable=True)
    is_public = Column(Boolean, default=False)  # Can be accessed by tenants
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

class Currency(Base):
    """Currency definitions for the platform"""
    __tablename__ = "currencies"
    
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, nullable=False, index=True)  # BDT, USD, EUR, etc.
    name = Column(String, nullable=False)  # Bangladesh Taka, US Dollar, etc.
    symbol = Column(String, nullable=False)  # ৳, $, €, etc.
    is_default = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    decimal_places = Column(Integer, default=2)
    exchange_rate = Column(Numeric(10, 4), nullable=True)  # Exchange rate to default currency
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

class UnitOfMeasure(Base):
    """Global units of measure for the platform"""
    __tablename__ = "platform_uoms"
    
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, nullable=False, index=True)  # KG, MT, L, etc.
    name = Column(String, nullable=False)  # Kilogram, Metric Ton, Liter, etc.
    category = Column(String, nullable=False)  # weight, volume, length, count, etc.
    base_unit = Column(String, nullable=True)  # For conversions (e.g., KG is base for weight)
    conversion_factor = Column(Numeric(10, 4), default=1.0)  # Conversion to base unit
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class PlatformBroadcast(Base):
    """System-wide announcements drafted/sent by platform admins (tenant-targeted or all)."""

    __tablename__ = "platform_broadcasts"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(500), nullable=False)
    message = Column(Text, nullable=False)
    priority = Column(String(20), nullable=False, default="medium")  # low|medium|high|urgent
    status = Column(String(20), nullable=False, default="draft", index=True)  # draft|scheduled|sent|cancelled
    # JSON list of tenant domain strings; None = all tenants
    target_tenant_domains = Column(JSON, nullable=True)
    scheduled_at = Column(DateTime, nullable=True)
    sent_at = Column(DateTime, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("platform_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    author = relationship("PlatformUser", foreign_keys=[created_by_user_id])
