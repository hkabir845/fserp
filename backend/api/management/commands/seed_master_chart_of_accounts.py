"""
Seed chart of accounts for Master Filling Station using the FSERP fuel-station template.

Usage:
  python manage.py seed_master_chart_of_accounts
  python manage.py seed_master_chart_of_accounts --replace
  python manage.py seed_master_chart_of_accounts --profile retail
"""
from django.core.management.base import BaseCommand
from api.models import Company
from api.chart_templates.fuel_station import seed_fuel_station_chart


class Command(BaseCommand):
    help = "Seed chart of accounts for Master Filling Station from the fuel_station_v1 template."

    def add_arguments(self, parser):
        parser.add_argument(
            "--replace",
            action="store_true",
            help="Delete existing chart of accounts for Master Filling Station, then import the template.",
        )
        parser.add_argument(
            "--profile",
            choices=("full", "retail"),
            default="full",
            help="Template profile: full (fuel + c-store + broad expenses) or retail (fuel-first).",
        )

    def handle(self, *args, **options):
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
            master.save(update_fields=["is_master"])
            self.stdout.write("Using company: Master Filling Station (id={})".format(master.id))

        profile = options["profile"]
        result = seed_fuel_station_chart(
            master.id,
            profile=profile,
            replace=options.get("replace", False),
        )

        self.stdout.write(
            "Template {} profile={}: added={}, skipped={}, removed={}".format(
                result["template_id"],
                result["profile"],
                result["added"],
                result["skipped"],
                result["removed"],
            )
        )
        self.stdout.write(
            self.style.SUCCESS(
                "Chart of accounts for Master Filling Station: total {} account(s).".format(result["total_now"])
            )
        )
