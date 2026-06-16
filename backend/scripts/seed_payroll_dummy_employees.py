"""
Insert sample payroll employees for demos (Payroll → Employees, /cards roster).

Run from repo backend folder:
  python scripts/seed_payroll_dummy_employees.py

Environment:
  TENANT_DOMAIN  (default: localhost)

Idempotent: skips rows that already exist (matched by work email).
"""
from __future__ import annotations

import os
import sys
from datetime import datetime
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.db.base import init_db
from app.modules.tenancy.models import Tenant
from app.modules.payroll.models import Employee, SalaryStructure

SAMPLES: list[dict] = [
    {
        "name": "Rahim Khan",
        "designation": "Regional Sales Manager",
        "department": "Sales & Distribution",
        "phone": "+880 1711-100001",
        "email": "rahim.khan.sample@fmerp.demo",
        "join_date": datetime(2022, 3, 15),
        "basic": Decimal("85000"),
    },
    {
        "name": "Nusrat Jahan",
        "designation": "QC Lab Supervisor",
        "department": "Quality Control",
        "phone": "+880 1711-100002",
        "email": "nusrat.jahan.sample@fmerp.demo",
        "join_date": datetime(2021, 7, 1),
        "basic": Decimal("72000"),
    },
    {
        "name": "Karim Hassan",
        "designation": "Fleet & Logistics Lead",
        "department": "Transport",
        "phone": "+880 1711-100003",
        "email": "karim.hassan.sample@fmerp.demo",
        "join_date": datetime(2020, 11, 20),
        "basic": Decimal("68000"),
    },
    {
        "name": "Fatema Begum",
        "designation": "HR & Admin Officer",
        "department": "Human Resources",
        "phone": "+880 1711-100004",
        "email": "fatema.begum.sample@fmerp.demo",
        "join_date": datetime(2019, 1, 10),
        "basic": Decimal("55000"),
    },
    {
        "name": "Arif Ahmed",
        "designation": "Production Supervisor",
        "department": "Manufacturing",
        "phone": "+880 1711-100005",
        "email": "arif.ahmed.sample@fmerp.demo",
        "join_date": datetime(2023, 6, 1),
        "basic": Decimal("62000"),
    },
    {
        "name": "Sultana Rahman",
        "designation": "Accounts Officer",
        "department": "Finance",
        "phone": "+880 1711-100006",
        "email": "sultana.rahman.sample@fmerp.demo",
        "join_date": datetime(2021, 11, 15),
        "basic": Decimal("58000"),
    },
]


def run() -> None:
    init_db()
    domain = os.environ.get("TENANT_DOMAIN", "localhost")
    db: Session = SessionLocal()
    try:
        tenant = db.query(Tenant).filter(Tenant.domain == domain).first()
        if not tenant:
            print(f"No tenant with domain={domain!r}. Run scripts/seed.py first or set TENANT_DOMAIN.")
            return

        created = 0
        for row in SAMPLES:
            email = row["email"]
            existing = (
                db.query(Employee)
                .filter(Employee.tenant_id == tenant.id, Employee.email == email)
                .first()
            )
            if existing:
                print(f"Skip (exists): {existing.name} <{email}>")
                continue

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
            print(f"Created: {emp.name} <{email}> (basic {row['basic']})")

        db.commit()
        print(f"Done. Inserted {created} new employee(s) for tenant {domain!r}.")
    finally:
        db.close()


if __name__ == "__main__":
    run()
