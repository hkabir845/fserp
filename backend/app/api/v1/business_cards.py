import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.dependencies import get_db, get_current_user, require_tenant_id
from app.modules.cards.models import EmployeeBusinessCard
from app.modules.payroll.models import Employee
from app.modules.tenancy.models import User

router = APIRouter()


def _slugify(s: str) -> str:
    s = s.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")[:48] or "card"


class CardUpsert(BaseModel):
    display_name: str
    title: Optional[str] = None
    department: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    address: Optional[str] = None
    bio: Optional[str] = None
    theme: Optional[str] = "slate"
    show_phone: bool = True
    show_email: bool = True
    nfc_tag_uid: Optional[str] = None
    paper_card_ordered: bool = False

    role_business_card: bool = True
    role_employee_id: bool = True
    role_access: bool = False
    role_payment: bool = False

    employee_code: Optional[str] = None
    photo_url: Optional[str] = None
    join_date: Optional[datetime] = None
    blood_group: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    profile_notes: Optional[str] = None

    access_zones: Optional[List[str]] = None
    access_valid_from: Optional[datetime] = None
    access_valid_to: Optional[datetime] = None
    access_notes: Optional[str] = None

    payment_enrolled: bool = False
    payment_provider_ref: Optional[str] = None
    payment_last4_hint: Optional[str] = Field(None, max_length=8)
    payment_notes: Optional[str] = None


class CardResponse(BaseModel):
    id: int
    user_id: Optional[int] = None
    employee_id: Optional[int] = None
    public_slug: str
    display_name: str
    title: Optional[str]
    department: Optional[str]
    phone: Optional[str]
    email: Optional[str]
    website: Optional[str]
    address: Optional[str]
    bio: Optional[str]
    theme: Optional[str]
    show_phone: bool
    show_email: bool
    nfc_tag_uid: Optional[str]
    paper_card_ordered: bool
    digital_card_url: str

    role_business_card: bool
    role_employee_id: bool
    role_access: bool
    role_payment: bool

    employee_code: Optional[str]
    photo_url: Optional[str]
    join_date: Optional[datetime]
    blood_group: Optional[str]
    emergency_contact_name: Optional[str]
    emergency_contact_phone: Optional[str]
    profile_notes: Optional[str]

    access_zones: Optional[List[str]]
    access_valid_from: Optional[datetime]
    access_valid_to: Optional[datetime]
    access_notes: Optional[str]

    payment_enrolled: bool
    payment_provider_ref: Optional[str]
    payment_last4_hint: Optional[str]
    payment_notes: Optional[str]

    class Config:
        from_attributes = True


class PublicDigitalCard(BaseModel):
    """Structured view for NFC/QR landing — sections depend on enabled roles."""

    slug: str
    preview_url: str
    roles: Dict[str, bool]
    business: Optional[Dict[str, Any]] = None
    identity: Optional[Dict[str, Any]] = None
    access: Optional[Dict[str, Any]] = None
    payment: Optional[Dict[str, Any]] = None


def _zones(card: EmployeeBusinessCard) -> Optional[List[str]]:
    z = card.access_zones_json
    if z is None:
        return None
    if isinstance(z, list):
        return [str(x) for x in z]
    return None


def _to_response(card: EmployeeBusinessCard) -> CardResponse:
    return CardResponse(
        id=card.id,
        user_id=card.user_id,
        employee_id=card.employee_id,
        public_slug=card.public_slug,
        display_name=card.display_name,
        title=card.title,
        department=card.department,
        phone=card.phone,
        email=card.email,
        website=card.website,
        address=card.address,
        bio=card.bio,
        theme=card.theme,
        show_phone=card.show_phone,
        show_email=card.show_email,
        nfc_tag_uid=card.nfc_tag_uid,
        paper_card_ordered=card.paper_card_ordered,
        digital_card_url=f"/cards/preview/{card.public_slug}",
        role_business_card=bool(card.role_business_card),
        role_employee_id=bool(card.role_employee_id),
        role_access=bool(card.role_access),
        role_payment=bool(card.role_payment),
        employee_code=card.employee_code,
        photo_url=card.photo_url,
        join_date=card.join_date,
        blood_group=card.blood_group,
        emergency_contact_name=card.emergency_contact_name,
        emergency_contact_phone=card.emergency_contact_phone,
        profile_notes=card.profile_notes,
        access_zones=_zones(card),
        access_valid_from=card.access_valid_from,
        access_valid_to=card.access_valid_to,
        access_notes=card.access_notes,
        payment_enrolled=bool(card.payment_enrolled),
        payment_provider_ref=card.payment_provider_ref,
        payment_last4_hint=card.payment_last4_hint,
        payment_notes=card.payment_notes,
    )


