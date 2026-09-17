"""
Ensure every historical fish-pond transfer line has a mirrored AquacultureFishSale.

Does not delete or rewrite transfer rows — stock history stays on the transfer.
Commercial view (Sales UI / pond revenue) uses the mirrored sale.

Usage:
  python manage.py materialize_fish_transfer_sales --company-id 2
  python manage.py materialize_fish_transfer_sales --all-companies
"""

from __future__ import annotations

import json

from django.core.management.base import BaseCommand

from api.models import Company
from api.services.aquaculture_fish_transfer_as_sale import materialize_fish_sales_for_company


class Command(BaseCommand):
    help = "Mirror historical fish pond transfers as AquacultureFishSale rows (data kept)."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, help="Single company id")
        parser.add_argument(
            "--all-companies",
            action="store_true",
            help="Run for every company that has aquaculture ponds or transfers",
        )
        parser.add_argument("--json", action="store_true")

    def handle(self, *args, **opts):
        if opts.get("all_companies"):
            ids = list(
                Company.objects.filter(aquaculture_enabled=True).values_list("id", flat=True)
            )
        elif opts.get("company_id"):
            ids = [opts["company_id"]]
        else:
            self.stderr.write(self.style.ERROR("Pass --company-id N or --all-companies"))
            return

        results = []
        for cid in ids:
            results.append(materialize_fish_sales_for_company(cid))

        if opts.get("json"):
            self.stdout.write(json.dumps(results if len(results) > 1 else results[0], indent=2))
            return

        for row in results:
            self.stdout.write(
                "company %s: transfers=%s sales_created=%s sales_updated=%s lines_skipped=%s"
                % (
                    row["company_id"],
                    row["transfers"],
                    row["sales_created"],
                    row["sales_updated"],
                    row["lines_skipped"],
                )
            )
