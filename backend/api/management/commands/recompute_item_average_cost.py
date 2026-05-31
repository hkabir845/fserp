"""
Rebuild each item's moving weighted-average cost (AVCO) from its opening layer + posted bill receipts.

  new_cost = (opening_qty * opening_unit_cost + sum(receipt amount)) / (opening_qty + sum(receipt qty))

Under AVCO, issues/sales at average cost do not change the unit cost — only receipts do — so the
current average equals the weighted average of the opening layer and all posted receipts. Fish /
biological SKUs are skipped (valued via aquaculture cost-per-kg).

Usage:
  python manage.py recompute_item_average_cost --company-id 1 --dry-run
  python manage.py recompute_item_average_cost --company-id 1
"""
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Sum

from api.models import BillLine, Company, Item
from api.services.gl_posting import recompute_item_average_cost
from api.services.item_catalog import item_tracks_physical_stock


class Command(BaseCommand):
    help = "Recompute Item.cost as moving weighted-average (AVCO) from opening + posted bill receipts."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument("--dry-run", action="store_true", help="Report changes without saving.")

    def handle(self, *args, **options):
        company_id = int(options["company_id"])
        if not Company.objects.filter(pk=company_id, is_deleted=False).exists():
            raise CommandError(f"Company {company_id} not found.")
        dry_run = bool(options["dry_run"])

        updated = skipped = 0
        for item in Item.objects.filter(company_id=company_id).order_by("id").iterator(chunk_size=200):
            if not item_tracks_physical_stock(item) or (item.pos_category or "").strip().lower() == "fish":
                continue

            opening_qty = item.opening_stock_quantity or Decimal("0")
            opening_cost = item.opening_stock_unit_cost or Decimal("0")
            base_qty = opening_qty if opening_qty > 0 and opening_cost > 0 else Decimal("0")
            base_value = (opening_qty * opening_cost) if base_qty > 0 else Decimal("0")

            agg = BillLine.objects.filter(
                bill__company_id=company_id,
                bill__stock_receipt_applied=True,
                item_id=item.id,
            ).aggregate(q=Sum("quantity"), v=Sum("amount"))
            recv_qty = agg["q"] or Decimal("0")
            recv_value = agg["v"] or Decimal("0")

            denom = base_qty + recv_qty
            total_value = base_value + recv_value
            if denom <= 0 or total_value <= 0:
                skipped += 1
                continue

            new_cost = (total_value / denom).quantize(Decimal("0.0001"))
            old_cost = item.cost or Decimal("0")
            if new_cost == old_cost:
                skipped += 1
                continue

            self.stdout.write(
                f"  item {item.id} '{item.name[:40]}': {old_cost} -> {new_cost} "
                f"(opening {base_qty}@{opening_cost} + receipts {recv_qty}@{recv_value})"
            )
            if not dry_run:
                # Shared service is the single source of truth for the AVCO formula.
                recompute_item_average_cost(company_id, item.id)
            updated += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"AVCO recompute company_id={company_id}: "
                f"{'would update' if dry_run else 'updated'}={updated} unchanged_or_skipped={skipped}"
                + (" [DRY RUN]" if dry_run else "")
            )
        )
