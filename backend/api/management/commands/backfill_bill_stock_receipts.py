"""
Apply inventory receipt for posted vendor bills that have AUTO-BILL-{id} journals
but stock_receipt_applied is still false (e.g. posted before receipt logic existed).

Usage:
  python manage.py backfill_bill_stock_receipts --company-id 1
  python manage.py backfill_bill_stock_receipts --company-id 1 --bill-id 42
  python manage.py backfill_bill_stock_receipts --company-id 1 --dry-run
  python manage.py backfill_bill_stock_receipts --company-id 1 --reapply --bill-id 42
"""

from django.core.management.base import BaseCommand

from django.db import transaction

from api.models import Bill, JournalEntry
from api.services.gl_posting import (
    bill_eligible_for_posting,
    post_bill_journal,
    receipt_inventory_from_posted_bill,
    undo_bill_stock_receipt,
)


class Command(BaseCommand):
    help = (
        "Apply tank + QOH receipt for open/posted bills whose GL journal exists "
        "but stock_receipt_applied is false."
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
            help="List matching bills only; do not change stock",
        )
        parser.add_argument(
            "--reapply",
            action="store_true",
            help=(
                "Reverse any prior receipt for the bill, then apply receipt again "
                "(use when stock_receipt_applied was set incorrectly or rules changed)."
            ),
        )

    def handle(self, *args, **options):
        company_id = options["company_id"]
        bill_ids = options["bill_ids"]
        dry = options["dry_run"]
        reapply = options["reapply"]

        qs = Bill.objects.filter(company_id=company_id).exclude(status="draft").exclude(
            total__lte=0
        )
        if bill_ids:
            qs = qs.filter(id__in=bill_ids)

        count = 0
        for bill in qs.order_by("id"):
            if not bill_eligible_for_posting(bill):
                continue
            en = f"AUTO-BILL-{bill.id}"
            if not JournalEntry.objects.filter(
                company_id=company_id, entry_number=en
            ).exists():
                continue
            if not reapply and bill.stock_receipt_applied:
                continue
            count += 1
            if dry:
                self.stdout.write(
                    f"[dry-run] would {'reapply' if reapply else 'receipt'} bill id={bill.id} {en}"
                )
                continue
            if reapply:
                with transaction.atomic():
                    undo_bill_stock_receipt(bill)
                    n = receipt_inventory_from_posted_bill(bill)
                    Bill.objects.filter(pk=bill.pk).update(stock_receipt_applied=(n > 0))
                self.stdout.write(
                    self.style.SUCCESS(
                        f"Reapplied stock for bill id={bill.id} (lines={n})"
                    )
                )
            else:
                post_bill_journal(company_id, bill)
                self.stdout.write(self.style.SUCCESS(f"Receipt applied for bill id={bill.id}"))

        if dry and count == 0:
            self.stdout.write("No bills matched.")
        elif not dry and count == 0:
            self.stdout.write("Nothing to do.")
