"""
One NFC tag / digital profile can fulfil multiple roles:
business networking, employee ID, physical/logical access, and (stub) wallet/payment enrollment.
"""
from sqlalchemy import Column, Integer, String, ForeignKey, Text, Boolean, JSON, DateTime
from sqlalchemy.orm import relationship
from app.shared.base import TenantBase


class EmployeeBusinessCard(TenantBase):
    __tablename__ = "employee_business_cards"

    # Either user_id (self-service /cards/me) or employee_id (HR-managed roster card) should be set.
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True, index=True)
    public_slug = Column(String, nullable=False, unique=True, index=True)
    display_name = Column(String, nullable=False)
    title = Column(String, nullable=True)
    department = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    email = Column(String, nullable=True)
    website = Column(String, nullable=True)
    address = Column(Text, nullable=True)
    bio = Column(Text, nullable=True)
    vcard_json = Column(JSON, nullable=True)
    nfc_tag_uid = Column(String, nullable=True, index=True)
    theme = Column(String, nullable=True, default="slate")  # slate, emerald, brand
    show_phone = Column(Boolean, default=True)
    show_email = Column(Boolean, default=True)
    paper_card_ordered = Column(Boolean, default=False)

    # Which “modes” this tag/profile participates in (integrate with readers & POS separately).
    role_business_card = Column(Boolean, default=True)
    role_employee_id = Column(Boolean, default=True)
    role_access = Column(Boolean, default=False)
    role_payment = Column(Boolean, default=False)

    # Digital employee profile (ID card + HR-facing)
    employee_code = Column(String, nullable=True, index=True)  # badge / HR id
    photo_url = Column(String, nullable=True)
    join_date = Column(DateTime, nullable=True)
    blood_group = Column(String, nullable=True)
    emergency_contact_name = Column(String, nullable=True)
    emergency_contact_phone = Column(String, nullable=True)
    profile_notes = Column(Text, nullable=True)  # internal-only-ish; still user-controlled

    # Access card (doors / zones — details for display; real auth is system-specific)
    access_zones_json = Column(JSON, nullable=True)  # list[str]
    access_valid_from = Column(DateTime, nullable=True)
    access_valid_to = Column(DateTime, nullable=True)
    access_notes = Column(Text, nullable=True)

    # Payment / wallet linkage (never store full card numbers — opaque refs only)
    payment_enrolled = Column(Boolean, default=False)
    payment_provider_ref = Column(String, nullable=True)  # token / wallet id from PSP
    payment_last4_hint = Column(String, nullable=True)  # e.g. last4 for display
    payment_notes = Column(Text, nullable=True)

    user = relationship("User", foreign_keys=[user_id])
    employee = relationship("Employee", foreign_keys=[employee_id])
