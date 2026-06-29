"""
Recompute inter-pond fish transfer line cost_amount from source pond P&L (includes fry Dr 1581).

Usage (from backend/, venv active):
  python manage.py resync_aquaculture_transfer_line_costs --company-id 1 --dry-run
  python manage.py resync_aquaculture_transfer_line_costs --company-id 1
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import AquacultureFishPondTransfer, Company
from api.services.aquaculture_transfer_cost import sync_transfer_line_production_costs


class Command(BaseCommand):
    help = "Recompute transfer line cost_amount (fry + feed + medicine) for existing fish pond transfers."

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

        qs = AquacultureFishPondTransfer.objects.filter(company_id=company_id).prefetch_related(
            "lines"
        ).order_by("transfer_date", "id")
        if transfer_ids:
            qs = qs.filter(pk__in=transfer_ids)

        scanned = 0
        lines_updated = 0

        if dry:
            self.stdout.write(self.style.WARNING("DRY RUN — no database changes"))

        with transaction.atomic():
            for tr in qs:
                scanned += 1
                before = [(ln.id, ln.cost_amount) for ln in tr.lines.all()]
                if dry:
                    self.stdout.write(f"Would resync transfer #{tr.id} ({tr.transfer_date})")
                    continue
                n = sync_transfer_line_production_costs(tr)
                if n:
                    lines_updated += n
                    tr.refresh_from_db()
                    after_total = sum((ln.cost_amount or 0) for ln in tr.lines.all())
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"Transfer #{tr.id} ({tr.transfer_date}): updated {n} line(s), "
                            f"total cost now {after_total}"
                        )
                    )
            if dry:
                transaction.set_rollback(True)

        self.stdout.write(f"Transfers scanned: {scanned}; lines updated: {lines_updated}")
