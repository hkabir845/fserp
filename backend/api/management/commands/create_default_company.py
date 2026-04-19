"""Create a default company if none exist (legacy). Prefer `migrate` (auto Master template) or `ensure_master_template`."""
from django.core.management.base import BaseCommand
from api.models import Company
from api.services.master_template import ensure_master_template_bootstrap


class Command(BaseCommand):
    help = "If the database has no companies, create the built-in Master demo tenant (FS-000001) and baseline seed."

    def handle(self, *args, **options):
        if Company.objects.filter(is_deleted=False).exists():
            self.stdout.write(self.style.WARNING("At least one company already exists. Skipping."))
            return
        r = ensure_master_template_bootstrap()
        if r.get("skipped"):
            self.stdout.write(self.style.WARNING("Master template bootstrap skipped (test mode)."))
            return
        self.stdout.write(self.style.SUCCESS("Master Filling Station (demo template, FS-000001) created."))
        self.stdout.write(
            f"Chart seeded={r.get('chart', {}).get('seeded')}; "
            f"general products added={r.get('general_products_added', 0)}; nozzles={r.get('nozzles')}."
        )