def _to_public_payload(card: EmployeeBusinessCard) -> PublicDigitalCard:
    roles = {
        "business_card": bool(card.role_business_card),
        "employee_id": bool(card.role_employee_id),
        "access": bool(card.role_access),
        "payment": bool(card.role_payment),
    }
    business = None
    if card.role_business_card:
        business = {
            "display_name": card.display_name,
            "title": card.title,
            "department": card.department,
            "phone": card.phone if card.show_phone else None,
            "email": card.email if card.show_email else None,
            "website": card.website,
            "address": card.address,
            "bio": card.bio,
            "theme": card.theme or "slate",
        }
    identity = None
    if card.role_employee_id:
        identity = {
            "display_name": card.display_name,
            "employee_code": card.employee_code,
            "title": card.title,
            "department": card.department,
            "photo_url": card.photo_url,
            "join_date": card.join_date.isoformat() if card.join_date else None,
            "blood_group": card.blood_group,
            "emergency_contact_name": card.emergency_contact_name,
            "emergency_contact_phone": card.emergency_contact_phone,
        }
    access = None
    if card.role_access:
        access = {
            "zones": _zones(card) or [],
            "valid_from": card.access_valid_from.isoformat() if card.access_valid_from else None,
            "valid_to": card.access_valid_to.isoformat() if card.access_valid_to else None,
            "notes": card.access_notes,
            "nfc_tag_uid_hint": (card.nfc_tag_uid[-6:] if card.nfc_tag_uid and len(card.nfc_tag_uid) > 6 else card.nfc_tag_uid),
        }
    payment = None
    if card.role_payment:
        payment = {
            "enrolled": bool(card.payment_enrolled),
            "card_hint": card.payment_last4_hint,
            "notes": card.payment_notes,
        }

    return PublicDigitalCard(
        slug=card.public_slug,
        preview_url=f"/cards/preview/{card.public_slug}",
        roles=roles,
        business=business,
        identity=identity,
        access=access,
        payment=payment,
    )


def _apply_card_fields(card: EmployeeBusinessCard, body: CardUpsert) -> None:
    card.display_name = body.display_name
    card.title = body.title
    card.department = body.department
    card.phone = body.phone
    card.email = body.email
    card.website = body.website
    card.address = body.address
    card.bio = body.bio
    card.theme = body.theme or "slate"
    card.show_phone = body.show_phone
    card.show_email = body.show_email
    card.nfc_tag_uid = body.nfc_tag_uid
    card.paper_card_ordered = body.paper_card_ordered

    card.role_business_card = body.role_business_card
    card.role_employee_id = body.role_employee_id
    card.role_access = body.role_access
    card.role_payment = body.role_payment

    card.employee_code = body.employee_code
    card.photo_url = body.photo_url
    card.join_date = body.join_date
    card.blood_group = body.blood_group
    card.emergency_contact_name = body.emergency_contact_name
    card.emergency_contact_phone = body.emergency_contact_phone
    card.profile_notes = body.profile_notes

    card.access_zones_json = body.access_zones
    card.access_valid_from = body.access_valid_from
    card.access_valid_to = body.access_valid_to
    card.access_notes = body.access_notes

    card.payment_enrolled = body.payment_enrolled
    card.payment_provider_ref = body.payment_provider_ref
    card.payment_last4_hint = body.payment_last4_hint
    card.payment_notes = body.payment_notes

    card.vcard_json = {
        "fn": body.display_name,
        "title": body.title,
        "tel": body.phone,
        "email": body.email,
        "url": body.website,
        "adr": body.address,
        "roles": {
            "business_card": body.role_business_card,
            "employee_id": body.role_employee_id,
            "access": body.role_access,
            "payment": body.role_payment,
        },
    }


