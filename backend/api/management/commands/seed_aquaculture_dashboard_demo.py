"""
Populate aquaculture module rows so the Operations dashboard shows realistic KPIs.

The frontend builds period ranges with Date.toISOString() (UTC calendar days). In timezones
ahead of UTC, "This month" often maps to roughly [local_month_start−1d, local_today−1d] in
ISO strings — so demo data tied only to a few recent server-calendar days can miss the
window. This command spreads feed, sales, samples, shared opex, and payroll across the
last ~45 days and places key rows on month boundaries.

Idempotent: skips if demo marker already exists. Use --force to remove prior demo rows
and re-seed.

Example:
  python manage.py seed_aquaculture_dashboard_demo
  python manage.py seed_aquaculture_dashboard_demo --company-id 1 --force
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import (
    AquacultureBiomassSample,
    AquacultureExpense,
    AquacultureExpensePondShare,
    AquacultureFishSale,
    AquacultureFishStockLedger,
    AquaculturePond,
    AquacultureProductionCycle,
    Company,
    PayrollRun,
    PayrollRunPondAllocation,
)
from api.services.aquaculture_biomass_sample_service import apply_aquaculture_biomass_sample_extrapolation
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
from api.services.aquaculture_stock_ledger_reconcile_service import (
    OPENING_DEMO_MEMO_TAG,
    opening_stock_for_pond,
)

DEMO_TAG = "[DASHBOARD-DEMO]"
PAYROLL_NO = "DASH-DEMO-001"


def _month_floor(d: date) -> date:
    return d.replace(day=1)


def _iso_window_dates(today: date) -> list[date]:
    """Approximate UTC ISO endpoints used by the aquaculture dashboard for local 'this month'."""
    start_local = _month_floor(today)
    out: list[date] = []
    d = start_local - timedelta(days=1)
    while d <= today:
        out.append(d)
        d += timedelta(days=1)
    return out


class Command(BaseCommand):
    help = "Seed aquaculture expenses, sales, biomass samples, shared opex, and payroll for dashboard KPIs."

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
            help=f"Delete rows tagged {DEMO_TAG!r} / payroll {PAYROLL_NO!r} for this company, then re-seed.",
        )

    def handle(self, *args, **options):
        cid = options["company_id"]
        if cid is None:
            c = Company.objects.filter(is_deleted=False, aquaculture_enabled=True).order_by("id").first()
            if not c:
                c = Company.objects.filter(is_deleted=False).order_by("id").first()
            if not c:
                self.stdout.write(self.style.ERROR("No company found."))
                return
            cid = c.id
        else:
            if not Company.objects.filter(pk=cid, is_deleted=False).exists():
                self.stdout.write(self.style.ERROR(f"Company id={cid} not found."))
                return

        company = Company.objects.get(pk=cid)
        if not company.aquaculture_enabled or not company.aquaculture_licensed:
            company.aquaculture_enabled = True
            company.aquaculture_licensed = True
            company.save(update_fields=["aquaculture_enabled", "aquaculture_licensed", "updated_at"])
            self.stdout.write(self.style.NOTICE("Enabled aquaculture flags on company."))

        n_coa = ensure_aquaculture_chart_accounts(cid)
        if n_coa:
            self.stdout.write(self.style.NOTICE(f"Aquaculture COA lines added: {n_coa}"))

        if options["force"]:
            self._purge_demo(cid)
        elif self._demo_exists(cid):
            self.stdout.write(
                self.style.WARNING(
                    f"Demo data already present (tag {DEMO_TAG}). Use --force to replace."
                )
            )
            return

        ponds = list(
            AquaculturePond.objects.filter(company_id=cid, is_active=True).order_by("sort_order", "id")
        )
        if not ponds:
            self.stdout.write(
                self.style.ERROR("No active aquaculture ponds. Create ponds first (e.g. seed_aquaculture_named_ponds).")
            )
            return

        today = date.today()
        window = _iso_window_dates(today)
        long_span = [today - timedelta(days=i) for i in range(0, 46)]

        with transaction.atomic():
            cycles: dict[int, AquacultureProductionCycle] = {}
            for p in ponds:
                code = f"DASH-DEMO-CY-{p.id}"
                cy, _ = AquacultureProductionCycle.objects.get_or_create(
                    company_id=cid,
                    pond=p,
                    code=code,
                    defaults={
                        "name": f"Demo crop ({p.name})",
                        "start_date": today - timedelta(days=120),
                        "end_date": None,
                        "is_active": True,
                        "notes": f"{DEMO_TAG} Synthetic open cycle for reporting.",
                    },
                )
                cycles[p.id] = cy

            for p in ponds:
                cy = cycles[p.id]
                if AquacultureFishStockLedger.objects.filter(
                    company_id=cid,
                    pond_id=p.id,
                    production_cycle_id=cy.id,
                    memo__contains=OPENING_DEMO_MEMO_TAG,
                ).exists():
                    continue
                opening = opening_stock_for_pond(cid, p, cy.id)
                if not opening:
                    continue
                fc, wkg = opening
                AquacultureFishStockLedger.objects.create(
                    company_id=cid,
                    pond=p,
                    production_cycle=cy,
                    entry_date=cy.start_date or (today - timedelta(days=90)),
                    entry_kind="adjustment",
                    loss_reason="",
                    fish_species="tilapia",
                    fish_count_delta=fc,
                    weight_kg_delta=wkg,
                    book_value=Decimal("0"),
                    post_to_books=False,
                    memo=(
                        f"{DEMO_TAG} {OPENING_DEMO_MEMO_TAG} Opening fry/stocking reconcile for "
                        f"{cy.name} — demo only, not posted to GL."
                    ),
                )

            # --- Feed with kg (spread across long span + extra on ISO window days)
            feed_days = sorted(
                set(long_span[::4] + window[::2] + [today, today - timedelta(days=1), today - timedelta(days=2)])
            )
            total_feed_kg = Decimal("0")
            for i, d in enumerate(feed_days[:18]):
                p = ponds[i % len(ponds)]
                cy = cycles[p.id]
                kg = Decimal("120") + Decimal(str((i % 5) * 35))
                amt = kg * Decimal("52.5")
                AquacultureExpense.objects.create(
                    company_id=cid,
                    pond=p,
                    production_cycle=cy,
                    expense_category="feed_purchase",
                    expense_date=d,
                    amount=amt.quantize(Decimal("0.01")),
                    memo=f"{DEMO_TAG} Floating feed — batch {i + 1}",
                    vendor_name="Premium Feed Mills",
                    feed_sack_count=(kg / Decimal("50")).quantize(Decimal("0.01")),
                    feed_weight_kg=kg,
                )
                total_feed_kg += kg

            # Extra feed on each ISO-window day so "This month" (UTC-shifted) shows plausible FCR vs harvest.
            for wi, d in enumerate(window):
                p = ponds[wi % len(ponds)]
                cy = cycles[p.id]
                # ~0.6–0.7 t per pond-day equivalent, rotated — yields plausible FCR vs partial harvests.
                kg = Decimal("620") + Decimal(wi % 3) * Decimal("18")
                amt = kg * Decimal("52.5")
                AquacultureExpense.objects.create(
                    company_id=cid,
                    pond=p,
                    production_cycle=cy,
                    expense_category="feed_purchase",
                    expense_date=d,
                    amount=amt.quantize(Decimal("0.01")),
                    memo=f"{DEMO_TAG} Daily ration (dashboard window)",
                    vendor_name="Premium Feed Mills",
                    feed_sack_count=(kg / Decimal("50")).quantize(Decimal("0.01")),
                    feed_weight_kg=kg,
                )
                total_feed_kg += kg

            # --- Purchase-like opex (medicine, fry, equipment)
            purchase_like = [
                ("medicine_purchase", Decimal("18500.00"), "Oxy-Med + probiotic"),
                ("fry_stocking", Decimal("420000.00"), "Tilapia fry — spring stocking"),
                ("equipment", Decimal("67500.00"), "Aerator service + spare impeller"),
                ("medicine_purchase", Decimal("9200.00"), "Salt + formalin protocol"),
            ]
            for idx, (cat, amt, memo) in enumerate(purchase_like):
                d = long_span[3 + idx * 7]
                p = ponds[(idx + 1) % len(ponds)]
                AquacultureExpense.objects.create(
                    company_id=cid,
                    pond=p,
                    production_cycle=cycles[p.id],
                    expense_category=cat,
                    expense_date=d,
                    amount=amt,
                    memo=f"{DEMO_TAG} {memo}",
                    vendor_name="Aquatech Suppliers",
                )

            # --- Direct electricity / transport (operating mix)
            for idx, p in enumerate(ponds[: min(6, len(ponds))]):
                AquacultureExpense.objects.create(
                    company_id=cid,
                    pond=p,
                    production_cycle=cycles[p.id],
                    expense_category="electricity",
                    expense_date=long_span[5 + idx],
                    amount=Decimal("4500.00") + Decimal(idx * 180),
                    memo=f"{DEMO_TAG} Aerator / pump meter",
                    vendor_name="PowerGrid",
                )

            # --- Shared electricity split across ponds
            share_total = Decimal("28000.00")
            shared = AquacultureExpense.objects.create(
                company_id=cid,
                pond=None,
                production_cycle=None,
                expense_category="electricity",
                expense_date=window[len(window) // 2] if window else today,
                amount=share_total,
                memo=f"{DEMO_TAG} Site generator diesel + yard lighting",
                vendor_name="Rural Power Co-op",
            )
            n_share = min(len(ponds), 6)
            base = (share_total / Decimal(n_share)).quantize(Decimal("0.01"))
            running = Decimal("0")
            for i, p in enumerate(ponds[:n_share]):
                slice_amt = base if i < n_share - 1 else (share_total - running).quantize(Decimal("0.01"))
                running += slice_amt
                AquacultureExpensePondShare.objects.create(expense=shared, pond=p, amount=slice_amt)

            # --- Harvest sales (fish_harvest_sale) on recent ISO window days
            harvest_days = [window[-1], window[-3], window[-5]] if len(window) >= 5 else [today - timedelta(days=1)]
            harvest_days = [d for d in harvest_days if d <= today][-3:]
            if not harvest_days:
                harvest_days = [today - timedelta(days=1)]

            species_rot = ["tilapia", "tilapia", "rohu"]
            for hi, d in enumerate(harvest_days):
                p = ponds[hi % len(ponds)]
                w_kg = Decimal("1850.0000") + Decimal(hi * 220)
                price_per_kg = Decimal("248.50")
                AquacultureFishSale.objects.create(
                    company_id=cid,
                    pond=p,
                    production_cycle=cycles[p.id],
                    income_type="fish_harvest_sale",
                    fish_species=species_rot[hi % len(species_rot)],
                    sale_date=d,
                    weight_kg=w_kg,
                    fish_count=6000 + hi * 800,
                    total_amount=(w_kg * price_per_kg).quantize(Decimal("0.01")),
                    buyer_name="Dhaka Wholesale Fish Market",
                    memo=f"{DEMO_TAG} Partial harvest — live haul",
                )

            if len(ponds) >= 2:
                p2 = ponds[1]
                AquacultureFishSale.objects.create(
                    company_id=cid,
                    pond=p2,
                    production_cycle=cycles[p2.id],
                    income_type="fingerling_sale",
                    fish_species="tilapia",
                    sale_date=long_span[12],
                    weight_kg=Decimal("95.0000"),
                    fish_count=19000,
                    total_amount=Decimal("142500.00"),
                    buyer_name="Neighbor cooperative",
                    memo=f"{DEMO_TAG} Fingerling surplus",
                )

            # --- Biomass: two samples per pond (early / late in window) for growth FCR
            early_d = window[2] if len(window) > 2 else today - timedelta(days=8)
            late_d = window[-2] if len(window) > 2 else today - timedelta(days=2)
            if early_d >= late_d:
                early_d, late_d = today - timedelta(days=10), today - timedelta(days=2)

            for p in ponds:
                cy = cycles[p.id]
                base_kg = Decimal("2100") + Decimal(p.id % 7) * Decimal("120")
                for sample_date, est_fc, est_kg, avg_kg, note_suffix in (
                    (
                        early_d,
                        8000 + (p.id % 5) * 400,
                        base_kg,
                        (base_kg / Decimal("8000")).quantize(Decimal("0.000001")),
                        "early",
                    ),
                    (
                        late_d,
                        9000 + (p.id % 5) * 350,
                        base_kg + Decimal("480") + Decimal(p.id % 4) * Decimal("40"),
                        Decimal("0.350000"),
                        "late",
                    ),
                ):
                    sample = AquacultureBiomassSample(
                        company_id=cid,
                        pond=p,
                        production_cycle=cy,
                        sample_date=sample_date,
                        estimated_fish_count=est_fc,
                        estimated_total_weight_kg=est_kg,
                        avg_weight_kg=avg_kg,
                        fish_species="tilapia",
                        notes=f"{DEMO_TAG} Seine / cast-net estimate ({note_suffix})",
                    )
                    apply_aquaculture_biomass_sample_extrapolation(sample)
                    sample.save()

            # --- Payroll allocation (drives total_costs / net profit)
            pay_end = today - timedelta(days=1) if today.day > 1 else today
            pay_start = _month_floor(pay_end)
            net = Decimal("72500.00")
            pr, _ = PayrollRun.objects.get_or_create(
                company_id=cid,
                payroll_number=PAYROLL_NO,
                defaults={
                    "pay_period_start": pay_start,
                    "pay_period_end": pay_end,
                    "payment_date": pay_end,
                    "total_gross": Decimal("78000.00"),
                    "total_deductions": Decimal("5500.00"),
                    "total_net": net,
                    "status": "draft",
                    "notes": f"{DEMO_TAG} Pond labour allocation demo.",
                },
            )
            if PayrollRunPondAllocation.objects.filter(payroll_run=pr).exists():
                pass
            else:
                alloc_ponds = ponds[: min(4, len(ponds))]
                weights = [Decimal("0.35"), Decimal("0.30"), Decimal("0.22"), Decimal("0.13")]
                allocated = Decimal("0")
                for i, ap in enumerate(alloc_ponds):
                    if i == len(alloc_ponds) - 1:
                        amt = (net - allocated).quantize(Decimal("0.01"))
                    else:
                        amt = (net * weights[i]).quantize(Decimal("0.01"))
                        allocated += amt
                    PayrollRunPondAllocation.objects.create(payroll_run=pr, pond=ap, amount=amt)

        self.stdout.write(
            self.style.SUCCESS(
                f"Aquaculture dashboard demo seeded for company_id={cid} "
                f"({len(ponds)} ponds). ~{total_feed_kg} kg feed in period spread; "
                f"reload the aquaculture dashboard."
            )
        )

    def _demo_exists(self, company_id: int) -> bool:
        if AquacultureExpense.objects.filter(company_id=company_id, memo__contains=DEMO_TAG).exists():
            return True
        if AquacultureFishSale.objects.filter(company_id=company_id, memo__contains=DEMO_TAG).exists():
            return True
        if AquacultureBiomassSample.objects.filter(company_id=company_id, notes__contains=DEMO_TAG).exists():
            return True
        if PayrollRun.objects.filter(company_id=company_id, payroll_number=PAYROLL_NO).exists():
            return True
        return False

    def _purge_demo(self, company_id: int) -> None:
        AquacultureFishSale.objects.filter(company_id=company_id, memo__contains=DEMO_TAG).delete()
        AquacultureBiomassSample.objects.filter(company_id=company_id, notes__contains=DEMO_TAG).delete()
        demo_exp_ids = list(
            AquacultureExpense.objects.filter(company_id=company_id, memo__contains=DEMO_TAG).values_list(
                "id", flat=True
            )
        )
        AquacultureExpensePondShare.objects.filter(expense_id__in=demo_exp_ids).delete()
        AquacultureExpense.objects.filter(id__in=demo_exp_ids).delete()
        PayrollRun.objects.filter(company_id=company_id, payroll_number=PAYROLL_NO).delete()
        AquacultureProductionCycle.objects.filter(company_id=company_id, code__startswith="DASH-DEMO-CY-").delete()
        self.stdout.write(self.style.NOTICE("Removed prior dashboard demo rows."))
