"""
Set operates_fuel_retail=True for stations that have tanks or islands but were marked non-fuel.

Usage:
  python manage.py reconcile_station_fuel_flags
  python manage.py reconcile_station_fuel_flags --company-id 3
  python manage.py reconcile_station_fuel_flags --dry-run
"""

from django.core.management.base import BaseCommand

from api.models import Company
from api.services.station_capabilities import reconcile_station_fuel_flags_for_company


class Command(BaseCommand):
    help = "Align operates_fuel_retail with actual forecourt assets (tanks / islands)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--company-id",
            type=int,
            default=None,
            help="Limit to one company; default is all non-deleted companies.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report how many stations would be updated without saving (uses same iterator logic).",
        )

    def handle(self, *args, **options):
        cid = options.get("company_id")
        dry = options.get("dry_run")
        qs = Company.objects.filter(is_deleted=False).order_by("id")
        if cid is not None:
            qs = qs.filter(pk=cid)
        companies = list(qs)
        if not companies:
            self.stdout.write(self.style.WARNING("No companies matched."))
            return

        total = 0
        for c in companies:
            if dry:
                from api.models import Island, Station, Tank

                n = 0
                for s in Station.objects.filter(company_id=c.id, operates_fuel_retail=False).iterator():
                    if Tank.objects.filter(station_id=s.id, company_id=c.id).exists() or Island.objects.filter(
                        station_id=s.id, company_id=c.id
                    ).exists():
                        n += 1
                if n:
                    self.stdout.write(f"Company {c.id} ({c.name!r}): would update {n} station(s)")
                total += n
            else:
                n = reconcile_station_fuel_flags_for_company(c.id)
                if n:
                    self.stdout.write(self.style.SUCCESS(f"Company {c.id} ({c.name!r}): updated {n} station(s)"))
                total += n

        if dry:
            self.stdout.write(self.style.WARNING(f"Dry run: {total} station(s) would be updated."))
        elif total == 0:
            self.stdout.write("No inconsistent stations found.")
        else:
            self.stdout.write(self.style.SUCCESS(f"Done. Total stations updated: {total}"))
