"""
Refresh AUTO-BILL journal debit accounts for pond-tagged vendor bills.

Use after fry posting rules change (expense-mode fry → 1581) so legacy bills like
BILL-213 pick up the correct biological inventory account without re-entering lines.

Usage (from backend/, venv active):
  python manage.py resync_aquaculture_pond_bill_gl --company-id 2 --dry-run
  python manage.py resync_aquaculture_pond_bill_gl --company-id 2
  python manage.py resync_aquaculture_pond_bill_gl --company-id 2 --bill-id 238
"""

from django.core.management.base import BaseCommand

from api.models import Bill
from api.services.gl_posting import bill_eligible_for_posting, resync_posted_bill_journal_from_lines


class Command(BaseCommand):
    help = "Resync posted vendor bill journals for pond-tagged lines (fry → 1581 routing)."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument(
            "--bill-id",
            type=int,
            action="append",
            dest="bill_ids",
            default=None,
            help="Restrict to bill id(s) (repeatable)",
        )
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        company_id = options["company_id"]
        bill_ids = options["bill_ids"]
        dry = options["dry_run"]

        qs = Bill.objects.filter(company_id=company_id).filter(
            lines__aquaculture_pond_id__isnull=False
        ).distinct()
        if bill_ids:
            qs = qs.filter(pk__in=bill_ids)

        updated = 0
        skipped = 0
        for bill in qs.order_by("id"):
            if not bill_eligible_for_posting(bill):
                skipped += 1
                continue
            if dry:
                self.stdout.write(f"Would resync bill {bill.id} ({bill.bill_number})")
                updated += 1
                continue
            if resync_posted_bill_journal_from_lines(company_id, bill.id):
                self.stdout.write(f"Resynced bill {bill.id} ({bill.bill_number})")
                updated += 1
            else:
                skipped += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Done: {updated} resynced, {skipped} skipped (dry_run={dry})"
            )
        )
