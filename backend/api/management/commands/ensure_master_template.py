"""Ensure Master Filling Station (FS-000001) exists with baseline demo data. Usually runs automatically after migrate."""
from django.core.management.base import BaseCommand

from api.services.master_template import ensure_master_template_bootstrap


class Command(BaseCommand):
    help = (
        "Ensure the built-in Master demo tenant (FS-000001): chart, shop products, fuel hardware. "
        "Idempotent. For full GL/demo journals run: python manage.py seed_master_full_demo"
    )

    def handle(self, *args, **options):
        r = ensure_master_template_bootstrap()
        if r.get("skipped"):
            self.stdout.write(
                self.style.WARNING(
                    "Skipped (SKIP_MASTER_TEMPLATE_BOOTSTRAP). Unset or use migrate without test runner."
                )
            )
            return
        self.stdout.write(
            self.style.SUCCESS(
                f"Master template: company_id={r['company_id']} code=FS-000001 "
                f"created={r['created']} products_added={r['general_products_added']} "
                f"nozzles={r.get('nozzles')}"
            )
        )
