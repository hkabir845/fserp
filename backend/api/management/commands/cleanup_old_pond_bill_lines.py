"""
Remove legacy vendor bill lines tagged to ponds without a reporting category.

These rows pre-date tenant reporting categories (no tenant_reporting_category_id) and
cannot be maintained when category definitions change.

Usage:
  python manage.py cleanup_old_pond_bill_lines --company-id 1 --dry-run
  python manage.py cleanup_old_pond_bill_lines --company-id 1 --execute
  python manage.py cleanup_old_pond_bill_lines --company-id 1 --before 2026-01-01 --execute
  python manage.py cleanup_old_pond_bill_lines --company-id 1 --bill-id 42 --execute
"""

from __future__ import annotations

from datetime import date

from django.core.management.base import BaseCommand, CommandError

from api.models import Company
from api.services.aquaculture_pond_bill_line_cleanup import (
    cleanup_old_uncategorized_pond_bill_lines,
    uncategorized_pond_bill_lines_qs,
)


class Command(BaseCommand):
    help = (
        "Delete pond-tagged vendor bill lines with no reporting category link, "
        "then reconcile GL/stock on affected bills (skips bills with vendor payments)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True, help="Company scope")
        parser.add_argument(
            "--before",
            type=str,
            default="",
            help="Optional ISO date — only bill lines on bills dated before this day",
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
            help="List counts only (default when --execute is omitted)",
        )
        parser.add_argument(
            "--execute",
            action="store_true",
            help="Apply deletions and bill reconciliation",
        )

    def handle(self, *args, **options):
        company_id = options["company_id"]
        if not Company.objects.filter(pk=company_id).exists():
            raise CommandError(f"Company {company_id} not found")

        before: date | None = None
        raw_before = (options.get("before") or "").strip()
        if raw_before:
            try:
                before = date.fromisoformat(raw_before)
            except ValueError as exc:
                raise CommandError("--before must be YYYY-MM-DD") from exc

        dry_run = not options["execute"] or options["dry_run"]
        if options["execute"] and options["dry_run"]:
            dry_run = True

        if dry_run:
            qs = uncategorized_pond_bill_lines_qs(
                company_id,
                before_date=before,
                bill_ids=options["bill_ids"],
            )
            bill_ids = sorted({row.bill_id for row in qs.only("bill_id")})
            self.stdout.write(
                self.style.WARNING(
                    f"Dry run — would remove {qs.count()} line(s) on {len(bill_ids)} bill(s)"
                )
            )
            for row in qs.select_related("bill", "aquaculture_pond")[:50]:
                pond = row.aquaculture_pond
                pond_name = (pond.name if pond else f"pond#{row.aquaculture_pond_id}").strip()
                self.stdout.write(
                    f"  bill {row.bill_id} ({row.bill.bill_number}, {row.bill.bill_date}) "
                    f"line {row.id} pond={pond_name} amount={row.amount} "
                    f"bucket={row.aquaculture_cost_bucket or '—'}"
                )
            if qs.count() > 50:
                self.stdout.write(f"  … and {qs.count() - 50} more line(s)")
            self.stdout.write("Re-run with --execute to apply.")
            return

        stats = cleanup_old_uncategorized_pond_bill_lines(
            company_id,
            before_date=before,
            bill_ids=options["bill_ids"],
            dry_run=False,
        )
        self.stdout.write(
            self.style.SUCCESS(
                "Removed {lines_removed} line(s) (matched {lines_matched}); "
                "reconciled {bills_reconciled} bill(s); deleted {bills_deleted} empty bill(s); "
                "skipped {bills_skipped_paid} bill(s) with vendor payments.".format(
                    **{k: stats[k] for k in stats if k != "bill_ids_affected"}
                )
            )
        )
