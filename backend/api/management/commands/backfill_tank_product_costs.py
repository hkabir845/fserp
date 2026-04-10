"""
Set Item.cost (৳ per liter or per UOM) for products that are linked to tanks when cost is zero.

Uses unit_price × ratio as a practical default so dip variance reports and GL use non-zero BDT.
Review costs after running; replace with true landed cost from suppliers when known.

Usage:
  python manage.py backfill_tank_product_costs --dry-run
  python manage.py backfill_tank_product_costs
  python manage.py backfill_tank_product_costs --company-id 1
  python manage.py backfill_tank_product_costs --ratio 0.92
"""

from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import Item, Tank


class Command(BaseCommand):
    help = (
        "Backfill Item.cost for products referenced by Tank.product when cost is zero, "
        "from unit_price × ratio (default ratio 1.0)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--company-id",
            type=int,
            default=None,
            help="Limit to one company; default = all companies",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show changes only; do not write",
        )
        parser.add_argument(
            "--ratio",
            type=str,
            default="1",
            help="cost = unit_price × ratio (e.g. 0.92 for ~8%% margin assumption). Default 1",
        )

    def handle(self, *args, **options):
        company_id = options["company_id"]
        dry_run = options["dry_run"]
        try:
            ratio = Decimal(str(options["ratio"]))
        except Exception:
            self.stderr.write("Invalid --ratio")
            return
        if ratio <= 0:
            self.stderr.write("--ratio must be positive")
            return

        tank_qs = Tank.objects.all()
        if company_id is not None:
            tank_qs = tank_qs.filter(company_id=company_id)

        pairs = tank_qs.values_list("company_id", "product_id").distinct()
        updated = 0
        skipped_has_cost = 0
        skipped_no_price = 0

        for cid, pid in pairs:
            if not pid:
                continue
            item = Item.objects.filter(id=pid, company_id=cid).first()
            if not item:
                continue
            cost = item.cost or Decimal("0")
            if cost > 0:
                skipped_has_cost += 1
                continue
            price = item.unit_price or Decimal("0")
            if price <= 0:
                skipped_no_price += 1
                self.stdout.write(
                    self.style.WARNING(
                        f"  skip item id={item.id} company={cid} {item.name!r}: cost and unit_price both zero"
                    )
                )
                continue
            new_cost = (price * ratio).quantize(Decimal("0.01"))
            self.stdout.write(
                f"  company={cid} item={item.id} {item.name!r}: cost {cost} → {new_cost} (from unit_price {price} × {ratio})"
            )
            if not dry_run:
                with transaction.atomic():
                    Item.objects.filter(pk=item.pk).update(cost=new_cost)
            updated += 1

        self.stdout.write("")
        if dry_run:
            self.stdout.write(self.style.WARNING(f"DRY RUN — would update {updated} item row(s)"))
        else:
            self.stdout.write(self.style.SUCCESS(f"Updated {updated} item row(s)"))
        self.stdout.write(
            f"Skipped (already had cost): {skipped_has_cost}; skipped (no unit price): {skipped_no_price}"
        )
