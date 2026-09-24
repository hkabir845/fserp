"""
Retag null-cycle biological aquaculture sales (safe heuristics).

  python manage.py repair_aquaculture_null_cycle_sales --company-id 2 --dry-run
  python manage.py repair_aquaculture_null_cycle_sales --company-id 2
  python manage.py repair_aquaculture_null_cycle_sales --company-id 2 --pond-id 2
"""
from __future__ import annotations

import json

from django.core.management.base import BaseCommand

from api.models import Company
from api.services.aquaculture_null_cycle_retag_service import (
    apply_null_cycle_sales,
    preview_null_cycle_sales,
)


class Command(BaseCommand):
    help = (
        "Assign production_cycle on biological sales still null. "
        "Sole-cycle ponds and unique date+species matches only; ambiguous rows skipped."
    )

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument("--pond-id", type=int, default=None)
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Preview proposed tags; do not write.",
        )
        parser.add_argument(
            "--json",
            action="store_true",
            help="Emit full JSON report.",
        )
        parser.add_argument(
            "--no-samples",
            action="store_true",
            help="Do not backfill samples from sales / sole-cycle ponds.",
        )

    def handle(self, *args, **options):
        cid = options["company_id"]
        company = Company.objects.filter(pk=cid).first()
        if not company:
            self.stderr.write(self.style.ERROR(f"Company {cid} not found"))
            return
        pond_id = options.get("pond_id")
        dry = bool(options.get("dry_run"))

        if dry:
            result = preview_null_cycle_sales(cid, pond_id=pond_id)
        else:
            result = apply_null_cycle_sales(
                cid,
                pond_id=pond_id,
                also_samples=not bool(options.get("no_samples")),
            )

        if options.get("json"):
            self.stdout.write(json.dumps(result, indent=2, default=str))
            return

        label = f"{company.name!r} (id={cid})"
        if dry:
            self.stdout.write(
                f"Null-cycle retag DRY RUN — {label}"
                + (f" pond={pond_id}" if pond_id else "")
            )
            self.stdout.write(
                f"  Would tag: {result['would_tag_count']} sales "
                f"({result['would_tag_heads']} heads)"
            )
            self.stdout.write(
                f"  Skip (ambiguous/no match): {result['skip_count']} "
                f"({result['skip_heads']} heads)"
            )
            for row in (result.get("would_tag") or [])[:25]:
                self.stdout.write(
                    f"    sale#{row['sale_id']} pond={row['pond_id']} "
                    f"{row['sale_date']} {row['fish_species']} "
                    f"n={row['fish_count']} → cy={row['proposed_cycle_id']} "
                    f"({row['reason']})"
                )
            if result["would_tag_count"] > 25:
                self.stdout.write(f"    … +{result['would_tag_count'] - 25} more")
            for row in (result.get("skip") or [])[:15]:
                self.stdout.write(
                    f"    SKIP sale#{row['sale_id']} pond={row['pond_id']} "
                    f"{row['reason']} n={row['fish_count']}"
                )
        else:
            self.stdout.write(self.style.SUCCESS(f"Null-cycle retag applied — {label}"))
            self.stdout.write(f"  Sales tagged:   {result.get('sales_tagged')}")
            self.stdout.write(f"  Samples tagged: {result.get('samples_tagged')}")
            self.stdout.write(f"  Skipped:        {result.get('skip_count')}")
            self.stdout.write(
                f"  Remaining null biological sales: "
                f"{result.get('remaining_null_biological_sales')}"
            )
