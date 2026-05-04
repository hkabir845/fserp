"""
Fill chart account descriptions from the built-in fuel-station template (by account code).

Usage:
  python manage.py backfill_coa_descriptions
  python manage.py backfill_coa_descriptions --company-id 3
  python manage.py backfill_coa_descriptions --force-template
"""

from django.core.management.base import BaseCommand

from api.models import Company
from api.chart_templates.fuel_station import backfill_company_coa_descriptions


class Command(BaseCommand):
    help = "Copy template descriptions onto chart rows (empty descriptions only, unless --force-template)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--company-id",
            type=int,
            default=None,
            help="Limit to one company ID; default: all active companies.",
        )
        parser.add_argument(
            "--force-template",
            action="store_true",
            help="Overwrite existing descriptions with template text (destructive).",
        )

    def handle(self, *args, **options):
        cid = options.get("company_id")
        force = bool(options.get("force_template"))
        qs = Company.objects.filter(is_deleted=False).order_by("id")
        if cid is not None:
            qs = qs.filter(id=cid)
        companies = list(qs)
        if not companies:
            self.stdout.write(self.style.WARNING("No companies matched."))
            return

        total_updated = 0
        for c in companies:
            r = backfill_company_coa_descriptions(
                c.id,
                only_blank=not force,
                force_template=force,
            )
            total_updated += r["updated"]
            self.stdout.write(
                "Company {} ({}): updated={}, skipped_no_template={}, skipped_has_text={}, skipped_unchanged={}".format(
                    c.id,
                    c.name,
                    r["updated"],
                    r["skipped_no_template"],
                    r["skipped_has_text"],
                    r["skipped_unchanged"],
                )
            )

        self.stdout.write(self.style.SUCCESS("Done. Total rows updated: {}.".format(total_updated)))
