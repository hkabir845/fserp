from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from app.core.dependencies import get_db, get_current_user, get_tenant_id
from app.modules.accounting.party_ledger_service import (
    account_balance_for_display,
    post_opening_balance_for_customer,
)
from app.modules.sales.models import Customer
from app.modules.tenancy.models import User

router = APIRouter()


class CustomerCreate(BaseModel):
    name: str
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    gstin: str | None = None
    bank_name: str | None = None
    bank_account_no: str | None = None
    bank_branch: str | None = None
    bank_routing_or_ifsc: str | None = None
    opening_balance: float = Field(0, description="Signed: + = receivable (they owe you), − = customer advance")
    opening_balance_as_of: Optional[datetime] = None


class CustomerUpdate(BaseModel):
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


class CustomerResponse(BaseModel):
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


def _fill_response(db: Session, tenant_id: int, c: Customer) -> CustomerResponse:
    code = c.gl_account.code if c.gl_account_id and getattr(c, "gl_account", None) else None
    bal = account_balance_for_display(db, tenant_id, c.gl_account_id) if c.gl_account_id else None
    return CustomerResponse(
        id=c.id,
        name=c.name,
        phone=c.phone,
        email=c.email,
        address=c.address,
        gstin=c.gstin,
        bank_name=c.bank_name,
        bank_account_no=c.bank_account_no,
        bank_branch=c.bank_branch,
        bank_routing_or_ifsc=c.bank_routing_or_ifsc,
        opening_balance=float(c.opening_balance or 0),
        opening_balance_as_of=c.opening_balance_as_of,
        gl_account_id=c.gl_account_id,
        gl_account_code=code,
        ledger_balance=bal,
        is_active=c.is_active,
    )


@router.get("", response_model=List[CustomerResponse])
async def list_customers(
    request: Request,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all customers for tenant"""
    tenant_id = get_tenant_id(request)
    query = db.query(Customer).filter(Customer.tenant_id == tenant_id)
    if not include_inactive:
        query = query.filter(Customer.is_active == True)
    customers = (
        query.options(joinedload(Customer.gl_account)).order_by(Customer.id.desc()).all()
    )
    return [_fill_response(db, tenant_id, c) for c in customers]


@router.post("", response_model=CustomerResponse)
async def create_customer(
    customer_data: CustomerCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new customer — creates AR sub-ledger and optional opening balance journal."""
    tenant_id = get_tenant_id(request)
    ob = Decimal(str(customer_data.opening_balance))
    as_of = customer_data.opening_balance_as_of or datetime.utcnow()

    customer = Customer(
        tenant_id=tenant_id,
        name=customer_data.name,
        phone=customer_data.phone,
        email=customer_data.email,
        address=customer_data.address,
        gstin=customer_data.gstin,
        bank_name=customer_data.bank_name,
        bank_account_no=customer_data.bank_account_no,
        bank_branch=customer_data.bank_branch,
        bank_routing_or_ifsc=customer_data.bank_routing_or_ifsc,
        opening_balance=ob,
        opening_balance_as_of=as_of if ob != 0 else None,
        created_by=current_user.id,
    )
    db.add(customer)
    db.flush()
    try:
        ac, _ = post_opening_balance_for_customer(
            db,
            tenant_id,
            customer_id=customer.id,
            display_name=customer.name,
            opening=ob,
            as_of=as_of,
            posted_by=current_user.id,
        )
        customer.gl_account_id = ac.id
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e)) from e
    db.commit()
    customer = (
        db.query(Customer)
        .options(joinedload(Customer.gl_account))
        .filter(Customer.tenant_id == tenant_id, Customer.id == customer.id)
        .first()
    )
    return _fill_response(db, tenant_id, customer)


@router.get("/{customer_id}", response_model=CustomerResponse)
async def get_customer(
    customer_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    customer = (
        db.query(Customer)
        .options(joinedload(Customer.gl_account))
        .filter(Customer.tenant_id == tenant_id, Customer.id == customer_id)
        .first()
    )
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return _fill_response(db, tenant_id, customer)


@router.patch("/{customer_id}", response_model=CustomerResponse)
async def update_customer(
    customer_id: int,
    payload: CustomerUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    customer = db.query(Customer).filter(Customer.tenant_id == tenant_id, Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    if payload.name is not None:
        customer.name = payload.name
    if payload.phone is not None:
        customer.phone = payload.phone
    if payload.email is not None:
        customer.email = payload.email
    if payload.address is not None:
        customer.address = payload.address
    if payload.gstin is not None:
        customer.gstin = payload.gstin
    if payload.bank_name is not None:
        customer.bank_name = payload.bank_name
    if payload.bank_account_no is not None:
        customer.bank_account_no = payload.bank_account_no
    if payload.bank_branch is not None:
        customer.bank_branch = payload.bank_branch
    if payload.bank_routing_or_ifsc is not None:
        customer.bank_routing_or_ifsc = payload.bank_routing_or_ifsc
    if payload.is_active is not None:
        customer.is_active = payload.is_active

    db.commit()
    customer = (
        db.query(Customer)
        .options(joinedload(Customer.gl_account))
        .filter(Customer.tenant_id == tenant_id, Customer.id == customer_id)
        .first()
    )
    return _fill_response(db, tenant_id, customer)


@router.delete("/{customer_id}")
async def delete_customer(
    customer_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Soft-delete customer (rollback available via PATCH is_active=true)."""
    tenant_id = get_tenant_id(request)
    customer = db.query(Customer).filter(Customer.tenant_id == tenant_id, Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    customer.is_active = False
    db.commit()
    return {"message": "Customer deleted (soft) successfully"}
