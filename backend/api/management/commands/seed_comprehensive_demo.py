"""
One command to load full-stack sample data for manual testing across FSERP.

Runs the existing demo pipeline, then layers COMP-DEMO-* rows (fry SKUs, fingerling
samples, landlords, fuel/shop sales, bills, payroll, Premium Agro stock, etc.).

Usage:
  cd backend
  python manage.py migrate
  python manage.py seed_comprehensive_demo

Options:
  --skip-base          Only run the COMP-DEMO layer (company must already be seeded).
  --fresh              Forward to seed_master_full_demo --fresh (replaces Master COA/hardware).
  --company-id N       Target company (default: Master Filling Station).
  --no-feeding-demo    Skip seed_aquaculture_feeding_demo.
  --no-dashboard-demo  Skip seed_aquaculture_dashboard_demo --force.
"""
from __future__ import annotations

import sys

from django.core.management import call_command
from django.core.management.base import BaseCommand

from api.management.commands.seed_master_full_demo import resolve_master_company
from api.models import Company
from api.services.comprehensive_demo_seed import run_comprehensive_demo


class Command(BaseCommand):
    help = (
        "Seed Master Filling Station with full application demo data for end-to-end testing "
        "(fuel, shop, aquaculture, HR, AR/AP, reports)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--skip-base",
            action="store_true",
            help="Skip base seeds; only run COMP-DEMO layer.",
        )
        parser.add_argument(
            "--fresh",
            action="store_true",
            help="Replace Master COA and forecourt hardware (seed_master_full_demo --fresh).",
        )
        parser.add_argument(
            "--company-id",
            type=int,
            default=None,
            help="Company id (default: Master Filling Station).",
        )
        parser.add_argument(
            "--no-feeding-demo",
            action="store_true",
            help="Do not run seed_aquaculture_feeding_demo.",
        )
        parser.add_argument(
            "--no-dashboard-demo",
            action="store_true",
            help="Do not run seed_aquaculture_dashboard_demo --force.",
        )

    def handle(self, *args, **options):
        if hasattr(sys.stdout, "reconfigure"):
            try:
                sys.stdout.reconfigure(encoding="utf-8")
            except Exception:
                pass

        if not options["skip_base"]:
            fd_kw: dict = {}
            if options["fresh"]:
                fd_kw["fresh"] = True
            self.stdout.write(self.style.NOTICE("==> Base application demo"))
            call_command(
                "seed_application_full_demo",
                bulk_example=True,
                **fd_kw,
            )
            self.stdout.write(self.style.NOTICE("==> Named aquaculture ponds (Digonta, Mynuddin, Ashari)"))
            call_command(
                "seed_aquaculture_named_ponds",
                fill_page=True,
                provision_pos_customer=True,
                company_id=options["company_id"],
            )
            self.stdout.write(self.style.NOTICE("==> General shop products"))
            call_command("seed_master_general_products")
            if not options["no_dashboard_demo"]:
                self.stdout.write(self.style.NOTICE("==> Aquaculture dashboard KPI spread"))
                call_command(
                    "seed_aquaculture_dashboard_demo",
                    force=True,
                    company_id=options["company_id"],
                )
            if not options["no_feeding_demo"]:
                self.stdout.write(self.style.NOTICE("==> Aquaculture feeding advice demo"))
                call_command(
                    "seed_aquaculture_feeding_demo",
                    company_id=options["company_id"],
                )
            self.stdout.write(self.style.NOTICE("==> Fish pond transfers + P&L cost basis"))
            call_command(
                "seed_aquaculture_fish_transfers_demo",
                force=True,
                company_id=options["company_id"],
            )
            call_command(
                "seed_aquaculture_transfer_pl_basis_demo",
                force=True,
                company_id=options["company_id"],
            )

        if options["company_id"]:
            company = Company.objects.filter(pk=options["company_id"], is_deleted=False).first()
            if not company:
                self.stdout.write(self.style.ERROR(f"Company id={options['company_id']} not found."))
                return
        else:
            company = resolve_master_company(self.stdout, self.style)

        if not company.aquaculture_enabled:
            company.aquaculture_enabled = True
            company.aquaculture_licensed = True
            company.save(update_fields=["aquaculture_enabled", "aquaculture_licensed", "updated_at"])

        run_comprehensive_demo(company.id, self.stdout, self.style)
        self.stdout.write("")
        self.stdout.write(
            self.style.SUCCESS(
                "Comprehensive demo ready. Log in as Master Filling Station and test fuel POS, "
                "Premium Agro shop, aquaculture ponds, reports, and payroll."
            )
        )
