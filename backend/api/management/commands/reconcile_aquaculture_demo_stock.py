"""
Tag untagged fish stock ledger rows to production cycles, seed missing demo opening stock,
and recompute biomass sample book-head / extrapolation snapshots.

Example:
  python manage.py reconcile_aquaculture_demo_stock
  python manage.py reconcile_aquaculture_demo_stock --company-id 1
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import Company
from api.services.aquaculture_stock_ledger_reconcile_service import reconcile_aquaculture_demo_stock


class Command(BaseCommand):
    help = (
        "Reconcile demo aquaculture stock ledger entries to production cycles and refresh biomass sample snapshots."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--company-id",
            type=int,
            default=None,
            help="Company PK (default: all aquaculture-enabled companies).",
        )

    def handle(self, *args, **options):
        cid = options.get("company_id")
        qs = Company.objects.filter(is_deleted=False, aquaculture_enabled=True).order_by("id")
        if cid is not None:
            qs = qs.filter(pk=cid)
        companies = list(qs)
        if not companies:
            self.stdout.write(self.style.WARNING("No aquaculture-enabled companies matched."))
            return

        for company in companies:
            with transaction.atomic():
                stats = reconcile_aquaculture_demo_stock(company.id)
            self.stdout.write(
                self.style.SUCCESS(
                    f"Company {company.id} ({company.name!r}): "
                    f"tagged {stats['ledger_tagged']} ledger row(s), "
                    f"added {stats['demo_cycle_openings']} demo-cycle opening(s), "
                    f"added {stats['bulk_cycle_openings']} bulk-cycle opening(s), "
                    f"refreshed {stats['samples_backfilled']} biomass sample(s)."
                )
            )
