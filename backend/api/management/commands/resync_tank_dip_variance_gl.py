"""
Re-post tank dip variance journals (AUTO-TANKDIP-{id}-VAR) for all dips using current Item cost/unit_price.

Run after changing Diesel/Petrol unit to Liter, setting cost, or fixing chart accounts.
Fuel inventory (1200) amounts in those entries are recalculated from variance liters × rate.

Usage:
  python manage.py resync_tank_dip_variance_gl
  python manage.py resync_tank_dip_variance_gl --company-id 1
"""

from django.core.management.base import BaseCommand

from api.models import Company
from api.services.gl_posting import bulk_sync_tank_dip_variance_journals


class Command(BaseCommand):
    help = "Re-sync AUTO-TANKDIP-*-VAR journals for all tank dips (per company)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--company-id",
            type=int,
            default=None,
            help="Limit to one company; default = all companies",
        )

    def handle(self, *args, **options):
        company_id = options["company_id"]
        if company_id is not None:
            companies = Company.objects.filter(id=company_id)
            if not companies.exists():
                self.stderr.write(self.style.ERROR(f"No company id={company_id}"))
                return
        else:
            companies = Company.objects.all().order_by("id")

        total_posted = 0
        total_skipped = 0
        for c in companies:
            r = bulk_sync_tank_dip_variance_journals(c.id)
            total_posted += r["posted"]
            total_skipped += r["skipped"]
            self.stdout.write(
                f"Company {c.id} ({getattr(c, 'name', '')!r}): "
                f"processed={r['dips_processed']} posted={r['posted']} skipped={r['skipped']}"
            )
            if r["skipped_by_reason"]:
                for reason, n in sorted(r["skipped_by_reason"].items(), key=lambda x: -x[1]):
                    self.stdout.write(f"    {reason}: {n}")

        self.stdout.write("")
        self.stdout.write(
            self.style.SUCCESS(f"Done. Total posted={total_posted} skipped={total_skipped}")
        )
