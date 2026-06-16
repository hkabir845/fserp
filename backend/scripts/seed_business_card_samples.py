"""
Create sample payroll employees and linked digital business cards for NFC demo.

Run from backend folder:
  python scripts/seed_business_card_samples.py

Uses tenant domain "localhost" by default (override with TENANT_DOMAIN env).
Idempotent: skips employees that already exist (matched by work email).
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.db.base import init_db
from app.modules.tenancy.models import Tenant
from app.modules.payroll.models import Employee, SalaryStructure
from app.modules.cards.models import EmployeeBusinessCard


def run() -> None:
    init_db()
    domain = os.environ.get("TENANT_DOMAIN", "localhost")
    db: Session = SessionLocal()
    try:
        tenant = db.query(Tenant).filter(Tenant.domain == domain).first()
        if not tenant:
            print(f"No tenant with domain={domain!r}. Create one (seed.py) or set TENANT_DOMAIN.")
            return

        samples: list[dict] = [
            {
                "name": "Rahim Khan",
                "designation": "Regional Sales Manager",
                "department": "Sales & Distribution",
                "phone": "+880 1711-100001",
                "email": "rahim.khan.sample@fmerp.demo",
                "join_date": datetime(2022, 3, 15),
                "basic": Decimal("85000"),
                "card": {
                    "bio": "Feed sales coverage for Dhaka & Mymensingh divisions; dealer onboarding.",
                    "website": "https://fmerp.demo",
                    "address": "Plot 12, Industrial Avenue, Tongi, Gazipur",
                    "blood_group": "B+",
                    "emergency_contact_name": "Ayesha Khan",
                    "emergency_contact_phone": "+880 1811-200001",
                    "profile_notes": "Feed safety certified; fluent EN/BN.",
                    "nfc_tag_uid": "04A1B2C3D4E5F6",
                    "access_zones": ["Main gate", "Sales office", "Warehouse B"],
                    "role_access": True,
                    "payment_enrolled": True,
                    "payment_last4_hint": "4821",
                    "payment_notes": "Corporate card — reimbursements via payroll",
                    "theme": "emerald",
                },
            },
            {
                "name": "Nusrat Jahan",
                "designation": "QC Lab Supervisor",
                "department": "Quality Control",
                "phone": "+880 1711-100002",
                "email": "nusrat.jahan.sample@fmerp.demo",
                "join_date": datetime(2021, 7, 1),
                "basic": Decimal("72000"),
                "card": {
                    "bio": "Moisture, protein, and aflatoxin testing for incoming grain and finished feed.",
                    "website": None,
                    "address": "QC Block, Mill Campus, Tongi",
                    "blood_group": "O+",
                    "emergency_contact_name": "Md. Karim",
                    "emergency_contact_phone": "+880 1911-300002",
                    "profile_notes": "ISO 17025 internal auditor.",
                    "nfc_tag_uid": "04B2C3D4E5F607",
                    "access_zones": ["Main gate", "QC lab", "Mill floor"],
                    "role_access": True,
                    "payment_enrolled": False,
                    "theme": "slate",
                },
            },
            {
                "name": "Karim Hassan",
                "designation": "Fleet & Logistics Lead",
                "department": "Transport",
                "phone": "+880 1711-100003",
                "email": "karim.hassan.sample@fmerp.demo",
                "join_date": datetime(2020, 11, 20),
                "basic": Decimal("68000"),
                "card": {
                    "bio": "Bulk delivery scheduling, GPS fleet checks, and cold-chain feed drops.",
                    "address": "Transport yard — Gate 3",
                    "blood_group": "A+",
                    "emergency_contact_name": "Hasan Transport Desk",
                    "emergency_contact_phone": "+880 1611-400003",
                    "nfc_tag_uid": "04C3D4E5F60718",
                    "access_zones": ["Main gate", "Loading bay", "Weighbridge"],
                    "role_access": True,
                    "theme": "slate",
                },
            },
            {
                "name": "Fatema Begum",
                "designation": "HR & Admin Officer",
                "department": "Human Resources",
                "phone": "+880 1711-100004",
                "email": "fatema.begum.sample@fmerp.demo",
                "join_date": datetime(2019, 1, 10),
                "basic": Decimal("55000"),
                "card": {
                    "bio": "Onboarding, leave, and employee ID / NFC badge provisioning.",
                    "address": "Admin Block — 2nd floor",
                    "blood_group": "AB+",
                    "emergency_contact_name": "Office reception",
                    "emergency_contact_phone": "+880 2-9800000",
                    "profile_notes": "Primary contact for visitor badges.",
                    "nfc_tag_uid": "04D4E5F6071829",
                    "access_zones": ["Main gate", "Admin", "Cafeteria"],
                    "role_access": False,
                    "theme": "emerald",
                },
            },
        ]

        created = 0
        for row in samples:
            email = row["email"]
            emp = db.query(Employee).filter(Employee.tenant_id == tenant.id, Employee.email == email).first()
            if not emp:
                emp = Employee(
                    tenant_id=tenant.id,
                    name=row["name"],
                    phone=row["phone"],
                    email=email,
                    department=row["department"],
                    designation=row["designation"],
                    join_date=row["join_date"],
                    is_active=True,
                    created_by=None,
                )
                db.add(emp)
                db.flush()
                ss = SalaryStructure(
                    tenant_id=tenant.id,
                    employee_id=emp.id,
                    basic=row["basic"],
                    allowances_json=None,
                    deductions_json=None,
                    effective_from=row["join_date"],
                    effective_to=None,
                    created_by=None,
                )
                db.add(ss)
                created += 1
                print(f"Created employee: {emp.name} ({email})")
            else:
                print(f"Skip employee (exists): {emp.name}")

            cdata = row["card"]
            code = f"EMP-{emp.id:05d}"
            existing = (
                db.query(EmployeeBusinessCard)
                .filter(
                    EmployeeBusinessCard.tenant_id == tenant.id,
                    EmployeeBusinessCard.employee_id == emp.id,
                )
                .first()
            )
            if existing:
                print(f"  Skip card (exists): {existing.public_slug}")
                continue

            slug = f"sample-{emp.id}-{uuid.uuid4().hex[:10]}"
            card = EmployeeBusinessCard(
                tenant_id=tenant.id,
                user_id=None,
                employee_id=emp.id,
                public_slug=slug[:60],
                display_name=emp.name,
                title=emp.designation,
                department=emp.department,
                phone=emp.phone,
                email=emp.email,
                website=cdata.get("website"),
                address=cdata.get("address"),
                bio=cdata.get("bio"),
                theme=cdata.get("theme") or "slate",
                show_phone=True,
                show_email=True,
                nfc_tag_uid=cdata.get("nfc_tag_uid"),
                paper_card_ordered=False,
                role_business_card=True,
                role_employee_id=True,
                role_access=bool(cdata.get("role_access", False)),
                role_payment=bool(cdata.get("payment_enrolled", False)),
                employee_code=code,
                photo_url=None,
                join_date=emp.join_date,
                blood_group=cdata.get("blood_group"),
                emergency_contact_name=cdata.get("emergency_contact_name"),
                emergency_contact_phone=cdata.get("emergency_contact_phone"),
                profile_notes=cdata.get("profile_notes"),
                access_zones_json=cdata.get("access_zones"),
                access_valid_from=None,
                access_valid_to=None,
                access_notes=None,
                payment_enrolled=bool(cdata.get("payment_enrolled", False)),
                payment_provider_ref=None,
                payment_last4_hint=cdata.get("payment_last4_hint"),
                payment_notes=cdata.get("payment_notes"),
                vcard_json={"fn": emp.name},
                created_by=None,
            )
            db.add(card)
            print(f"  Added digital card slug={card.public_slug}")

        db.commit()
        print(f"Done. Created {created} new employee(s); cards added where missing.")
    finally:
        db.close()


if __name__ == "__main__":
    run()
