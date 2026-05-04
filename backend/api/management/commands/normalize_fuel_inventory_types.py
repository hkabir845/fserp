"""
Set item_type to 'inventory' for typical fuel products so vendor bills receive stock.

Usage:
  python manage.py normalize_fuel_inventory_types --company-id 3
  python manage.py normalize_fuel_inventory_types --company-id 3 --dry-run
"""
from django.core.management.base import BaseCommand
from django.db.models import Q

from api.models import Item


class Command(BaseCommand):
    help = "Ensure Diesel/Petrol (and pos_category=fuel) items use item_type=inventory."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        cid = options["company_id"]
        dry = options["dry_run"]
        q = Item.objects.filter(company_id=cid).filter(
            Q(pos_category__iexact="fuel")
            | Q(name__iexact="diesel")
            | Q(name__iexact="petrol")
            | Q(name__iexact="gasoline")
            | Q(name__iexact="octane")
        ).exclude(item_type__iexact="inventory")
        ids = list(q.values_list("id", "name", "item_type"))
        for pk, name, it in ids:
            self.stdout.write(f"  id={pk} name={name!r} item_type={it!r} -> inventory")
        if dry:
            self.stdout.write(self.style.WARNING("Dry run; no changes."))
            return
        n = q.update(item_type="inventory")
        self.stdout.write(self.style.SUCCESS(f"Updated {n} item(s)."))
