"""
Assign 12 existing customers from the database to Master Filling Station (development company).
Usage: python manage.py assign_customers_to_master
"""
from django.core.management.base import BaseCommand
from api.models import Company, Customer


class Command(BaseCommand):
    help = "Assign up to 12 existing customers to Master Filling Station company."

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
            self.stdout.write("Using existing company: Master Filling Station")

        # Get up to 12 customers (any company), order by id
        customers = list(Customer.objects.all().order_by("id")[:12])
        if not customers:
            self.stdout.write(self.style.WARNING("No customers in database. Create customers first."))
            return

        updated = 0
        for c in customers:
            if c.company_id != master.id:
                c.company_id = master.id
                c.save()
                updated += 1
                self.stdout.write(f"  Assigned: {c.display_name or c.company_name or c.customer_number} (id={c.id})")

        self.stdout.write(self.style.SUCCESS(f"Done. {updated} customer(s) now belong to Master Filling Station (total pulled: {len(customers)})."))
