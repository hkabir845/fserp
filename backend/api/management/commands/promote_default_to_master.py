"""One-time fix: rename legacy 'Default Company' to Master Filling Station and set is_master.

Use when the DB was auto-seeded with Default Company before the canonical master name was used.

  python manage.py promote_default_to_master
"""
from django.core.management.base import BaseCommand

from api.models import Company


class Command(BaseCommand):
    help = "Rename 'Default Company' to Master Filling Station and mark is_master (if safe)."

    def handle(self, *args, **options):
        if Company.objects.filter(is_deleted=False, is_master="true").exists():
            self.stdout.write(
                self.style.WARNING("A master company (is_master=true) already exists. Nothing to do.")
            )
            return

        candidates = list(
            Company.objects.filter(is_deleted=False, name__iexact="Default Company").order_by("id")
        )
        if not candidates:
            self.stdout.write(
                self.style.WARNING(
                    "No non-deleted company named 'Default Company' found. "
                    "Run: python manage.py seed_master_chart_of_accounts"
                )
            )
            return
        if len(candidates) > 1:
            self.stdout.write(
                self.style.ERROR(
                    f"Multiple 'Default Company' rows ({len(candidates)}). Resolve duplicates manually."
                )
            )
            return

        c = candidates[0]
        c.name = "Master Filling Station"
        c.legal_name = "Master Filling Station (Development)"
        c.is_master = "true"
        c.save(update_fields=["name", "legal_name", "is_master"])
        self.stdout.write(
            self.style.SUCCESS(f"Updated company id={c.id} to Master Filling Station (master).")
        )
