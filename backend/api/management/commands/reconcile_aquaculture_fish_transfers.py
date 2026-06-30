"""
Resync transfer line costs (fry + feed + medicine) then post/refresh GL 1581 journals.

Use after fixing fry bills, backfilling vendor bills, or deploying transfer-cost fixes.

Usage (from backend/, venv active):
  python manage.py reconcile_aquaculture_fish_transfers --company-id 1 --dry-run
  python manage.py reconcile_aquaculture_fish_transfers --company-id 1
  python manage.py reconcile_aquaculture_fish_transfers --company-id 1 --transfer-id 42
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import AquacultureFishPondTransfer, Company
from api.services.aquaculture_fish_transfer_gl_service import sync_aquaculture_fish_pond_transfer_gl
from api.services.aquaculture_transfer_cost import sync_transfer_line_production_costs


class Command(BaseCommand):
    help = (
        "Resync fish transfer line cost_amount from pond P&L, then post AUTO-AQ-FISH-XFER GL journals."
    )

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True, help="Company scope")
        parser.add_argument(
            "--transfer-id",
            type=int,
            action="append",
            dest="transfer_ids",
            default=None,
            help="Restrict to transfer id (repeatable)",
        )
        parser.add_argument("--dry-run", action="store_true", help="Report only; no saves")

    def handle(self, *args, **options):
        company_id = options["company_id"]
        transfer_ids = options["transfer_ids"]
        dry = options["dry_run"]

        if not Company.objects.filter(pk=company_id).exists():
            self.stderr.write(self.style.ERROR(f"Company {company_id} not found"))
            return

        qs = (
            AquacultureFishPondTransfer.objects.filter(company_id=company_id)
            .prefetch_related("lines")
            .order_by("transfer_date", "id")
        )
        if transfer_ids:
            qs = qs.filter(pk__in=transfer_ids)

        scanned = 0
        lines_updated = 0
        gl_posted = 0
        gl_skipped = 0
        gl_capped = 0

        if dry:
            self.stdout.write(self.style.WARNING("DRY RUN — no database changes"))

        with transaction.atomic():
            for tr in qs:
                scanned += 1
                if dry:
                    self.stdout.write(
                        f"Would reconcile transfer #{tr.id} ({tr.transfer_date})"
                    )
                    continue

                n = sync_transfer_line_production_costs(tr)
                if n:
                    lines_updated += n
                    tr.refresh_from_db()
                    total_cost = sum((ln.cost_amount or 0) for ln in tr.lines.all())
                    self.stdout.write(
                        f"Transfer #{tr.id}: resynced {n} line(s), total cost {total_cost}"
                    )

                result = sync_aquaculture_fish_pond_transfer_gl(company_id, tr)
                if result.get("posted"):
                    gl_posted += 1
                    if result.get("gl_capped"):
                        gl_capped += 1
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"Transfer #{tr.id}: GL posted {result.get('total_gl_amount')} "
                            f"({result.get('journal_entry_number')})"
                            + (" [capped at source 1581]" if result.get("gl_capped") else "")
                        )
                    )
                else:
                    gl_skipped += 1
                    reason = result.get("reason") or "unknown"
                    self.stdout.write(
                        self.style.WARNING(
                            f"Transfer #{tr.id}: GL skipped ({reason}) "
                            f"requested={result.get('total_requested', '0')}"
                        )
                    )

            if dry:
                transaction.set_rollback(True)

        self.stdout.write(
            f"Transfers: {scanned}; lines resynced: {lines_updated}; "
            f"GL posted: {gl_posted}; GL skipped: {gl_skipped}; GL capped: {gl_capped}"
        )
