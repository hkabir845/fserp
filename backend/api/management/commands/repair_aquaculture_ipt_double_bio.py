"""
Delete leftover AUTO-AQ-SALE-*-BIO journals that double-relieved IPT mirror sales.

  python manage.py repair_aquaculture_ipt_double_bio --company-id 2 --dry-run
  python manage.py repair_aquaculture_ipt_double_bio --company-id 2
"""
from __future__ import annotations

import json

from django.core.management.base import BaseCommand

from api.models import Company
from api.services.aquaculture_ipt_bio_relief_cleanup_service import (
    delete_ipt_double_bio_relief_journals,
    find_ipt_double_bio_relief_journals,
)


class Command(BaseCommand):
    help = (
        "Find/delete AUTO-AQ-SALE-*-BIO journals for IPT-mirrored sales "
        "(already relieved via AUTO-IPT-INV-*)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--json", action="store_true")

    def handle(self, *args, **options):
        cid = options["company_id"]
        company = Company.objects.filter(pk=cid).first()
        if not company:
            self.stderr.write(self.style.ERROR(f"Company {cid} not found"))
            return
        dry = bool(options.get("dry_run"))
        if dry:
            result = find_ipt_double_bio_relief_journals(cid)
        else:
            result = delete_ipt_double_bio_relief_journals(cid)

        if options.get("json"):
            self.stdout.write(json.dumps(result, indent=2, default=str))
            return

        n = result.get("count", result.get("found", 0))
        self.stdout.write(
            f"IPT double BIO — {company.name!r}: {n} leftover journal(s)"
            + (" [DRY RUN]" if dry else "")
        )
        for row in (result.get("journals") or [])[:50]:
            self.stdout.write(
                f"  {row['entry_number']} sale#{row['sale_id']} "
                f"{row['reason']} date={row.get('entry_date')}"
            )
        if not dry:
            self.stdout.write(self.style.SUCCESS(f"Deleted: {result.get('deleted')}"))
