"""
Preview / auto-fix aquaculture sale species mistags (e.g. Silver Carp billed as tilapia).

  python manage.py repair_aquaculture_species_mistags --company-id 2 --dry-run
  python manage.py repair_aquaculture_species_mistags --company-id 2
"""
from __future__ import annotations

import json

from django.core.management.base import BaseCommand

from api.models import Company
from api.services.aquaculture_null_cycle_retag_service import (
    apply_species_mistags,
    preview_species_mistags,
)


class Command(BaseCommand):
    help = (
        "List sales whose species disagrees with the cycle primary species "
        "(BD polyculture companions are excluded). "
        "Apply only auto-fixable rows (memo/buyer names a correcting species)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument("--pond-id", type=int, default=None)
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--json", action="store_true")

    def handle(self, *args, **options):
        cid = options["company_id"]
        company = Company.objects.filter(pk=cid).first()
        if not company:
            self.stderr.write(self.style.ERROR(f"Company {cid} not found"))
            return
        pond_id = options.get("pond_id")
        dry = bool(options.get("dry_run"))
        if dry:
            result = preview_species_mistags(cid, pond_id=pond_id)
        else:
            result = apply_species_mistags(cid, pond_id=pond_id, only_auto=True)

        if options.get("json"):
            self.stdout.write(json.dumps(result, indent=2, default=str))
            return

        if dry:
            self.stdout.write(
                f"Species mistag DRY RUN — {company.name!r} "
                f"mistags={result['mistag_count']} "
                f"auto_fixable={result['auto_fixable_count']} "
                f"expected_polyculture={result.get('expected_polyculture_count', 0)}"
            )
            for row in (result.get("mistags") or [])[:40]:
                flag = "AUTO" if row["auto_fixable"] else "REVIEW"
                self.stdout.write(
                    f"  [{flag}] sale#{row['sale_id']} pond={row['pond_id']} "
                    f"{row['sale_date']} {row['current_species']} vs cycle "
                    f"{row['cycle_species']} (cy={row['cycle_id']}) "
                    f"memo→{row['inferred_from_memo']} n={row['fish_count']}"
                )
            ep = int(result.get("expected_polyculture_count") or 0)
            if ep:
                self.stdout.write(
                    f"  (omitted {ep} BD polyculture companion harvests — not mistags)"
                )
        else:
            self.stdout.write(
                self.style.SUCCESS(
                    f"Species mistags fixed={result['fixed']} "
                    f"left_for_manual={result['left_for_manual']} "
                    f"expected_polyculture={result.get('expected_polyculture_count', 0)}"
                )
            )
