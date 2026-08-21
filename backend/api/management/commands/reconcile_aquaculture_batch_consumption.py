"""
Tag / split historical pond feed & medicine consumption onto stocking batches (VPS data).

Usage:
  python manage.py reconcile_aquaculture_batch_consumption --company-id 1 --dry-run
  python manage.py reconcile_aquaculture_batch_consumption --company-id 1
  python manage.py reconcile_aquaculture_batch_consumption --company-id 1 --pond-id 12
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from api.models import Company
from api.services.aquaculture_batch_consumption_reconcile_service import (
    reconcile_batch_consumption_for_company,
)


class Command(BaseCommand):
    help = (
        "Distribute already-used (untagged) feed/medicine expenses across stocking batches "
        "using sampling biomass × WorldFish %%BW — for VPS historical data."
    )

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument("--pond-id", type=int, default=None)
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Preview counts only; do not write.",
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
        )

        self.stdout.write(
            f"Batch consumption reconcile — company {company_id} ({company.name!r})"
            + (" [DRY RUN]" if result.get("dry_run") else "")
        )
        self.stdout.write(f"  Untagged rows:           {result.get('untagged_total')}")
        self.stdout.write(f"  Would tag (1 batch):     {result.get('would_tag_single_batch')}")
        self.stdout.write(f"  Would split (2+ batches):{result.get('would_split_multi_batch')}")
        self.stdout.write(f"  Skip (no batch demand):   {result.get('skip_no_batch_demand')}")
        if not result.get("dry_run"):
            self.stdout.write(self.style.SUCCESS(f"  Tagged:  {result.get('tagged')}"))
            self.stdout.write(self.style.SUCCESS(f"  Split:   {result.get('split')}"))
            created = result.get("created_expense_ids") or []
            if created:
                self.stdout.write(f"  New expense ids: {len(created)}")
            for err in result.get("errors") or []:
                self.stderr.write(self.style.ERROR(f"  Error expense #{err.get('expense_id')}: {err.get('detail')}"))
        else:
            for row in result.get("sample_rows") or []:
                self.stdout.write(
                    f"  #{row['expense_id']} {row['pond_name']} {row['expense_date']} "
                    f"{row['category']} {row['action']} batches={row['batch_count']} "
                    f"kg={row.get('feed_weight_kg')} amt={row['amount']}"
                )
