"""
Remove live-fish SKU quantities from pond warehouse (ItemPondStock).

Fish belong in pond biomass (vendor bills + transfers + fish stock ledger), not warehouse inventory.

Usage:
  python manage.py clear_fish_pond_warehouse_stock --company-id 1
  python manage.py clear_fish_pond_warehouse_stock --company-id 1 --dry-run
"""

from __future__ import annotations

from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import Company, ItemPondStock
from api.services.station_stock import refresh_item_quantity_on_hand


class Command(BaseCommand):
    help = "Zero ItemPondStock rows for fish SKUs (live biomass is not warehouse inventory)."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, default=None, help="Limit to one company")
        parser.add_argument("--dry-run", action="store_true", help="Print rows only; do not update")

    def handle(self, *args, **options):
        cid = options.get("company_id")
        dry = bool(options.get("dry_run"))
        qs = (
            ItemPondStock.objects.filter(item__pos_category__iexact="fish")
            .exclude(quantity__lte=0)
            .select_related("pond", "item", "company")
            .order_by("company_id", "pond__name", "item__name")
        )
        if cid is not None:
            qs = qs.filter(company_id=cid)
        rows = list(qs)
        if not rows:
            self.stdout.write(self.style.SUCCESS("No fish SKU quantities in pond warehouse."))
            return
        self.stdout.write(f"Found {len(rows)} fish pond-warehouse row(s) to clear:")
        touched_items: set[tuple[int, int]] = set()
        with transaction.atomic():
            for row in rows:
                qty = row.quantity if row.quantity is not None else Decimal("0")
                pond_name = (row.pond.name or f"Pond #{row.pond_id}").strip()
                item_name = (row.item.name or f"Item #{row.item_id}").strip()
                self.stdout.write(
                    f"  company={row.company_id} {pond_name} — {item_name}: {qty} {(row.item.unit or '').strip()}"
                )
                if dry:
                    continue
                ItemPondStock.objects.filter(pk=row.pk).update(quantity=Decimal("0"))
                touched_items.add((row.company_id, row.item_id))
            if dry:
                transaction.set_rollback(True)
        if not dry:
            for company_id, item_id in sorted(touched_items):
                refresh_item_quantity_on_hand(company_id, item_id)
            self.stdout.write(self.style.SUCCESS(f"Cleared {len(rows)} row(s)."))
        else:
            self.stdout.write(self.style.WARNING("Dry run — no changes saved."))
