"""
Create sample employees for Master Filling Station when none exist (or with --force).

Usage:
  python manage.py seed_master_employees
  python manage.py seed_master_employees --force   # add samples even if some already exist
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError

from api.models import Company, Employee


def _resolve_master(stdout, style) -> Company:
    master = Company.objects.filter(
        name__iexact="Master Filling Station", is_deleted=False
    ).first()
    if not master:
        master = Company.objects.filter(is_master="true", is_deleted=False).first()
    if not master:
        raise CommandError(
            'No Master company found. Create "Master Filling Station" first.'
        )
    return master


SAMPLES = [
    {
        "employee_code": "EMP-001",
        "first_name": "Karim",
        "last_name": "Hossain",
        "email": "karim.h@masterfs-demo.local",
        "phone": "+880-171-1000001",
        "job_title": "Station Manager",
        "department": "Operations",
        "hire_date": date(2022, 3, 1),
        "salary": Decimal("85000.00"),
    },
    {
        "employee_code": "EMP-002",
        "first_name": "Nasrin",
        "last_name": "Akter",
        "email": "nasrin.a@masterfs-demo.local",
        "phone": "+880-181-2000002",
        "job_title": "Head Cashier",
        "department": "Front Office",
        "hire_date": date(2022, 6, 15),
        "salary": Decimal("42000.00"),
    },
    {
        "employee_code": "EMP-003",
        "first_name": "Rafiq",
        "last_name": "Islam",
        "email": "rafiq.i@masterfs-demo.local",
        "phone": "+880-191-3000003",
        "job_title": "Pump Attendant",
        "department": "Forecourt",
        "hire_date": date(2023, 1, 10),
        "salary": Decimal("28000.00"),
    },
    {
        "employee_code": "EMP-004",
        "first_name": "Shila",
        "last_name": "Begum",
        "email": "shila.b@masterfs-demo.local",
        "phone": "+880-161-4000004",
        "job_title": "Inventory Clerk",
        "department": "Shop",
        "hire_date": date(2023, 8, 1),
        "salary": Decimal("35000.00"),
    },
    {
        "employee_code": "EMP-005",
        "first_name": "Jamal",
        "last_name": "Uddin",
        "email": "jamal.u@masterfs-demo.local",
        "phone": "+880-151-5000005",
        "job_title": "Night Supervisor",
        "department": "Operations",
        "hire_date": date(2024, 2, 20),
        "salary": Decimal("48000.00"),
    },
]


class Command(BaseCommand):
    help = "Seed Master Filling Station with sample employees."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Create sample rows even if employees already exist (skips duplicate codes).",
        )

    def handle(self, *args, **options):
        master = _resolve_master(self.stdout, self.style)
        cid = master.id
        existing = Employee.objects.filter(company_id=cid).count()
        if existing > 0 and not options["force"]:
            self.stdout.write(
                self.style.WARNING(
                    f"Master company id={cid} already has {existing} employee(s). "
                    "Use --force to add samples (duplicate codes skipped), or leave as-is."
                )
            )
            return

        created = 0
        for spec in SAMPLES:
            code = spec["employee_code"]
            if Employee.objects.filter(company_id=cid, employee_code=code).exists():
                self.stdout.write(f"Skip duplicate code {code!r}")
                continue
            e = Employee(
                company_id=cid,
                employee_code=code,
                employee_number=code,
                first_name=spec["first_name"],
                last_name=spec["last_name"],
                email=spec["email"],
                phone=spec["phone"],
                job_title=spec["job_title"],
                department=spec["department"],
                hire_date=spec["hire_date"],
                salary=spec["salary"],
                opening_balance=Decimal("0"),
                current_balance=Decimal("0"),
                is_active=True,
            )
            e.save()
            if not e.employee_number:
                Employee.objects.filter(pk=e.pk).update(employee_number=f"EMP-{e.id}")
            created += 1
            self.stdout.write(
                self.style.SUCCESS(
                    f"Created {e.first_name} {e.last_name} ({code}) id={e.id}"
                )
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Done. Master Filling Station (id={cid}): +{created} employee(s); "
                f"total now {Employee.objects.filter(company_id=cid).count()}."
            )
        )
