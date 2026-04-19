"""
Create common shop / general POS products for Master Filling Station so they
appear on Cashier → General (pos_category=general, not linked to tanks).

Use when the DB only has fuel items or Master has no general products.

Usage:
  python manage.py seed_master_general_products
  python manage.py seed_master_general_products --dry-run
"""
from decimal import Decimal

from django.core.management.base import BaseCommand

from api.models import Item
from api.services.master_template import DEFAULT_GENERAL_DEMO_PRODUCTS, get_or_create_master_template_company


def get_master_company():
    c, _ = get_or_create_master_template_company()
    return c


class Command(BaseCommand):
    help = "Seed Master Filling Station with general POS products for Cashier → General tab."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Print actions only.")

    def handle(self, *args, **options):
        dry = options["dry_run"]
        master = get_master_company()
        cid = master.id
        self.stdout.write(f"Master Filling Station id={cid}")

        existing = {
            (n or "").strip().lower()
            for n in Item.objects.filter(company_id=cid).values_list("name", flat=True)
        }

        n = 0
        for row in DEFAULT_GENERAL_DEMO_PRODUCTS:
            key = row["name"].strip().lower()
            if key in existing:
                self.stdout.write(f"  Skip (exists): {row['name']}")
                continue
            if dry:
                self.stdout.write(f"  [dry-run] Would create: {row['name']}")
                existing.add(key)
                n += 1
                continue

            pos_cat = "service" if row["item_type"] == "service" else "general"
            it = Item(
                company_id=cid,
                name=row["name"][:200],
                description="",
                item_type=row["item_type"][:32],
                unit_price=Decimal(row["unit_price"]),
                cost=Decimal(row["cost"]),
                quantity_on_hand=Decimal("100.0000") if row["item_type"] == "inventory" else Decimal("0"),
                unit=row["unit"][:20],
                pos_category=pos_cat,
                category=(row.get("category") or "")[:100],
                barcode="",
                is_taxable=True,
                is_pos_available=True,
                is_active=True,
                image_url="",
            )
            it.save()
            it.item_number = f"ITM-{it.id}"
            Item.objects.filter(pk=it.pk).update(item_number=it.item_number)
            existing.add(key)
            n += 1
            self.stdout.write(self.style.SUCCESS(f"  Created: {it.name} (id={it.id})"))

        self.stdout.write(self.style.SUCCESS(f"Done. {'Would create' if dry else 'Created'} {n} product(s)."))
