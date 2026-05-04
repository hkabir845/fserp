"""
Set invoice.station_id where it is null, using a conservative rule (dry-run by default).

Rule for each row:
  1) Customer.default_station_id if that station is active for the company
  2) Else lowest active station id for the company

Usage:
  python manage.py backfill_invoice_station --company-id 1 --dry-run
  python manage.py backfill_invoice_station --company-id 1 --execute
"""

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Q

from api.models import Customer, Invoice, Station


class Command(BaseCommand):
    help = "Backfill null invoice.station_id from customer default or first active station."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument(
            "--execute",
            action="store_true",
            help="Write changes (default is dry-run listing only).",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=5000,
            help="Max invoices to process (default 5000).",
        )

    def handle(self, *args, **options):
        company_id = int(options["company_id"])
        execute = bool(options["execute"])
        limit = max(1, int(options["limit"]))

        active_ids = set(
            Station.objects.filter(company_id=company_id, is_active=True).values_list("id", flat=True)
        )
        if not active_ids:
            self.stdout.write(self.style.ERROR("No active stations for this company; nothing to assign."))
            return
        default_sid = min(active_ids)

        qs = (
            Invoice.objects.filter(company_id=company_id)
            .filter(Q(station_id__isnull=True) | Q(station_id=0))
            .select_related("customer")
            .order_by("id")[:limit]
        )
        rows = list(qs)
        if not rows:
            self.stdout.write(self.style.SUCCESS("No invoices with null/zero station_id."))
            return

        plan: list[tuple[int, int]] = []
        for inv in rows:
            target = default_sid
            c = inv.customer
            if c and c.default_station_id and int(c.default_station_id) in active_ids:
                target = int(c.default_station_id)
            plan.append((inv.id, target))

        self.stdout.write(f"Would update {len(plan)} invoice(s) (company {company_id}).")
        for iid, sid in plan[:20]:
            self.stdout.write(f"  invoice {iid} -> station_id={sid}")
        if len(plan) > 20:
            self.stdout.write(f"  ... and {len(plan) - 20} more")

        if not execute:
            self.stdout.write(self.style.WARNING("Dry-run only. Pass --execute to apply."))
            return

        with transaction.atomic():
            for inv in rows:
                target = default_sid
                c = inv.customer
                if c and c.default_station_id and int(c.default_station_id) in active_ids:
                    target = int(c.default_station_id)
                Invoice.objects.filter(pk=inv.pk, company_id=company_id).update(station_id=target)
        self.stdout.write(self.style.SUCCESS(f"Updated {len(plan)} invoice(s)."))
