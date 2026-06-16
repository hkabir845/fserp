"""
Tenant-level Settings Models
Settings specific to each tenant company
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Numeric, Text, JSON
from sqlalchemy.orm import relationship
from app.db.session import Base
from datetime import datetime

class TenantSettings(Base):
    """Tenant-level settings"""
    __tablename__ = "tenant_settings"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    key = Column(String, nullable=False, index=True)
    value = Column(Text, nullable=True)
    value_type = Column(String, nullable=False, default="string")  # string, number, boolean, json
    category = Column(String, nullable=False, default="general")  # general, currency, units, etc.
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    tenant = relationship("Tenant", foreign_keys=[tenant_id])
    
    __table_args__ = (
        {'extend_existing': True},
    )

class TenantCurrency(Base):
    """Tenant-specific currency settings"""
    __tablename__ = "tenant_currencies"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    currency_code = Column(String, nullable=False)  # Reference to platform Currency.code
    is_default = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    tenant = relationship("Tenant", foreign_keys=[tenant_id])
    
    __table_args__ = (
        {'extend_existing': True},
    )

class TenantUOM(Base):
    """Tenant-specific units of measure"""
    __tablename__ = "tenant_uoms"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    uom_code = Column(String, nullable=False)  # Reference to platform UnitOfMeasure.code
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    tenant = relationship("Tenant", foreign_keys=[tenant_id])
    
    __table_args__ = (
        {'extend_existing': True},
    )

