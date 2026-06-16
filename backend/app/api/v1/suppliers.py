from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from app.core.dependencies import get_db, get_current_user, get_tenant_id
from app.modules.accounting.party_ledger_service import (
    account_balance_for_display,
    post_opening_balance_for_supplier,
)
from app.modules.procurement.models import Supplier
from app.modules.tenancy.models import User

router = APIRouter()


class SupplierCreate(BaseModel):
    name: str
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    gstin: str | None = None
    bank_name: str | None = None
    bank_account_no: str | None = None
    bank_branch: str | None = None
    bank_routing_or_ifsc: str | None = None
    opening_balance: float = Field(
        0,
        description="Signed: + = we owe supplier (AP), − = prepayment to supplier (debit balance)",
    )
    opening_balance_as_of: Optional[datetime] = None


class SupplierUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    gstin: str | None = None
    bank_name: str | None = None
    bank_account_no: str | None = None
    bank_branch: str | None = None
    bank_routing_or_ifsc: str | None = None
    is_active: bool | None = None


class SupplierResponse(BaseModel):
    id: int
    name: str
    phone: str | None
    email: str | None
    address: str | None = None
    gstin: str | None = None
    bank_name: str | None = None
    bank_account_no: str | None = None
    bank_branch: str | None = None
    bank_routing_or_ifsc: str | None = None
    opening_balance: float = 0
    opening_balance_as_of: datetime | None = None
    gl_account_id: int | None = None
    gl_account_code: str | None = None
    ledger_balance: float | None = None
    is_active: bool

    class Config:
        from_attributes = True


def _fill_response(db: Session, tenant_id: int, s: Supplier) -> SupplierResponse:
    code = s.gl_account.code if s.gl_account_id and getattr(s, "gl_account", None) else None
    bal = account_balance_for_display(db, tenant_id, s.gl_account_id) if s.gl_account_id else None
    return SupplierResponse(
        id=s.id,
        name=s.name,
        phone=s.phone,
        email=s.email,
        address=s.address,
        gstin=s.gstin,
        bank_name=s.bank_name,
        bank_account_no=s.bank_account_no,
        bank_branch=s.bank_branch,
        bank_routing_or_ifsc=s.bank_routing_or_ifsc,
        opening_balance=float(s.opening_balance or 0),
        opening_balance_as_of=s.opening_balance_as_of,
        gl_account_id=s.gl_account_id,
        gl_account_code=code,
        ledger_balance=bal,
        is_active=s.is_active,
    )


@router.get("", response_model=List[SupplierResponse])
async def list_suppliers(
    request: Request,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all suppliers for tenant"""
    tenant_id = get_tenant_id(request)
    query = db.query(Supplier).filter(Supplier.tenant_id == tenant_id)
    if not include_inactive:
        query = query.filter(Supplier.is_active == True)
    suppliers = query.options(joinedload(Supplier.gl_account)).order_by(Supplier.id.desc()).all()
    return [_fill_response(db, tenant_id, s) for s in suppliers]


@router.post("", response_model=SupplierResponse)
async def create_supplier(
    supplier_data: SupplierCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create supplier — AP sub-ledger and optional opening balance."""
    tenant_id = get_tenant_id(request)
    ob = Decimal(str(supplier_data.opening_balance))
    as_of = supplier_data.opening_balance_as_of or datetime.utcnow()

    supplier = Supplier(
        tenant_id=tenant_id,
        name=supplier_data.name,
        phone=supplier_data.phone,
        email=supplier_data.email,
        address=supplier_data.address,
        gstin=supplier_data.gstin,
        bank_name=supplier_data.bank_name,
        bank_account_no=supplier_data.bank_account_no,
        bank_branch=supplier_data.bank_branch,
        bank_routing_or_ifsc=supplier_data.bank_routing_or_ifsc,
        opening_balance=ob,
        opening_balance_as_of=as_of if ob != 0 else None,
        created_by=current_user.id,
    )
    db.add(supplier)
    db.flush()
    try:
        ac, _ = post_opening_balance_for_supplier(
            db,
            tenant_id,
            supplier_id=supplier.id,
            display_name=supplier.name,
            opening=ob,
            as_of=as_of,
            posted_by=current_user.id,
        )
        supplier.gl_account_id = ac.id
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e)) from e
    db.commit()
    supplier = (
        db.query(Supplier)
        .options(joinedload(Supplier.gl_account))
        .filter(Supplier.tenant_id == tenant_id, Supplier.id == supplier.id)
        .first()
    )
    return _fill_response(db, tenant_id, supplier)


@router.get("/{supplier_id}", response_model=SupplierResponse)
async def get_supplier(
    supplier_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    supplier = (
        db.query(Supplier)
        .options(joinedload(Supplier.gl_account))
        .filter(Supplier.tenant_id == tenant_id, Supplier.id == supplier_id)
        .first()
    )
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return _fill_response(db, tenant_id, supplier)


@router.patch("/{supplier_id}", response_model=SupplierResponse)
async def update_supplier(
    supplier_id: int,
    payload: SupplierUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    supplier = db.query(Supplier).filter(Supplier.tenant_id == tenant_id, Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    if payload.name is not None:
        supplier.name = payload.name
    if payload.phone is not None:
        supplier.phone = payload.phone
    if payload.email is not None:
        supplier.email = payload.email
    if payload.address is not None:
        supplier.address = payload.address
    if payload.gstin is not None:
        supplier.gstin = payload.gstin
    if payload.bank_name is not None:
        supplier.bank_name = payload.bank_name
    if payload.bank_account_no is not None:
        supplier.bank_account_no = payload.bank_account_no
    if payload.bank_branch is not None:
        supplier.bank_branch = payload.bank_branch
    if payload.bank_routing_or_ifsc is not None:
        supplier.bank_routing_or_ifsc = payload.bank_routing_or_ifsc
    if payload.is_active is not None:
        supplier.is_active = payload.is_active

    db.commit()
    supplier = (
        db.query(Supplier)
        .options(joinedload(Supplier.gl_account))
        .filter(Supplier.tenant_id == tenant_id, Supplier.id == supplier_id)
        .first()
    )
    return _fill_response(db, tenant_id, supplier)


@router.delete("/{supplier_id}")
async def delete_supplier(
    supplier_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    supplier = db.query(Supplier).filter(Supplier.tenant_id == tenant_id, Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    supplier.is_active = False
    db.commit()
    return {"message": "Supplier deleted (soft) successfully"}
