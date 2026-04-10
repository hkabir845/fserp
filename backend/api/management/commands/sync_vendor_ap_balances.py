"""
Recalculate Vendor.current_balance from open bills and payment allocations, then
set vendor_ap_incremented / vendor_ap_decremented so future incremental updates do not double-count.

Stores: current_balance = opening_balance + sum(unpaid bill amounts). Use opening_balance only for
A/P that is not represented as bills in the system (otherwise you double-count).

Usage:
  python manage.py sync_vendor_ap_balances --company-id 1
  python manage.py sync_vendor_ap_balances --company-id 1 --vendor-id 5
  python manage.py sync_vendor_ap_balances --company-id 1 --vendor-name Sumon
  python manage.py sync_vendor_ap_balances --company-id 1 --dry-run
"""

from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Q

from api.models import Bill, Payment, Vendor
from api.services.payment_allocation import compute_vendor_balance_due


class Command(BaseCommand):
    help = "Set each vendor's current_balance to unpaid bill totals; sync AP subledger flags."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument("--vendor-id", type=int, default=None)
        parser.add_argument(
            "--vendor-name",
            type=str,
            default=None,
            help="Match vendors whose company_name or display_name contains this (case-insensitive).",
        )
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        company_id = options["company_id"]
        vendor_id = options["vendor_id"]
        vendor_name = (options["vendor_name"] or "").strip()
        dry = options["dry_run"]

        vqs = Vendor.objects.filter(company_id=company_id, is_active=True)
        if vendor_id is not None:
            vqs = vqs.filter(id=vendor_id)
        if vendor_name:
            needle = vendor_name
            vqs = vqs.filter(
                Q(company_name__icontains=needle) | Q(display_name__icontains=needle)
            )

        rows = list(vqs.order_by("id"))
        if not rows:
            self.stdout.write("No vendors matched.")
            return

        for v in rows:
            owed = compute_vendor_balance_due(company_id, v.id)
            opening = v.opening_balance or Decimal("0")
            new_balance = opening + owed
            self.stdout.write(
                f"Vendor {v.id} {v.company_name!r}: opening={opening} bills_owed={owed} -> current_balance {new_balance}"
            )
            if dry:
                continue
            with transaction.atomic():
                Vendor.objects.filter(pk=v.pk, company_id=company_id).update(
                    current_balance=new_balance
                )
                Bill.objects.filter(company_id=company_id, vendor_id=v.id).exclude(
                    status="draft"
                ).update(vendor_ap_incremented=True)
                Payment.objects.filter(
                    company_id=company_id, vendor_id=v.id, payment_type="made"
                ).update(vendor_ap_decremented=True)

        if dry:
            self.stdout.write(self.style.WARNING("Dry run: no database changes."))
        else:
            self.stdout.write(self.style.SUCCESS("Vendor A/P balances synced."))
