"""
Create 12 sample dummy customers for Master Filling Station (development company).
Usage: python manage.py seed_master_customers
"""
from decimal import Decimal
from django.core.management.base import BaseCommand
from api.models import Company, Customer


# Sample dummy data for 12 filling-station-style customers
SAMPLE_CUSTOMERS = [
    {"display_name": "Green Line Paribahan", "company_name": "Green Line Paribahan Ltd", "phone": "+880-2-9123456", "billing_city": "Dhaka", "billing_country": "Bangladesh"},
    {"display_name": "Shyamoli Transport", "company_name": "Shyamoli Transport Co.", "phone": "+880-2-8112233", "billing_city": "Dhaka", "billing_country": "Bangladesh"},
    {"display_name": "Ena Transport", "company_name": "Ena Transport (Pvt) Ltd", "phone": "+880-2-5566778", "billing_city": "Dhaka", "billing_country": "Bangladesh"},
    {"display_name": "Hanif Enterprise", "company_name": "Hanif Enterprise", "phone": "+880-2-7788990", "billing_city": "Dhaka", "billing_country": "Bangladesh"},
    {"display_name": "SR Travels", "company_name": "SR Travels & Logistics", "phone": "+880-171-1234567", "billing_city": "Chittagong", "billing_country": "Bangladesh"},
    {"display_name": "Eagle Fleet Services", "company_name": "Eagle Fleet Services Ltd", "phone": "+880-181-2345678", "billing_city": "Dhaka", "billing_country": "Bangladesh"},
    {"display_name": "Metro Oil & Gas", "company_name": "Metro Oil & Gas (Dealer)", "phone": "+880-191-3456789", "billing_city": "Sylhet", "billing_country": "Bangladesh"},
    {"display_name": "Delta Logistics", "company_name": "Delta Logistics Pvt Ltd", "phone": "+880-161-4567890", "billing_city": "Dhaka", "billing_country": "Bangladesh"},
    {"display_name": "Star Fuel Card", "company_name": "Star Fuel Card Holders Co-op", "phone": "+880-2-9876543", "billing_city": "Dhaka", "billing_country": "Bangladesh"},
    {"display_name": "City Express", "company_name": "City Express Paribahan", "phone": "+880-152-5678901", "billing_city": "Rajshahi", "billing_country": "Bangladesh"},
    {"display_name": "National Fleet", "company_name": "National Fleet Management Ltd", "phone": "+880-2-8765432", "billing_city": "Dhaka", "billing_country": "Bangladesh"},
    {"display_name": "Coastal Petroleum", "company_name": "Coastal Petroleum Dealers", "phone": "+880-181-6789012", "billing_city": "Chittagong", "billing_country": "Bangladesh"},
]


class Command(BaseCommand):
    help = "Create 12 sample dummy customers for Master Filling Station."

    def add_arguments(self, parser):
        parser.add_argument(
            "--replace",
            action="store_true",
            help="Replace existing Master Filling Station customers with these 12 (delete existing first).",
        )

    def handle(self, *args, **options):
        # Get or create Master Filling Station
        master, created = Company.objects.get_or_create(
            name="Master Filling Station",
            is_deleted=False,
            defaults={
                "legal_name": "Master Filling Station (Development)",
                "currency": "BDT",
                "is_active": True,
                "is_master": "true",
            },
        )
        if created:
            self.stdout.write(self.style.SUCCESS("Created company: Master Filling Station"))
        else:
            master.is_master = "true"
            master.save()
            self.stdout.write("Using company: Master Filling Station")

        if options.get("replace"):
            deleted, _ = Customer.objects.filter(company_id=master.id).delete()
            self.stdout.write(self.style.WARNING(f"Removed {deleted} existing customer(s) for Master Filling Station."))

        existing = Customer.objects.filter(company_id=master.id).count()
        if existing >= 12:
            self.stdout.write(self.style.WARNING(f"Master Filling Station already has {existing} customers. Use --replace to replace with these 12."))
            return

        to_create = 12 - existing
        start_num = existing + 1
        created_count = 0

        for i, data in enumerate(SAMPLE_CUSTOMERS[:to_create]):
            num = start_num + i
            c = Customer(
                company_id=master.id,
                customer_number=f"CUST-{num}",
                display_name=data["display_name"],
                company_name=data["company_name"],
                email=data.get("email") or f"contact{i+1}@{data['company_name'].split()[0].lower()}.com",
                phone=data["phone"],
                billing_address_line1=data.get("billing_address_line1") or f"Billing address {num}",
                billing_city=data["billing_city"],
                billing_state=data.get("billing_state") or "",
                billing_country=data["billing_country"],
                opening_balance=Decimal("0"),
                current_balance=Decimal("0"),
                is_active=True,
            )
            c.save()
            created_count += 1
            self.stdout.write(f"  Created: {c.display_name} ({c.customer_number})")

        self.stdout.write(self.style.SUCCESS(f"Done. Created {created_count} customer(s) for Master Filling Station (total now: {existing + created_count})."))
