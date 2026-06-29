"""
Post or refresh AUTO-AQ-FISH-XFER-{id} journals for existing inter-pond fish transfers.

Use after enabling Phase 3 transfer GL sync on a company that already has transfer history.

Usage (from backend/, venv active):
  python manage.py backfill_aquaculture_fish_transfer_gl --company-id 1 --dry-run
  python manage.py backfill_aquaculture_fish_transfer_gl --company-id 1
  python manage.py backfill_aquaculture_fish_transfer_gl --company-id 1 --transfer-id 42
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import AquacultureFishPondTransfer, Company
from api.services.aquaculture_fish_transfer_gl_service import sync_aquaculture_fish_pond_transfer_gl


class Command(BaseCommand):
    help = (
        "Backfill Dr/Cr 1581 inter-pond fish transfer journals "
        "(AUTO-AQ-FISH-XFER-{transfer_id}) for existing transfers."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--company-id",
            type=int,
            required=True,
            help="Company scope",
        )
        parser.add_argument(
            "--transfer-id",
            type=int,
            action="append",
            dest="transfer_ids",
            default=None,
            help="Restrict to specific transfer id (repeatable)",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would be posted without saving",
        )

    def handle(self, *args, **options):
        company_id = options["company_id"]
        transfer_ids = options["transfer_ids"]
        dry = options["dry_run"]

        company = Company.objects.filter(pk=company_id).first()
        if not company:
            self.stderr.write(self.style.ERROR(f"Company {company_id} not found"))
            return

        if not company.aquaculture_enabled:
            self.stdout.write(
                self.style.WARNING(
                    f"Company {company_id} does not have aquaculture_enabled — proceeding anyway."
                )
            )

        qs = (
            AquacultureFishPondTransfer.objects.filter(company_id=company_id)
            .prefetch_related("lines")
            .order_by("transfer_date", "id")
        )
        if transfer_ids:
            qs = qs.filter(pk__in=transfer_ids)

        scanned = 0
        posted = 0
        skipped = 0
        capped = 0

        if dry:
            self.stdout.write(self.style.WARNING("DRY RUN — no database changes"))

        with transaction.atomic():
            for tr in qs:
                scanned += 1
                total_cost = sum(
                    (ln.cost_amount or 0) for ln in tr.lines.all()
                )
                if dry:
                    self.stdout.write(
                        f"Would sync transfer #{tr.id} ({tr.transfer_date}) "
                        f"cost={total_cost}"
                    )
                    continue

                result = sync_aquaculture_fish_pond_transfer_gl(company_id, tr)
                if result.get("posted"):
                    posted += 1
                    if result.get("gl_capped"):
                        capped += 1
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"Transfer #{tr.id}: posted {result.get('total_gl_amount')} "
                            f"({result.get('journal_entry_number')})"
                            + (" [capped]" if result.get("gl_capped") else "")
                        )
                    )
                else:
                    skipped += 1
                    reason = result.get("reason") or "unknown"
                    self.stdout.write(
                        f"Transfer #{tr.id}: skipped ({reason}) "
                        f"requested={result.get('total_requested', '0')}"
                    )

            if dry:
                transaction.set_rollback(True)

        self.stdout.write(
            f"Scanned: {scanned}; posted: {posted}; skipped: {skipped}; capped: {capped}"
        )
