"""
Rich sample data for http://localhost:3000/aquaculture/feeding — feeding advice pipeline
with full WorldFish-style snapshots, meal plans, and mixed statuses.

Creates dedicated ponds (codes FEED-UI-*), production cycles, biomass samples, tilapia
stock ledger rows, recent feed expenses, default feed SKU + pond warehouse stock, then
advice rows generated via build_feeding_advice_payload (same logic as the API).

Idempotent: skips if demo feeding rows already exist. Use --force to remove FEED-UI-* ponds
and re-seed.

Examples:
  cd backend
  python manage.py seed_aquaculture_feeding_demo
  python manage.py seed_aquaculture_feeding_demo --company-id 1 --force
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Max
from django.utils import timezone as django_timezone

from api.models import (
    AquacultureBiomassSample,
    AquacultureExpense,
    AquacultureFeedingAdvice,
    AquacultureFishStockLedger,
    AquaculturePond,
    AquacultureProductionCycle,
    Company,
    Item,
    ItemPondStock,
)
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
from api.services.aquaculture_feeding_advice_service import (
    build_feeding_advice_payload,
    effective_advice_text,
)
from api.services.aquaculture_pond_pos_customer import maybe_provision_auto_pos_customer
from api.services.station_stock import refresh_item_quantity_on_hand

DEMO_TAG = "[FEED-UI-DEMO]"
POND_CODE_PREFIX = "FEED-UI-"
ITEM_NUMBER = "FEED-UI-PELLET-25"


def _resolve_company_id(explicit: int | None) -> int | None:
    if explicit is not None:
        if not Company.objects.filter(pk=explicit, is_deleted=False).exists():
            return None
        return explicit
    c = Company.objects.filter(is_deleted=False, aquaculture_enabled=True).order_by("id").first()
    if not c:
        c = Company.objects.filter(is_deleted=False).order_by("id").first()
    return c.id if c else None


def _ensure_feed_item(company_id: int) -> Item:
    it = Item.objects.filter(company_id=company_id, item_number=ITEM_NUMBER).first()
    if it:
        return it
    return Item.objects.create(
        company_id=company_id,
        item_number=ITEM_NUMBER,
        name="AquaGrow Floating Pellet 3 mm (25 kg sack)",
        description="Demo tilapia grower feed for feeding-advice UI.",
        item_type="inventory",
        unit_price=Decimal("1850.00"),
        cost=Decimal("1620.00"),
        unit="sack",
        pos_category="feed",
        content_weight_kg=Decimal("25"),
        category="Aquaculture feed",
        is_active=True,
    )


def _cleanup_demo(company_id: int, stdout, style) -> None:
    pond_ids = list(
        AquaculturePond.objects.filter(company_id=company_id, code__startswith=POND_CODE_PREFIX).values_list(
            "id", flat=True
        )
    )
    if not pond_ids:
        return
    n_adv, _ = AquacultureFeedingAdvice.objects.filter(company_id=company_id, pond_id__in=pond_ids).delete()
    n_exp, _ = AquacultureExpense.objects.filter(company_id=company_id, memo__contains=DEMO_TAG).delete()
    n_sam, _ = AquacultureBiomassSample.objects.filter(company_id=company_id, notes__contains=DEMO_TAG).delete()
    n_led, _ = AquacultureFishStockLedger.objects.filter(company_id=company_id, memo__contains=DEMO_TAG).delete()
    n_cy, _ = AquacultureProductionCycle.objects.filter(
        company_id=company_id, code__startswith=POND_CODE_PREFIX
    ).delete()
    n_ips, _ = ItemPondStock.objects.filter(company_id=company_id, pond_id__in=pond_ids).delete()
    n_p, _ = AquaculturePond.objects.filter(company_id=company_id, id__in=pond_ids).delete()
    stdout.write(
        style.NOTICE(
            f"Removed demo feeding seed: ponds={n_p} cycles={n_cy} samples={n_sam} ledger={n_led} "
            f"expenses={n_exp} advice={n_adv} pond_stock={n_ips}"
        )
    )


# Pond code, display name, role, water dec, depth ft, fish count, total kg (tilapia), sample avg kg, sack kg for advice
POND_SPECS: tuple[tuple[str, str, str, Decimal, Decimal, int, Decimal, Decimal, int], ...] = (
    ("FEED-UI-KHUL-A", "Khalishpur Grow-A", "grow_out", Decimal("2.1000"), Decimal("5.600"), 13500, Decimal("2430.0000"), Decimal("0.180000"), 25),
    ("FEED-UI-CHAL-B", "Chalna Grow-B", "grow_out", Decimal("1.6000"), Decimal("5.100"), 9800, Decimal("931.0000"), Decimal("0.095000"), 20),
    ("FEED-UI-RUP-C", "Rupsha Nursery-C", "nursing", Decimal("0.4800"), Decimal("4.000"), 48000, Decimal("576.0000"), Decimal("0.012000"), 25),
    ("FEED-UI-BAT-D", "Batiaghata Finisher-D", "grow_out", Decimal("3.0500"), Decimal("6.100"), 8200, Decimal("2624.0000"), Decimal("0.320000"), 10),
)


class Command(BaseCommand):
    help = "Seed realistic feeding-advice rows and pond context for the aquaculture feeding UI."

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
            help=f"Delete ponds with codes starting {POND_CODE_PREFIX!r} and related demo rows, then re-seed.",
        )

    def handle(self, *args, **options):
        cid = _resolve_company_id(options["company_id"])
        if cid is None:
            raise CommandError("Company not found.")

        company = Company.objects.get(pk=cid)
        if not company.aquaculture_enabled or not company.aquaculture_licensed:
            company.aquaculture_enabled = True
            company.aquaculture_licensed = True
            company.save(update_fields=["aquaculture_enabled", "aquaculture_licensed", "updated_at"])
            self.stdout.write(self.style.NOTICE("Enabled aquaculture on company."))

        n_coa = ensure_aquaculture_chart_accounts(cid)
        if n_coa:
            self.stdout.write(f"  + Aquaculture COA lines added: {n_coa}")

        if options["force"]:
            _cleanup_demo(cid, self.stdout, self.style)
        elif AquacultureFeedingAdvice.objects.filter(
            company_id=cid,
            pond__code__startswith=POND_CODE_PREFIX,
        ).exists():
            self.stdout.write(
                self.style.WARNING(
                    f"Demo feeding data already present ({POND_CODE_PREFIX}* ponds). Use --force to replace."
                )
            )
            return

        feed_item = _ensure_feed_item(cid)
        today = date.today()
        d0 = today - timedelta(days=120)

        max_sort = AquaculturePond.objects.filter(company_id=cid).aggregate(m=Max("sort_order"))["m"] or 0
        base_order = int(max_sort) + 10

        ponds: list[AquaculturePond] = []
        cycles: list[AquacultureProductionCycle] = []

        with transaction.atomic():
            for idx, spec in enumerate(POND_SPECS):
                code, name, role, wdec, d_ft, fcount, wkg, avgw, _sack = spec
                if AquaculturePond.objects.filter(company_id=cid, code=code).exists():
                    raise CommandError(f"Pond code {code!r} already exists; use --force to reset demo.")
                p = AquaculturePond(
                    company_id=cid,
                    name=name,
                    code=code,
                    sort_order=base_order + idx * 10,
                    is_active=True,
                    pond_role=role,
                    water_area_decimal=wdec,
                    leasing_area_decimal=wdec + Decimal("0.1500"),
                    pond_depth_ft=d_ft,
                    notes=f"{DEMO_TAG} Demo grow-out / nursery context for feeding advice UI.",
                )
                p.save()
                err = maybe_provision_auto_pos_customer(company_id=cid, pond=p, skip_auto=True)
                if err:
                    raise CommandError(err)
                p.default_feed_item_id = feed_item.id
                p.save(update_fields=["default_feed_item", "updated_at"])
                ponds.append(p)

                cy_code = f"{POND_CODE_PREFIX}CY-{code.replace(POND_CODE_PREFIX, '')}"
                cy = AquacultureProductionCycle.objects.create(
                    company_id=cid,
                    pond=p,
                    name=f"Cycle {name.split()[0]} 2025–26",
                    code=cy_code,
                    start_date=d0 + timedelta(days=idx * 3),
                    end_date=None,
                    is_active=True,
                    notes=f"{DEMO_TAG} Production cycle for feeding demos.",
                )
                cycles.append(cy)

                AquacultureFishStockLedger.objects.create(
                    company_id=cid,
                    pond=p,
                    production_cycle=cy,
                    entry_date=today - timedelta(days=30),
                    entry_kind="adjustment",
                    loss_reason="",
                    fish_species="tilapia",
                    fish_count_delta=fcount,
                    weight_kg_delta=wkg,
                    book_value=Decimal("0"),
                    post_to_books=False,
                    memo=f"{DEMO_TAG} Opening reconcile from seine + cast-net estimate (demo).",
                )

                AquacultureBiomassSample.objects.create(
                    company_id=cid,
                    pond=p,
                    production_cycle=cy,
                    sample_date=today - timedelta(days=8),
                    estimated_fish_count=fcount,
                    estimated_total_weight_kg=wkg,
                    avg_weight_kg=avgw,
                    fish_species="tilapia",
                    notes=f"{DEMO_TAG} Weekly production sampling — length–weight subsample.",
                )

            # Recent feed purchases (pond A): shows in snapshot feeding_heuristic recent_direct_feed_kg_7d
            pa, cya = ponds[0], cycles[0]
            for i, (amt_kg, days_ago) in enumerate([(Decimal("120.0000"), 2), (Decimal("95.5000"), 5)], start=1):
                AquacultureExpense.objects.create(
                    company_id=cid,
                    pond=pa,
                    production_cycle=cya,
                    expense_category="feed_purchase",
                    expense_date=today - timedelta(days=days_ago),
                    amount=Decimal("95000.00") + Decimal(i * 5000),
                    memo=f"{DEMO_TAG} CP feed delivery #{i} (Khulna distributor).",
                    vendor_name="Quality Aqua Feed — Khulna",
                    feed_weight_kg=amt_kg,
                    feed_sack_count=Decimal("5") + i,
                )

            # Pond warehouse stock (sacks) on first two grow-out ponds for “consume on apply” demos
            for p in ponds[:2]:
                row, _ = ItemPondStock.objects.get_or_create(
                    company_id=cid,
                    pond_id=p.id,
                    item_id=feed_item.id,
                    defaults={"quantity": Decimal("0")},
                )
                ItemPondStock.objects.filter(pk=row.pk).update(quantity=Decimal("420"))
            refresh_item_quantity_on_hand(cid, feed_item.id)

        def _mark_snapshot(snap: dict) -> dict:
            snap = dict(snap or {})
            snap["feeding_ui_demo"] = True
            return snap

        scenarios: list[dict] = [
            {
                "pond_idx": 0,
                "target": today,
                "temp": Decimal("30"),
                "status": AquacultureFeedingAdvice.STATUS_PENDING_REVIEW,
                "sack": 25,
                "edited": "",
            },
            {
                "pond_idx": 1,
                "target": today - timedelta(days=1),
                "temp": Decimal("20"),
                "status": AquacultureFeedingAdvice.STATUS_PENDING_REVIEW,
                "sack": 20,
                "edited": (
                    "**Manager note:** Crew to split morning ration — **north wind** and slight algal tint after "
                    "yesterday's rain. If DO meter reads low after 10:00, skip the smallest meal._"
                ),
            },
            {
                "pond_idx": 2,
                "target": today - timedelta(days=2),
                "temp": Decimal("28"),
                "status": AquacultureFeedingAdvice.STATUS_APPROVED,
                "sack": 25,
                "edited": "",
            },
            {
                "pond_idx": 3,
                "target": today - timedelta(days=4),
                "temp": Decimal("27"),
                "status": AquacultureFeedingAdvice.STATUS_APPLIED,
                "sack": 10,
                "edited": "",
                "applied_kg_factor": Decimal("0.97"),
            },
            {
                "pond_idx": 0,
                "target": today - timedelta(days=7),
                "temp": None,
                "status": AquacultureFeedingAdvice.STATUS_APPLIED,
                "sack": 25,
                "edited": "",
                "applied_kg_factor": Decimal("1.0"),
            },
            {
                "pond_idx": 1,
                "target": today - timedelta(days=3),
                "temp": Decimal("22"),
                "status": AquacultureFeedingAdvice.STATUS_CANCELLED,
                "sack": 20,
                "edited": "",
            },
        ]

        for sc in scenarios:
            pi = sc["pond_idx"]
            pond = ponds[pi]
            cy = cycles[pi]
            td = sc["target"]
            payload, err = build_feeding_advice_payload(
                cid,
                pond.id,
                td,
                cy.id,
                water_temp_c=sc["temp"],
            )
            if err or not payload:
                raise CommandError(f"build_feeding_advice_payload failed for {pond.code}: {err}")

            snap = _mark_snapshot(payload["pond_status_snapshot"])
            sug = payload["suggested_feed_kg"]
            ai_text = payload["ai_advice_text"]
            edited = (sc.get("edited") or "").strip()

            a = AquacultureFeedingAdvice(
                company_id=cid,
                pond=pond,
                production_cycle=cy,
                target_date=td,
                status=sc["status"],
                pond_status_snapshot=snap,
                ai_advice_text=ai_text,
                edited_advice_text=edited,
                suggested_feed_kg=sug,
                sack_size_kg=sc["sack"],
            )

            if sc["status"] in (
                AquacultureFeedingAdvice.STATUS_APPROVED,
                AquacultureFeedingAdvice.STATUS_APPLIED,
            ):
                eff = effective_advice_text(ai_text, edited)
                a.approved_advice_text = eff
                a.approved_at = django_timezone.now() - timedelta(hours=6)

            if sc["status"] == AquacultureFeedingAdvice.STATUS_APPLIED:
                fac = sc.get("applied_kg_factor") or Decimal("1")
                base = sug if sug and sug > 0 else Decimal("50")
                a.applied_feed_kg = (base * fac).quantize(Decimal("0.01"))
                a.applied_at = django_timezone.now() - timedelta(hours=2)

            a.save()

        self.stdout.write(
            self.style.SUCCESS(
                f"Feeding UI demo seeded for company_id={cid}: {len(ponds)} ponds, {len(scenarios)} advice rows "
                f"(pending / approved / applied / cancelled). Default feed item id={feed_item.id}."
            )
        )
