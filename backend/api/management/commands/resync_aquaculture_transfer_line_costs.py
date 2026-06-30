"""
Recompute inter-pond fish transfer line cost_amount from source pond P&L (includes fry Dr 1581).

Nursing ponds use batch allocation: total fry + feed + medicine ÷ total fish moved × each line's fish_count.

Usage (from backend/, venv active):
  python manage.py resync_aquaculture_transfer_line_costs --company-id 1 --dry-run
  python manage.py resync_aquaculture_transfer_line_costs --company-id 1 --from-pond-id 42
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import AquacultureFishPondTransfer, AquaculturePond, Company
from api.services.aquaculture_transfer_cost import (
    pond_uses_nursing_batch_costing,
    resync_nursing_pond_transfer_costs,
    sync_transfer_line_production_costs,
)


class Command(BaseCommand):
    help = "Recompute transfer line cost_amount (fry + feed + medicine) for existing fish pond transfers."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True, help="Company scope")
        parser.add_argument(
            "--from-pond-id",
            type=int,
            default=None,
            help="Restrict to transfers from this nursing/source pond",
        )
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
        from_pond_id = options["from_pond_id"]
        transfer_ids = options["transfer_ids"]
        dry = options["dry_run"]

        if not Company.objects.filter(pk=company_id).exists():
            self.stderr.write(self.style.ERROR(f"Company {company_id} not found"))
            return

        if transfer_ids:
            qs = AquacultureFishPondTransfer.objects.filter(
                company_id=company_id, pk__in=transfer_ids
            ).select_related("from_pond")
        else:
            qs = AquacultureFishPondTransfer.objects.filter(company_id=company_id).select_related(
                "from_pond"
            )
        if from_pond_id is not None:
            qs = qs.filter(from_pond_id=from_pond_id)

        nursing_keys: set[tuple[int, int | None]] = set()
        grow_out_ids: list[int] = []
        for tr in qs.order_by("transfer_date", "id"):
            if pond_uses_nursing_batch_costing(
                company_id=company_id,
                from_pond_id=tr.from_pond_id,
                from_production_cycle_id=tr.from_production_cycle_id,
            ):
                nursing_keys.add((tr.from_pond_id, tr.from_production_cycle_id))
            else:
                grow_out_ids.append(tr.id)

        scanned = len(nursing_keys) + len(grow_out_ids)
        lines_updated = 0

        if dry:
            self.stdout.write(self.style.WARNING("DRY RUN — no database changes"))
            for pond_id, cycle_id in sorted(nursing_keys):
                self.stdout.write(
                    f"Would batch-resync nursing pond {pond_id} cycle={cycle_id!r}"
                )
            for tid in grow_out_ids:
                self.stdout.write(f"Would resync grow-out transfer #{tid}")
            self.stdout.write(f"Transfers scanned: {scanned}")
            return

        with transaction.atomic():
            for pond_id, cycle_id in sorted(nursing_keys):
                n = resync_nursing_pond_transfer_costs(
                    company_id=company_id,
                    from_pond_id=pond_id,
                    from_production_cycle_id=cycle_id,
                    sync_gl=True,
                )
                if n:
                    lines_updated += n
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"Nursing pond {pond_id} cycle={cycle_id!r}: updated {n} line(s)"
                        )
                    )
            for tr in AquacultureFishPondTransfer.objects.filter(pk__in=grow_out_ids).prefetch_related(
                "lines"
            ):
                n = sync_transfer_line_production_costs(tr)
                if n:
                    lines_updated += n
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"Transfer #{tr.id} ({tr.transfer_date}): updated {n} line(s)"
                        )
                    )

        self.stdout.write(f"Batch/transfer groups scanned: {scanned}; lines updated: {lines_updated}")
