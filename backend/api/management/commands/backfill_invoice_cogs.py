"""
Post missing AUTO-INV-{id}-COGS journals for inventory sales in a date range.

Use after fixing item unit costs or COGS accounts, or when P&L COGS was zero despite sales.

Usage:
  python manage.py backfill_invoice_cogs --company-id 1 --start 2026-01-01 --end 2026-12-31
  python manage.py backfill_invoice_cogs --company-id 1 --start 2026-01-01 --end 2026-12-31 --force-repost
"""

from datetime import datetime

from django.core.management.base import BaseCommand, CommandError

from api.models import Company
from api.services.gl_posting import backfill_invoice_cogs_journals


class Command(BaseCommand):
    help = "Backfill posted invoice COGS journals (Dr COGS / Cr inventory) for a date range."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument("--start", type=str, required=True, help="YYYY-MM-DD")
        parser.add_argument("--end", type=str, required=True, help="YYYY-MM-DD")
        parser.add_argument(
            "--force-repost",
            action="store_true",
            help="Delete existing AUTO-INV-*-COGS entries in range before posting again.",
        )

    def handle(self, *args, **options):
        company_id = int(options["company_id"])
        if not Company.objects.filter(pk=company_id, is_deleted=False).exists():
            raise CommandError(f"Company {company_id} not found.")

        try:
            start = datetime.strptime(options["start"], "%Y-%m-%d").date()
            end = datetime.strptime(options["end"], "%Y-%m-%d").date()
        except ValueError as e:
            raise CommandError("Use --start and --end as YYYY-MM-DD.") from e
        if end < start:
            raise CommandError("--end must be on or after --start.")

        stats = backfill_invoice_cogs_journals(
            company_id, start, end, force_repost=bool(options["force_repost"])
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"COGS backfill company_id={company_id} {start}..{end}: "
                f"posted={stats['posted']} skipped_existing={stats['skipped_existing']} "
                f"removed_for_repost={stats['removed_for_repost']}"
            )
        )
