"""
Health-check a tenant's books: unbalanced journals, duplicate numbers, GL gaps,
and AR/AP/inventory vs control accounts.

Usage:
  python manage.py audit_books --company-id 1
  python manage.py audit_books --company-id 1 --json
"""

import json

from django.core.management.base import BaseCommand

from api.models import Company
from api.services.books_audit import audit_company_books


class Command(BaseCommand):
    help = "Audit tenant books for unbalanced, duplicated, orphaned, or drifted financial records."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument("--json", action="store_true", help="Machine-readable JSON.")

    def handle(self, *args, **options):
        company_id = options["company_id"]
        as_json = options["json"]
        company = Company.objects.filter(pk=company_id).first()
        if not company:
            self.stderr.write(self.style.ERROR(f"Company {company_id} not found"))
            return

        report = audit_company_books(company_id)
        if as_json:
            self.stdout.write(json.dumps(report, indent=2, default=str))
            return

        summary = report["summary"]
        self.stdout.write(f"Books audit — company {company_id} ({company.name!r})")
        self.stdout.write("")
        self.stdout.write(f"GL posting gaps:          {summary['gl_posting_gap_count']}")
        self.stdout.write(f"Unbalanced journals:      {summary['unbalanced_journal_count']}")
        self.stdout.write(f"Duplicate entry numbers:  {summary['duplicate_entry_number_count']}")
        self.stdout.write(f"Orphan journal lines:     {summary['orphan_journal_line_count']}")
        self.stdout.write(f"Subledger control fails:  {summary['subledger_control_fail_count']}")
        self.stdout.write("")

        for row in report["unbalanced_journals"][:50]:
            self.stdout.write(
                self.style.WARNING(
                    f"  unbalanced {row['entry_number']}: "
                    f"Dr {row['debit']} Cr {row['credit']} diff={row['difference']}"
                )
            )
        for row in report["duplicate_entry_numbers"][:20]:
            self.stdout.write(
                self.style.WARNING(
                    f"  duplicate entry_number={row['entry_number']!r} count={row['count']}"
                )
            )
        for row in report["subledger_control_checks"]:
            flag = "OK" if row.get("ok") else "DRIFT"
            style = self.style.SUCCESS if row.get("ok") else self.style.ERROR
            self.stdout.write(style(f"  [{flag}] {row.get('check')}: {row}"))

        if summary["healthy"]:
            self.stdout.write(self.style.SUCCESS("Healthy — no issues detected."))
        else:
            self.stdout.write(self.style.ERROR("Issues found — review JSON with --json for detail."))
            self.stdout.write(
                "Also: python manage.py audit_gl_posting_gaps --company-id "
                f"{company_id}"
            )
