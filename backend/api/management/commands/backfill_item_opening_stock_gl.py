"""
Capitalize existing inventory items' on-hand stock as opening inventory in the G/L.

Posts AUTO-ITEM-OB-{id} (Dr inventory asset 1200/1220 / Cr 3200 Opening Balance Equity) for each
physical-stock, non-fish item that has quantity_on_hand > 0 and cost > 0 but no opening journal yet.
Opening qty is snapshotted from the item's CURRENT quantity_on_hand as of the go-live date you pass.

CAUTION: only run this for stock that was NOT already received through posted vendor bills (those
already debited the inventory asset). Use --dry-run first to review the impact.

Usage:
  python manage.py backfill_item_opening_stock_gl --company-id 1 --as-of 2026-01-01 --dry-run
  python manage.py backfill_item_opening_stock_gl --company-id 1 --as-of 2026-01-01
  python manage.py backfill_item_opening_stock_gl --company-id 1 --as-of 2026-01-01 --force-repost
"""
from datetime import datetime
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError

from api.models import Company, Item
from api.services.item_catalog import item_tracks_physical_stock
from api.services.item_opening_stock_gl import (
    item_is_biological_stock,
    post_item_opening_stock_gl,
)


class Command(BaseCommand):
    help = "Backfill opening inventory G/L (Dr inventory / Cr 3200) for existing on-hand items."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument("--as-of", type=str, required=True, help="Go-live date YYYY-MM-DD")
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report candidates and total value without posting.",
        )
        parser.add_argument(
            "--force-repost",
            action="store_true",
            help="Re-snapshot and re-post even if an opening journal already exists.",
        )

    def handle(self, *args, **options):
        company_id = int(options["company_id"])
        if not Company.objects.filter(pk=company_id, is_deleted=False).exists():
            raise CommandError(f"Company {company_id} not found.")
        try:
            as_of = datetime.strptime(options["as_of"], "%Y-%m-%d").date()
        except ValueError as e:
            raise CommandError("Use --as-of as YYYY-MM-DD.") from e

        dry_run = bool(options["dry_run"])
        force = bool(options["force_repost"])

        posted = skipped_existing = skipped_no_value = failed = 0
        total_value = Decimal("0")

        qs = Item.objects.filter(company_id=company_id).order_by("id")
        for item in qs.iterator(chunk_size=200):
            if not item_tracks_physical_stock(item) or item_is_biological_stock(item):
                continue
            qty = item.quantity_on_hand or Decimal("0")
            cost = item.cost or Decimal("0")
            if qty <= 0 or cost <= 0:
                skipped_no_value += 1
                continue
            if item.opening_balance_journal_id and not force:
                skipped_existing += 1
                continue

            value = (qty * cost).quantize(Decimal("0.01"))
            total_value += value

            if dry_run:
                posted += 1
                self.stdout.write(
                    f"  would post item {item.id} '{item.name[:40]}': "
                    f"{qty} x {cost} = {value}"
                )
                continue

            item.opening_stock_quantity = qty
            item.opening_stock_unit_cost = cost
            item.opening_balance_date = as_of
            item.save(
                update_fields=[
                    "opening_stock_quantity",
                    "opening_stock_unit_cost",
                    "opening_balance_date",
                ]
            )
            if post_item_opening_stock_gl(
                company_id, item, force_repost=force
            ):
                posted += 1
            else:
                failed += 1
                self.stdout.write(
                    self.style.WARNING(
                        f"  FAILED item {item.id} '{item.name[:40]}' "
                        "(missing inventory account or 3200 Opening Balance Equity)"
                    )
                )

        verb = "would post" if dry_run else "posted"
        self.stdout.write(
            self.style.SUCCESS(
                f"Opening stock backfill company_id={company_id} as_of={as_of}: "
                f"{verb}={posted} value={total_value} skipped_existing={skipped_existing} "
                f"skipped_no_value={skipped_no_value} failed={failed}"
                + (" [DRY RUN]" if dry_run else "")
            )
        )
