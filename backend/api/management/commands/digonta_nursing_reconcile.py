"""One-shot Digonta nursing data cleanup — run: python manage.py digonta_nursing_reconcile"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import (
    AquacultureBiomassSample,
    AquacultureExpense,
    AquacultureFishStockLedger,
    AquaculturePond,
    AquacultureProductionCycle,
    Company,
)
from api.services.aquaculture_biomass_sample_service import apply_aquaculture_biomass_sample_extrapolation
from api.services.aquaculture_stock_ledger_reconcile_service import backfill_biomass_sample_extrapolation
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows
from api.services.aquaculture_transfer_cost import resync_nursing_pond_transfer_costs

FRY_COUNT = 500_000
FRY_UNIT_BDT = Decimal("2.20")
FRY_TOTAL_BDT = Decimal("1100000.00")
FRY_IN_WEIGHT_KG = (Decimal(FRY_COUNT) / Decimal("3000")).quantize(Decimal("0.0001"))
MEMO_TAG = "[DIGONTA-NURSING-RECONCILE]"


class Command(BaseCommand):
    help = "Re-tag Digonta fry to Demo crop, fix stock ledger for 500k @ 2.20 batch, resync transfer costs."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, default=None)
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        cid = options["company_id"]
        if cid is None:
            c = Company.objects.filter(is_deleted=False, aquaculture_enabled=True).order_by("id").first()
            cid = c.id if c else None
        if not cid:
            self.stderr.write("No company.")
            return

        pond = AquaculturePond.objects.filter(company_id=cid, name__iexact="Digonta").first()
        if not pond:
            self.stderr.write("Digonta pond not found.")
            return

        demo = AquacultureProductionCycle.objects.filter(
            company_id=cid, pond_id=pond.id, name__icontains="Demo crop"
        ).first()
        if not demo:
            demo = AquacultureProductionCycle.objects.filter(
                company_id=cid, pond_id=pond.id, code__startswith="DASH-DEMO-CY-"
            ).first()
        if not demo:
            self.stderr.write("Demo crop cycle not found on Digonta.")
            return

        dry = options["dry_run"]
        self.stdout.write(f"Digonta pond id={pond.id}, Demo crop id={demo.id} ({demo.name}), dry_run={dry}")

        with transaction.atomic():
            stats = self._run(cid, pond, demo, dry)
            if dry:
                transaction.set_rollback(True)

        for k, v in stats.items():
            self.stdout.write(f"  {k}: {v}")

    def _run(self, cid: int, pond, demo, dry: bool) -> dict:
        stats: dict[str, int | str] = {}

        # 1) Fry expenses: one BDT 1.1M on Demo crop; remove duplicate untagged manual row.
        fry_qs = AquacultureExpense.objects.filter(
            company_id=cid, pond_id=pond.id, expense_category="fry_stocking"
        ).order_by("expense_date", "id")
        keep = fry_qs.filter(amount=FRY_TOTAL_BDT).order_by("-expense_date", "-id").first()
        if keep is None:
            keep = fry_qs.first()

        removed = 0
        for exp in fry_qs:
            if exp.id == (keep.id if keep else None):
                continue
            if exp.amount == FRY_TOTAL_BDT or (keep and exp.amount == keep.amount):
                exp.delete()
                removed += 1
            elif exp.amount == Decimal("385000.00"):
                # Demo duplicate from COMP-DEMO seed — superseded by user's 500k @ 2.20 batch.
                exp.delete()
                removed += 1

        if keep:
            keep.production_cycle = demo
            keep.amount = FRY_TOTAL_BDT
            keep.expense_date = demo.start_date or date(2026, 1, 26)
            memo = (keep.memo or "").strip()
            if MEMO_TAG not in memo:
                keep.memo = f"{MEMO_TAG} 500,000 tilapia fry @ BDT 2.20/pc (3,000 pcs/kg). {memo}".strip()
            keep.save(update_fields=["production_cycle", "amount", "expense_date", "memo", "updated_at"])
            stats["fry_expense_id"] = keep.id
        else:
            exp = AquacultureExpense.objects.create(
                company_id=cid,
                pond=pond,
                production_cycle=demo,
                expense_category="fry_stocking",
                expense_date=demo.start_date or date(2026, 1, 26),
                amount=FRY_TOTAL_BDT,
                memo=f"{MEMO_TAG} 500,000 tilapia fry @ BDT 2.20/pc (3,000 pcs/kg).",
                vendor_name="Fry supplier",
            )
            stats["fry_expense_id"] = exp.id
        stats["fry_expenses_removed"] = removed

        # 2) Stock ledger: single opening row on Demo crop for 500k fry in.
        AquacultureFishStockLedger.objects.filter(
            company_id=cid,
            pond_id=pond.id,
            production_cycle_id=demo.id,
            memo__contains=MEMO_TAG,
        ).delete()

        # Remove conflicting demo opening rows on this cycle (small 52k seed).
        AquacultureFishStockLedger.objects.filter(
            company_id=cid,
            pond_id=pond.id,
            production_cycle_id=demo.id,
            memo__contains="DEMO-OPENING-STOCK",
        ).delete()

        AquacultureFishStockLedger.objects.create(
            company_id=cid,
            pond=pond,
            production_cycle=demo,
            entry_date=demo.start_date or date(2026, 1, 26),
            entry_kind="adjustment",
            fish_species="tilapia",
            fish_count_delta=FRY_COUNT,
            weight_kg_delta=FRY_IN_WEIGHT_KG,
            book_value=FRY_TOTAL_BDT,
            post_to_books=False,
            memo=f"{MEMO_TAG} Opening 500,000 fry stocked (3,000 pcs/kg) — Demo crop batch.",
        )
        stats["opening_ledger_created"] = 1

        # 3) Biomass sample on Demo crop @ ~14 pcs/kg with pond-wide reference.
        sample_date = date(2026, 5, 25)
        survivor_est = 470_000  # ~6% nursing mortality from 500k
        weight_kg = (Decimal(survivor_est) / Decimal("14")).quantize(Decimal("0.0001"))
        avg_kg = (weight_kg / Decimal(survivor_est)).quantize(Decimal("0.000001"))
        sample, created = AquacultureBiomassSample.objects.update_or_create(
            company_id=cid,
            pond=pond,
            production_cycle=demo,
            sample_date=sample_date,
            defaults={
                "estimated_fish_count": 500,
                "estimated_total_weight_kg": (Decimal("500") / Decimal("14")).quantize(Decimal("0.0001")),
                "avg_weight_kg": avg_kg,
                "fish_species": "tilapia",
                "notes": f"{MEMO_TAG} Seine sample ~14 pcs/kg; extrapolated to batch survivors.",
                "stock_reference_fish_count": FRY_COUNT,
                "stock_reference_net_weight_kg": FRY_IN_WEIGHT_KG,
                "stock_reference_avg_weight_kg": (FRY_IN_WEIGHT_KG / Decimal(FRY_COUNT)).quantize(
                    Decimal("0.0000001")
                ),
            },
        )
        apply_aquaculture_biomass_sample_extrapolation(sample)
        sample.save()
        stats["biomass_sample_updated"] = 0 if created else 1

        backfill_biomass_sample_extrapolation(cid)

        # 4) Show resulting stock position.
        rows = compute_fish_stock_position_rows(cid, pond_id=pond.id, production_cycle_id=demo.id)
        if rows:
            r = rows[0]
            stats["implied_net_fish_count"] = int(r.get("implied_net_fish_count") or 0)
            stats["vendor_bill_in_fish_count"] = int(r.get("vendor_bill_in_fish_count") or 0)

        # 5) Resync nursing transfer line costs for all cycles on this pond.
        updated = resync_nursing_pond_transfer_costs(
            company_id=cid,
            from_pond_id=pond.id,
            from_production_cycle_id=None,
            sync_gl=False,
        )
        stats["transfer_lines_resynced"] = updated

        return stats
