"""
Copy POS "general" products (pos_category general / service / other) from other
companies into Master Filling Station so they appear on Cashier → General tab.

Cashier only lists items for the selected company that are not linked to tanks
and have pos_category general, service, or other.

Usage:
  python manage.py sync_general_products_to_master
  python manage.py sync_general_products_to_master --dry-run
"""
from django.core.management.base import BaseCommand
from django.db.models import Q

from api.models import Company, Item


GENERAL_CATEGORIES = ("general", "service", "other")


def get_master_company():
    master = (
        Company.objects.filter(is_master="true", is_deleted=False).first()
        or Company.objects.filter(name__iexact="Master Filling Station", is_deleted=False).first()
    )
    if master:
        if master.is_master != "true":
            master.is_master = "true"
            master.save(update_fields=["is_master"])
        return master
    master, _ = Company.objects.get_or_create(
        name="Master Filling Station",
        is_deleted=False,
        defaults={
            "legal_name": "Master Filling Station (Development)",
            "currency": "BDT",
            "is_active": True,
            "is_master": "true",
        },
    )
    master.is_master = "true"
    master.save(update_fields=["is_master"])
    return master


class Command(BaseCommand):
    help = (
        "Copy general/service/other POS items from all other companies into "
        "Master Filling Station (for Cashier General products list)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be created without saving.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        master = get_master_company()
        cid = master.id
        self.stdout.write(f"Master Filling Station company id={cid}")

        q_cat = Q()
        for cat in GENERAL_CATEGORIES:
            q_cat |= Q(pos_category__iexact=cat)
        # Items that still use default-empty category often behave as general in UI
        sources = Item.objects.filter(q_cat).exclude(company_id=cid).order_by("id")

        existing_names = {
            (n or "").strip().lower()
            for n in Item.objects.filter(company_id=cid).values_list("name", flat=True)
        }

        created = 0
        skipped = 0

        for src in sources:
            key = (src.name or "").strip().lower()
            if not key:
                skipped += 1
                continue
            if key in existing_names:
                skipped += 1
                continue

            pc = (src.pos_category or "").strip().lower() or "general"
            if pc not in GENERAL_CATEGORIES:
                pc = "general"

            if dry_run:
                self.stdout.write(
                    f"  [dry-run] Would create: {src.name!r} (pos_category={pc}, from company_id={src.company_id})"
                )
                existing_names.add(key)
                created += 1
                continue

            new_item = Item(
                company_id=cid,
                name=src.name[:200],
                description=src.description or "",
                item_type=(src.item_type or "inventory")[:32],
                unit_price=src.unit_price,
                cost=src.cost,
                quantity_on_hand=src.quantity_on_hand or 0,
                unit=(src.unit or "piece")[:20],
                pos_category=pc[:64],
                category=(src.category or "")[:100],
                barcode=(src.barcode or "")[:64],
                is_taxable=src.is_taxable,
                is_pos_available=src.is_pos_available,
                is_active=src.is_active,
                image_url=(src.image_url or "")[:500],
            )
            new_item.save()
            if not new_item.item_number:
                new_item.item_number = f"ITM-{new_item.id}"
                Item.objects.filter(pk=new_item.pk).update(item_number=new_item.item_number)
            existing_names.add(key)
            created += 1
            self.stdout.write(self.style.SUCCESS(f"  Created: {new_item.name} (id={new_item.id})"))

        action = "Would create" if dry_run else "Created"
        self.stdout.write(
            self.style.SUCCESS(
                f"Done. {action} {created} item(s); skipped {skipped} (duplicate name on master or empty name)."
            )
        )
        if created == 0 and not dry_run:
            self.stdout.write(
                "No new items. Master may already have these names, or other companies have no "
                "general/service/other (or blank category) items. Use /items to add products with "
                "POS category General for Master Filling Station."
            )
