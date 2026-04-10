"""
Normalize chart line account_type strings to FSERP canonical values.

Maps legacy labels (e.g. revenue -> income) so balance sheet / P&L reports classify
accounts correctly. Safe to run multiple times.

  python manage.py normalize_chart_account_types
  python manage.py normalize_chart_account_types --company-id 3
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import ChartOfAccount
from api.services.coa_constants import CHART_ACCOUNT_TYPES, normalize_chart_account_type


class Command(BaseCommand):
    help = "Normalize ChartOfAccount.account_type (e.g. revenue -> income)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--company-id",
            type=int,
            default=None,
            help="Limit to one company",
        )

    def handle(self, *args, **options):
        cid = options.get("company_id")
        qs = ChartOfAccount.objects.all().order_by("company_id", "account_code")
        if cid is not None:
            qs = qs.filter(company_id=cid)

        changed = 0
        unknown: list[str] = []

        with transaction.atomic():
            for a in qs:
                cur = (a.account_type or "").strip()
                nt = normalize_chart_account_type(cur, default=cur or "asset")
                if nt != cur:
                    self.stdout.write(
                        f"  company={a.company_id} id={a.id} {a.account_code}: {cur!r} -> {nt!r}"
                    )
                    a.account_type = nt
                    a.save(update_fields=["account_type", "updated_at"])
                    changed += 1
                elif nt not in CHART_ACCOUNT_TYPES:
                    unknown.append(
                        f"company={a.company_id} id={a.id} code={a.account_code} type={cur!r}"
                    )

        for line in unknown:
            self.stdout.write(self.style.WARNING(f"Unknown account_type (manual fix): {line}"))
        self.stdout.write(self.style.SUCCESS(f"Updated {changed} row(s)."))
