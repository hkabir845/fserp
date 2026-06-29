"""
Report operational records missing expected auto-posted journal entries.

Usage:
  python manage.py audit_gl_posting_gaps --company-id 1
  python manage.py audit_gl_posting_gaps --company-id 1 --type vendor_payment_made
  python manage.py audit_gl_posting_gaps --company-id 1 --json
"""

import json

from django.core.management.base import BaseCommand

from api.models import Company
from api.services.gl_posting_audit import GAP_FINDERS, audit_company_gl_gaps


class Command(BaseCommand):
    help = "Audit missing GL journal entries for bills, payments, invoices, and other auto-posted flows."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument(
            "--type",
            action="append",
            dest="gap_types",
            choices=list(GAP_FINDERS.keys()),
            help="Limit to one gap type (repeatable). Default: all types.",
        )
        parser.add_argument("--json", action="store_true", help="Output machine-readable JSON.")

    def handle(self, *args, **options):
        company_id = options["company_id"]
        gap_types = options.get("gap_types")
        as_json = options["json"]

        company = Company.objects.filter(pk=company_id).first()
        if not company:
            self.stderr.write(self.style.ERROR(f"Company {company_id} not found"))
            return

        report = audit_company_gl_gaps(company_id, gap_types=gap_types)

        if as_json:
            self.stdout.write(json.dumps(report, indent=2))
            return

        self.stdout.write(f"GL posting audit — company {company_id} ({company.name!r})")
        self.stdout.write("")

        if report["total_gaps"] == 0:
            self.stdout.write(self.style.SUCCESS("No missing journal entries found."))
            return

        for gt, rows in report["gaps_by_type"].items():
            self.stdout.write(self.style.WARNING(f"=== {gt} ({len(rows)} missing) ==="))
            for row in rows:
                amt = row.get("amount", "")
                dt = row.get("record_date", "")
                self.stdout.write(
                    f"  #{row['record_id']}  {row['label']}  "
                    f"amount={amt}  date={dt}  expected={row['expected_entry_number']}"
                )
                extra = row.get("vendor_ap_decremented")
                if extra is not None:
                    self.stdout.write(
                        f"    vendor_ap_decremented={extra} (subledger flag without JE)"
                    )
                extra = row.get("vendor_ap_incremented")
                if extra is not None:
                    self.stdout.write(
                        f"    vendor_ap_incremented={extra} (subledger flag without JE)"
                    )
            self.stdout.write("")

        self.stdout.write(
            self.style.ERROR(f"Total gaps: {report['total_gaps']}")
        )
        self.stdout.write(
            "Fix: python manage.py backfill_gl_posting_gaps --company-id "
            f"{company_id} --dry-run"
        )
