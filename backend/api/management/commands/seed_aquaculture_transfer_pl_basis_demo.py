"""
Seed minimal aquaculture P&L inputs so /aquaculture/transfers can auto-fill Cost amount.

The transfers UI uses GET /aquaculture/pl-summary/ total_cost_per_kg for the *source* pond.
That value needs:
  - Positive biological sale kg in the analysis window (fish_harvest_sale and/or
    fingerling_sale / processing_value_add weights), and
  - Some pond operating costs in the same scope (expenses, etc.).

Creates a tagged production cycle, one direct expense, and one small fingerling-style sale
on the preferred source pond (nursing if present, else first active pond). Dates are
clamped to the current calendar year so YTD windows always include them.

Idempotent: skips if tagged rows already exist. Use --force to remove and re-seed.

Example:
  python manage.py seed_aquaculture_transfer_pl_basis_demo
  python manage.py seed_aquaculture_transfer_pl_basis_demo --company-id 1 --force
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import (
    AquacultureExpense,
    AquacultureFishSale,
    AquaculturePond,
    AquacultureProductionCycle,
    Company,
)

DEMO_TAG = "[XFER-PL-BASIS]"
CYCLE_CODE = "XFER-COST-DEMO"


def _resolve_company_id(explicit: int | None) -> int | None:
    if explicit is not None:
        if not Company.objects.filter(pk=explicit, is_deleted=False).exists():
            return None
        return explicit
    c = Company.objects.filter(is_deleted=False, aquaculture_enabled=True).order_by("id").first()
    if not c:
        c = Company.objects.filter(is_deleted=False).order_by("id").first()
    return c.id if c else None


def _pick_source_pond(ponds: list[AquaculturePond]) -> AquaculturePond | None:
    if not ponds:
        return None
    nursing = [p for p in ponds if getattr(p, "pond_role", "") == "nursing"]
    return nursing[0] if nursing else ponds[0]


def _clamp_year_to_date(*, today: date, days_ago: int) -> date:
    year_start = date(today.year, 1, 1)
    d = today - timedelta(days=days_ago)
    if d < year_start:
        d = year_start
    if d > today:
        d = today
    return d


class Command(BaseCommand):
    help = "Seed P&L basis (sale kg + costs) so fish transfer Cost amount can auto-fill from pl-summary."

    def add_arguments(self, parser):
        parser.add_argument(
            "--company-id",
            type=int,
            default=None,
            help="Company PK (default: first aquaculture_enabled company, else lowest id).",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help=f"Delete rows tagged {DEMO_TAG!r} for this company, then re-seed.",
        )

    def handle(self, *args, **options):
        cid = _resolve_company_id(options["company_id"])
        if cid is None:
            self.stdout.write(self.style.ERROR("Company not found."))
            return

        company = Company.objects.get(pk=cid)
        if not company.aquaculture_enabled or not company.aquaculture_licensed:
            company.aquaculture_enabled = True
            company.aquaculture_licensed = True
            company.save(update_fields=["aquaculture_enabled", "aquaculture_licensed", "updated_at"])
            self.stdout.write(self.style.NOTICE("Enabled aquaculture flags on company."))

        if options["force"]:
            ne, _ = AquacultureExpense.objects.filter(company_id=cid, memo__contains=DEMO_TAG).delete()
            ns, _ = AquacultureFishSale.objects.filter(company_id=cid, memo__contains=DEMO_TAG).delete()
            if ne or ns:
                self.stdout.write(self.style.NOTICE(f"Removed demo basis rows (expenses={ne}, sales={ns})."))
        elif AquacultureExpense.objects.filter(company_id=cid, memo__contains=DEMO_TAG).exists():
            self.stdout.write(
                self.style.WARNING(
                    f"Transfer P&L basis demo already present ({DEMO_TAG}). Use --force to replace."
                )
            )
            return

        ponds = list(
            AquaculturePond.objects.filter(company_id=cid, is_active=True).order_by("sort_order", "id")
        )
        src = _pick_source_pond(ponds)
        if not src:
            self.stdout.write(
                self.style.ERROR(
                    "No active aquaculture ponds. Create ponds first (e.g. seed_aquaculture_named_ponds "
                    "or seed_application_full_demo)."
                )
            )
            return

        today = date.today()
        exp_date = _clamp_year_to_date(today=today, days_ago=14)
        sale_date = _clamp_year_to_date(today=today, days_ago=7)
        if sale_date < exp_date:
            sale_date = exp_date

        with transaction.atomic():
            cy, _ = AquacultureProductionCycle.objects.get_or_create(
                company_id=cid,
                pond=src,
                code=CYCLE_CODE,
                defaults={
                    "name": "Transfer cost demo (P&L basis)",
                    "start_date": date(today.year, 1, 1),
                    "end_date": None,
                    "is_active": True,
                    "notes": f"{DEMO_TAG} Open cycle: tie demo expense + sale for cost/kg denominator.",
                },
            )

            AquacultureExpense.objects.create(
                company_id=cid,
                pond=src,
                production_cycle=cy,
                expense_category="fry_stocking",
                expense_date=exp_date,
                amount=Decimal("350000.00"),
                memo=f"{DEMO_TAG} Demo fry / fingerling cost for nursing P&L (transfer auto-cost).",
                vendor_name="Demo Hatchery Supply",
            )

            # fingerling_sale counts toward biological-sale kg denominator when no harvest kg.
            AquacultureFishSale.objects.create(
                company_id=cid,
                pond=src,
                production_cycle=cy,
                income_type="fingerling_sale",
                fish_species="tilapia",
                sale_date=sale_date,
                weight_kg=Decimal("500.0000"),
                fish_count=25000,
                total_amount=Decimal("187500.00"),
                buyer_name="Demo Buyer (P&L basis seed)",
                memo=f"{DEMO_TAG} Demo sale kg so total_cost_per_kg can be computed.",
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded transfer P&L basis for company id={cid}: pond {src.id!r} ({src.name!r}), "
                f"cycle {cy.id!r}. Record a transfer from this pond (optionally this cycle) — "
                f"Cost amount should auto-fill when weight is entered."
            )
        )
