"""
Tenant Settings API
Settings management for tenant companies
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel
from app.core.dependencies import get_db, get_current_user, get_tenant_id
from app.modules.tenancy.models import User, Tenant
from app.modules.tenancy.settings_models import TenantSettings, TenantCurrency, TenantUOM
from app.modules.platform.models import Currency, UnitOfMeasure

router = APIRouter()

# ==================== Pydantic Models ====================

class SettingUpdate(BaseModel):
    value: str
    value_type: Optional[str] = "string"

class SettingResponse(BaseModel):
    key: str
    value: str
    value_type: str
    category: str
    description: Optional[str]
    
    class Config:
        from_attributes = True

class CurrencyResponse(BaseModel):
    code: str
    name: str
    symbol: str
    is_default: bool
    is_active: bool
    decimal_places: int
    
    class Config:
        from_attributes = True

class UOMResponse(BaseModel):
    code: str
    name: str
    category: str
    base_unit: Optional[str]
    conversion_factor: float
    is_active: bool
    
    class Config:
        from_attributes = True

# ==================== Tenant Settings ====================

@router.get("/settings", response_model=List[SettingResponse])
async def get_tenant_settings(
    category: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(get_tenant_id)
):
    """Get tenant settings"""
    query = db.query(TenantSettings).filter(TenantSettings.tenant_id == tenant_id)
    if category:
        query = query.filter(TenantSettings.category == category)
    settings = query.order_by(TenantSettings.category, TenantSettings.key).all()
    
    # If no settings exist, return empty list (settings will be created on first update)
    return settings

@router.get("/settings/{key}", response_model=SettingResponse)
async def get_tenant_setting(
    key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(get_tenant_id)
):
    """Get a specific tenant setting"""
    setting = db.query(TenantSettings).filter(
        TenantSettings.tenant_id == tenant_id,
        TenantSettings.key == key
    ).first()
    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")
    return setting

@router.put("/settings/{key}")
async def update_tenant_setting(
    key: str,
    setting_data: SettingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(get_tenant_id)
):
    """Update a tenant setting (creates if doesn't exist)"""
    setting = db.query(TenantSettings).filter(
        TenantSettings.tenant_id == tenant_id,
        TenantSettings.key == key
    ).first()
    
    if not setting:
        # Create new setting with default category
        setting = TenantSettings(
            tenant_id=tenant_id,
            key=key,
            value=setting_data.value,
            value_type=setting_data.value_type,
            category="general"
        )
        db.add(setting)
    else:
        setting.value = setting_data.value
        setting.value_type = setting_data.value_type
        setting.updated_at = datetime.utcnow()
    
    db.commit()
    return {"message": "Setting updated successfully"}

# ==================== Tenant Currencies ====================

@router.get("/currencies", response_model=List[CurrencyResponse])
async def get_tenant_currencies(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(get_tenant_id)
):
    """Get available currencies for tenant (from platform + tenant-specific)"""
    # Get platform currencies
    platform_currencies = db.query(Currency).filter(Currency.is_active == True).all()
    
    # Get tenant currency preferences
    tenant_currencies = db.query(TenantCurrency).filter(
        TenantCurrency.tenant_id == tenant_id
    ).all()
    
    # Build currency map
    tenant_currency_map = {tc.currency_code: tc for tc in tenant_currencies}
    
    result = []
    # Check if tenant has any default currency set
    tenant_has_default = any(tc.is_default for tc in tenant_currencies)
    
    for currency in platform_currencies:
        tenant_currency = tenant_currency_map.get(currency.code)
        # Determine if this is the default currency
        is_default = False
        if tenant_currency:
            is_default = tenant_currency.is_default
        elif not tenant_has_default:
            # If tenant hasn't set a default, use platform default
            is_default = currency.is_default
        
        result.append({
            "code": currency.code,
            "name": currency.name,
            "symbol": currency.symbol,
            "is_default": is_default,
            "is_active": tenant_currency.is_active if tenant_currency else True,
            "decimal_places": currency.decimal_places
        })
    
    return result

@router.put("/currencies/{currency_code}/default")
async def set_default_currency(
    currency_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(get_tenant_id)
):
    """Set default currency for tenant"""
    # Check if currency exists in platform
    currency = db.query(Currency).filter(Currency.code == currency_code).first()
    if not currency:
        raise HTTPException(status_code=404, detail="Currency not found")
    
    # Unset other defaults
    db.query(TenantCurrency).filter(
        TenantCurrency.tenant_id == tenant_id,
        TenantCurrency.is_default == True
    ).update({"is_default": False})
    
    # Set new default
    tenant_currency = db.query(TenantCurrency).filter(
        TenantCurrency.tenant_id == tenant_id,
        TenantCurrency.currency_code == currency_code
    ).first()
    
    if not tenant_currency:
        tenant_currency = TenantCurrency(
            tenant_id=tenant_id,
            currency_code=currency_code,
            is_default=True,
            is_active=True
        )
        db.add(tenant_currency)
    else:
        tenant_currency.is_default = True
        tenant_currency.is_active = True
    
    db.commit()
    return {"message": "Default currency updated successfully"}

@router.put("/currencies/{currency_code}/toggle")
async def toggle_currency(
    currency_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(get_tenant_id)
):
    """Toggle currency active status for tenant"""
    tenant_currency = db.query(TenantCurrency).filter(
        TenantCurrency.tenant_id == tenant_id,
        TenantCurrency.currency_code == currency_code
    ).first()
    
    if not tenant_currency:
        tenant_currency = TenantCurrency(
            tenant_id=tenant_id,
            currency_code=currency_code,
            is_active=True
        )
        db.add(tenant_currency)
    else:
        tenant_currency.is_active = not tenant_currency.is_active
    
    db.commit()
    return {"message": "Currency status updated successfully"}

# ==================== Tenant UOMs ====================

@router.get("/uoms", response_model=List[UOMResponse])
async def get_tenant_uoms(
    category: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(get_tenant_id)
):
    """Get available UOMs for tenant (from platform + tenant-specific)"""
    from app.modules.catalog.uom_resolve import ensure_minimal_platform_uoms

    ensure_minimal_platform_uoms(db)

    # Get platform UOMs
    query = db.query(UnitOfMeasure).filter(UnitOfMeasure.is_active == True)
    if category:
        query = query.filter(UnitOfMeasure.category == category)
    platform_uoms = query.all()
    
    # Get tenant UOM preferences
    tenant_uoms = db.query(TenantUOM).filter(
        TenantUOM.tenant_id == tenant_id
    ).all()
    
    # Build UOM map
    tenant_uom_map = {tu.uom_code: tu for tu in tenant_uoms}
    
    result = []
    for uom in platform_uoms:
        tenant_uom = tenant_uom_map.get(uom.code)
        result.append({
            "code": uom.code,
            "name": uom.name,
            "category": uom.category,
            "base_unit": uom.base_unit,
            "conversion_factor": float(uom.conversion_factor),
            "is_active": tenant_uom.is_active if tenant_uom else True
        })
    
    return result

@router.put("/uoms/{uom_code}/toggle")
async def toggle_uom(
    uom_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(get_tenant_id)
):
    """Toggle UOM active status for tenant"""
    # Check if UOM exists in platform
    uom = db.query(UnitOfMeasure).filter(UnitOfMeasure.code == uom_code).first()
    if not uom:
        raise HTTPException(status_code=404, detail="UOM not found")
    
    tenant_uom = db.query(TenantUOM).filter(
        TenantUOM.tenant_id == tenant_id,
        TenantUOM.uom_code == uom_code
    ).first()
    
    if not tenant_uom:
        tenant_uom = TenantUOM(
            tenant_id=tenant_id,
            uom_code=uom_code,
            is_active=True
        )
        db.add(tenant_uom)
    else:
        tenant_uom.is_active = not tenant_uom.is_active
    
    db.commit()
    return {"message": "UOM status updated successfully"}

