"""
Link existing stocking batches (production cycles) to the vendor bill lines they belong to.

Use when cycles were auto-created from posted bills but bill lines were never tagged
(e.g. legacy VPS data before line-level cycle persistence).

Usage (from backend/, venv active):
  python manage.py backfill_bill_production_cycles --company-id 1 --dry-run
  python manage.py backfill_bill_production_cycles --company-id 1
  python manage.py backfill_bill_production_cycles --company-id 1 --bill-id 42
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from api.services.aquaculture_production_cycle_service import link_production_cycles_to_vendor_bills


class Command(BaseCommand):
    help = (
        "Link auto-created aquaculture production cycles to bill lines using "
        "bill number in cycle notes/name (does not create or delete cycles)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--company-id",
            type=int,
            required=True,
            help="Company scope",
        )
        parser.add_argument(
            "--bill-id",
            type=int,
            action="append",
            dest="bill_ids",
            default=None,
            help="Restrict to specific bill id (repeatable)",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would be linked without saving",
        )

    def handle(self, *args, **options):
        company_id = options["company_id"]
        bill_ids = options["bill_ids"]
        dry = options["dry_run"]

        if dry:
            self.stdout.write(self.style.WARNING("DRY RUN — no database changes"))

        with transaction.atomic():
            stats = link_production_cycles_to_vendor_bills(
                company_id,
                bill_ids=bill_ids,
                dry_run=dry,
            )
            if dry:
                transaction.set_rollback(True)

        self.stdout.write(
            f"Cycles scanned: {stats['cycles_scanned']}; "
            f"matched to bills: {stats['cycles_matched']}; "
            f"unmatched: {stats['cycles_unmatched']}"
        )
        self.stdout.write(
            f"Bills touched: {stats['bills_touched']}; "
            f"lines linked: {stats['lines_linked']}; "
            f"already linked: {stats['lines_already_linked']}; "
            f"conflicts skipped: {stats['conflicts_skipped']}"
        )
