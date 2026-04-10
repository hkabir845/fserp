"""Create a default company if none exist (for admin/companies and companies/current)."""
from django.core.management.base import BaseCommand
from api.models import Company
from api.chart_templates.fuel_station import seed_fuel_station_if_empty


class Command(BaseCommand):
    help = "Create a default company if none exist."

    def handle(self, *args, **options):
        if Company.objects.filter(is_deleted=False).exists():
            self.stdout.write(self.style.WARNING("At least one company already exists. Skipping."))
            return
        c = Company.objects.create(
            name="Master Filling Station",
            legal_name="Master Filling Station (Development)",
            currency="BDT",
            is_active=True,
            is_master="true",
        )
        coa = seed_fuel_station_if_empty(c.id, profile="full")
        self.stdout.write(self.style.SUCCESS("Master Filling Station (development tenant) created."))
        if coa.get("seeded"):
            self.stdout.write(
                "Chart of accounts (fuel_station_v1 full): added {} account(s).".format(coa.get("added", 0))
            )
        else:
            self.stdout.write("Chart of accounts: {}.".format(coa.get("reason", "unchanged")))
