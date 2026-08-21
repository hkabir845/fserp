"""
Tag historical pond feed & medicine consumption onto stocking batches (VPS data).

Default is safe: retag single-batch ponds only. Multi-batch rows stay untagged for
report-time soft allocation unless --split-multi is passed.

Usage:
  python manage.py reconcile_aquaculture_batch_consumption --company-id 1 --dry-run
  python manage.py reconcile_aquaculture_batch_consumption --company-id 1
  python manage.py reconcile_aquaculture_batch_consumption --company-id 1 --pond-id 12
  python manage.py reconcile_aquaculture_batch_consumption --company-id 1 --split-multi
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from api.models import Company
from api.services.aquaculture_batch_consumption_reconcile_service import (
    reconcile_batch_consumption_for_company,
)


class Command(BaseCommand):
    help = (
        "Tag already-used (untagged) feed/medicine onto stocking batches. "
        "Default: single-batch retag only. Multi-batch uses report soft-allocation "
        "unless --split-multi rewrites expenses/GL."
    )

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument("--pond-id", type=int, default=None)
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Preview counts only; do not write.",
        )
        parser.add_argument(
            "--split-multi",
            action="store_true",
            help=(
                "Also hard-split multi-batch untagged expenses into N tagged rows "
                "(rewrites AUTO-AQ-POND journals). Prefer soft allocation in reports instead."
            ),
        )

    def handle(self, *args, **options):
        company_id = options["company_id"]
        company = Company.objects.filter(pk=company_id).first()
        if not company:
            self.stderr.write(self.style.ERROR(f"Company {company_id} not found"))
            return

        result = reconcile_batch_consumption_for_company(
            company_id,
            pond_id=options.get("pond_id"),
            dry_run=bool(options.get("dry_run")),
            split_multi=bool(options.get("split_multi")),
        )

        self.stdout.write(
            f"Batch consumption reconcile — company {company_id} ({company.name!r})"
            + (" [DRY RUN]" if result.get("dry_run") else "")
            + (" [SPLIT-MULTI]" if result.get("split_multi") else "")
        )
        self.stdout.write(f"  Untagged rows:           {result.get('untagged_total')}")
        self.stdout.write(f"  Would tag (1 batch):     {result.get('would_tag_single_batch')}")
        self.stdout.write(f"  Would split (2+ batches):{result.get('would_split_multi_batch')}")
        self.stdout.write(f"  Skip (no batch demand):   {result.get('skip_no_batch_demand')}")
        if not result.get("dry_run"):
            self.stdout.write(self.style.SUCCESS(f"  Tagged:  {result.get('tagged')}"))
            self.stdout.write(self.style.SUCCESS(f"  Split:   {result.get('split')}"))
            skipped_multi = int(result.get("skipped_multi_batch") or 0)
            if skipped_multi:
                self.stdout.write(
                    self.style.WARNING(
                        f"  Left for soft report alloc (multi-batch): {skipped_multi}"
                    )
                )
            created = result.get("created_expense_ids") or []
            if created:
                self.stdout.write(f"  New expense ids: {len(created)}")
            for err in result.get("errors") or []:
                self.stderr.write(
                    self.style.ERROR(f"  Error expense #{err.get('expense_id')}: {err.get('detail')}")
                )
        else:
            for row in result.get("sample_rows") or []:
                self.stdout.write(
                    f"  #{row['expense_id']} {row['pond_name']} {row['expense_date']} "
                    f"{row['category']} {row['action']} batches={row['batch_count']} "
                    f"kg={row.get('feed_weight_kg')} amt={row['amount']}"
                )
