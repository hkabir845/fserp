"""
Apply journal header station_id to posted manual P&L lines that lack station/pond tags.

Usage:
  python manage.py backfill_je_entity_tags
  python manage.py backfill_je_entity_tags --company-id 42 --dry-run
"""

from django.core.management.base import BaseCommand

from api.models import Company, JournalEntry
from api.services.entity_gl_scoping import (
    apply_entry_station_to_unscoped_pl_lines,
    audit_entity_gl_scoping,
)


class Command(BaseCommand):
    help = "Backfill station_id on untagged P&L lines from journal entry header (manual JEs only)."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, default=None)
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        cid = options.get("company_id")
        dry = options["dry_run"]
        qs = Company.objects.filter(is_deleted=False).order_by("id")
        if cid is not None:
            qs = qs.filter(pk=cid)

        total_updated = 0
        for company in qs:
            before = audit_entity_gl_scoping(company.id)["unscoped_pl_line_count"]
            if dry:
                self.stdout.write(
                    f"Company {company.id} ({company.name!r}): would fix up to {before} unscoped P&L line(s) "
                    "(dry-run — no writes)"
                )
                continue

            updated_lines = 0
            for je in JournalEntry.objects.filter(
                company_id=company.id, is_posted=True
            ).exclude(entry_number__startswith="AUTO-"):
                updated_lines += apply_entry_station_to_unscoped_pl_lines(je)

            after = audit_entity_gl_scoping(company.id)["unscoped_pl_line_count"]
            total_updated += updated_lines
            self.stdout.write(
                self.style.SUCCESS(
                    f"Company {company.id} ({company.name!r}): updated {updated_lines} line(s); "
                    f"unscoped P&L lines now {after} (was {before})"
                )
            )

        if not dry:
            self.stdout.write(self.style.SUCCESS(f"Done. Total lines updated: {total_updated}"))