@router.get("/me", response_model=CardResponse)
async def get_my_card(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    card = (
        db.query(EmployeeBusinessCard)
        .filter(
            EmployeeBusinessCard.tenant_id == tenant_id,
            EmployeeBusinessCard.user_id == current_user.id,
        )
        .first()
    )
    if not card:
        raise HTTPException(status_code=404, detail="No business card yet — create one with PUT /cards/me")
    return _to_response(card)


@router.put("/me", response_model=CardResponse)
async def upsert_my_card(
    body: CardUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    card = (
        db.query(EmployeeBusinessCard)
        .filter(
            EmployeeBusinessCard.tenant_id == tenant_id,
            EmployeeBusinessCard.user_id == current_user.id,
        )
        .first()
    )
    if not card:
        base = _slugify(body.display_name) + "-" + uuid.uuid4().hex[:8]
        card = EmployeeBusinessCard(
            tenant_id=tenant_id,
            user_id=current_user.id,
            employee_id=None,
            public_slug=base,
            display_name=body.display_name,
            created_by=current_user.id,
        )
        db.add(card)

    _apply_card_fields(card, body)
    db.commit()
    db.refresh(card)
    return _to_response(card)


def _get_employee_for_tenant(db: Session, tenant_id: int, employee_id: int) -> Employee:
    emp = (
        db.query(Employee)
        .filter(Employee.id == employee_id, Employee.tenant_id == tenant_id)
        .first()
    )
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    return emp


@router.get("/by-employee/{employee_id}", response_model=CardResponse)
async def get_card_by_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    _get_employee_for_tenant(db, tenant_id, employee_id)
    card = (
        db.query(EmployeeBusinessCard)
        .filter(
            EmployeeBusinessCard.tenant_id == tenant_id,
            EmployeeBusinessCard.employee_id == employee_id,
        )
        .first()
    )
    if not card:
        raise HTTPException(status_code=404, detail="No digital card for this employee yet")
    return _to_response(card)


@router.put("/by-employee/{employee_id}", response_model=CardResponse)
async def upsert_card_by_employee(
    employee_id: int,
    body: CardUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    _get_employee_for_tenant(db, tenant_id, employee_id)
    card = (
        db.query(EmployeeBusinessCard)
        .filter(
            EmployeeBusinessCard.tenant_id == tenant_id,
            EmployeeBusinessCard.employee_id == employee_id,
        )
        .first()
    )
    if not card:
        base = _slugify(body.display_name) + "-" + uuid.uuid4().hex[:8]
        card = EmployeeBusinessCard(
            tenant_id=tenant_id,
            user_id=None,
            employee_id=employee_id,
            public_slug=base,
            display_name=body.display_name,
            created_by=current_user.id,
        )
        db.add(card)

    _apply_card_fields(card, body)
    db.commit()
    db.refresh(card)
    return _to_response(card)


@router.get("/public/{slug}", response_model=PublicDigitalCard)
async def get_public_card(slug: str, db: Session = Depends(get_db)):
    """Public digital profile for NFC/QR; sections depend on enabled roles."""
    card = db.query(EmployeeBusinessCard).filter(EmployeeBusinessCard.public_slug == slug).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return _to_public_payload(card)


@router.get("/public/{slug}/legacy", response_model=CardResponse)
async def get_public_card_flat(slug: str, db: Session = Depends(get_db)):
    """Backward-compatible flat card shape (all stored fields)."""
    card = db.query(EmployeeBusinessCard).filter(EmployeeBusinessCard.public_slug == slug).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return _to_response(card)
