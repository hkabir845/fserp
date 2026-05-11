"""
Create sample inter-pond fish transfer records for /aquaculture/transfers.

Idempotent: skips if transfers with memo tag are already present. Use --force to remove
those rows and re-seed.

Requires at least two active ponds (e.g. seed_aquaculture_named_ponds).

For UI auto cost from P&L, ensure the source pond has sale kg + costs in scope — run:
  python manage.py seed_aquaculture_transfer_pl_basis_demo

Example:
  python manage.py seed_aquaculture_fish_transfers_demo
  python manage.py seed_aquaculture_fish_transfers_demo --company-id 1 --force
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import (
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquaculturePond,
    AquacultureProductionCycle,
    Company,
)

DEMO_TAG = "[FISH-XFER-DEMO]"


def _resolve_company_id(explicit: int | None) -> int | None:
    if explicit is not None:
        if not Company.objects.filter(pk=explicit, is_deleted=False).exists():
            return None
        return explicit
    c = Company.objects.filter(is_deleted=False, aquaculture_enabled=True).order_by("id").first()
    if not c:
        c = Company.objects.filter(is_deleted=False).order_by("id").first()
    return c.id if c else None


def _latest_cycle(company_id: int, pond_id: int) -> AquacultureProductionCycle | None:
    return (
        AquacultureProductionCycle.objects.filter(
            company_id=company_id, pond_id=pond_id, is_active=True
        )
        .order_by("-start_date", "-id")
        .first()
    )


def _pick_source_and_dests(ponds: list[AquaculturePond]) -> tuple[AquaculturePond | None, list[AquaculturePond]]:
    if len(ponds) < 2:
        return None, []
    nursing = [p for p in ponds if getattr(p, "pond_role", "") == "nursing"]
    grow = [p for p in ponds if getattr(p, "pond_role", "") == "grow_out"]
    src = nursing[0] if nursing else ponds[0]
    others = [p for p in ponds if p.id != src.id]
    grow_others = [p for p in grow if p.id != src.id]
    if grow_others:
        dests = grow_others + [p for p in others if p not in grow_others]
    else:
        dests = others
    return src, dests


class Command(BaseCommand):
    help = "Seed sample AquacultureFishPondTransfer rows for the fish transfers UI."

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
            help=f"Delete transfers whose memo contains {DEMO_TAG!r}, then re-seed.",
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
            n_del, _ = AquacultureFishPondTransfer.objects.filter(
                company_id=cid, memo__contains=DEMO_TAG
            ).delete()
            if n_del:
                self.stdout.write(self.style.NOTICE(f"Removed {n_del} demo transfer(s)."))
        elif AquacultureFishPondTransfer.objects.filter(company_id=cid, memo__contains=DEMO_TAG).exists():
            self.stdout.write(
                self.style.WARNING(
                    f"Demo transfers already present ({DEMO_TAG}). Use --force to replace."
                )
            )
            return

        ponds = list(
            AquaculturePond.objects.filter(company_id=cid, is_active=True).order_by("sort_order", "id")
        )
        src, dests = _pick_source_and_dests(ponds)
        if not src or not dests:
            self.stdout.write(
                self.style.ERROR(
                    "Need at least two active ponds. Run: python manage.py seed_aquaculture_named_ponds"
                )
            )
            return

        today = date.today()
        d1 = today - timedelta(days=35)
        d2 = today - timedelta(days=18)

        cy_src = _latest_cycle(cid, src.id)
        cy_d0 = _latest_cycle(cid, dests[0].id)

        with transaction.atomic():
            memo1 = f"{DEMO_TAG} Nursing batch to primary grow-out."
            t1 = AquacultureFishPondTransfer.objects.create(
                company_id=cid,
                from_pond=src,
                from_production_cycle=cy_src,
                transfer_date=d1,
                fish_species="tilapia",
                memo=memo1,
            )
            AquacultureFishPondTransferLine.objects.create(
                transfer=t1,
                to_pond=dests[0],
                to_production_cycle=cy_d0,
                weight_kg=Decimal("420.0000"),
                fish_count=28000,
                pcs_per_kg=Decimal("66.6667"),
                cost_amount=Decimal("185000.00"),
            )

            if len(dests) >= 2:
                cy_d1 = _latest_cycle(cid, dests[1].id)
                memo2 = f"{DEMO_TAG} Split restock — two grow-out cells."
                t2 = AquacultureFishPondTransfer.objects.create(
                    company_id=cid,
                    from_pond=src,
                    from_production_cycle=cy_src,
                    transfer_date=d2,
                    fish_species="tilapia",
                    memo=memo2,
                )
                AquacultureFishPondTransferLine.objects.create(
                    transfer=t2,
                    to_pond=dests[0],
                    to_production_cycle=cy_d0,
                    weight_kg=Decimal("195.0000"),
                    fish_count=13650,
                    pcs_per_kg=Decimal("70.0000"),
                    cost_amount=Decimal("82000.00"),
                )
                AquacultureFishPondTransferLine.objects.create(
                    transfer=t2,
                    to_pond=dests[1],
                    to_production_cycle=cy_d1,
                    weight_kg=Decimal("175.5000"),
                    fish_count=11700,
                    pcs_per_kg=Decimal("66.6667"),
                    cost_amount=Decimal("78000.00"),
                )

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded fish pond transfers for company id={cid} (from pond {src.id!r} to {len(dests)} destination(s))."
            )
        )
