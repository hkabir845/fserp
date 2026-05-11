"""
Add idempotent bulk example rows (≥5 each) for Master Filling Station: aquaculture ponds,
cycles, expenses, biomass samples, fish sales, stock ledger, feeding advice, extra vendors,
draft bills (some with pond-tagged lines), and draft loans.

Safe to re-run: skips rows that already exist (stable codes / memo prefixes).

Prerequisite (recommended): ``python manage.py seed_application_full_demo`` so COA, items,
vendors, and stations exist.

Usage:
  cd backend
  python manage.py seed_master_example_bulk
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Max, Q

from api.chart_templates.fuel_station import ensure_loan_module_default_accounts
from api.management.commands.seed_master_full_demo import resolve_master_company
from api.models import (
    AquacultureBiomassSample,
    AquacultureExpense,
    AquacultureFeedingAdvice,
    AquacultureFishSale,
    AquacultureFishStockLedger,
    AquaculturePond,
    AquacultureProductionCycle,
    Bill,
    BillLine,
    ChartOfAccount,
    Item,
    Loan,
    LoanCounterparty,
    Station,
    Vendor,
)
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
from api.services.aquaculture_pond_pos_customer import maybe_provision_auto_pos_customer

POND_CODES = tuple(f"BULK-DEMO-P{i}" for i in range(1, 6))
EXP_MEMO_PREFIX = "BULK-DEMO-EXP-"
VENDOR_CODE_PREFIX = "BULK-VEND-"
BILL_NUM_PREFIX = "BULK-DEMO-BILL-"
LOAN_NO_PREFIX = "BULK-LOAN-"


class Command(BaseCommand):
    help = "Seed Master Filling Station with ≥5 example rows per major aquaculture/AP/loan category (idempotent)."

    def handle(self, *args, **options):
        master = resolve_master_company(self.stdout, self.style)
        cid = master.id
        master.aquaculture_licensed = True
        master.aquaculture_enabled = True
        master.save(update_fields=["aquaculture_licensed", "aquaculture_enabled", "updated_at"])

        n_coa = ensure_aquaculture_chart_accounts(cid)
        if n_coa:
            self.stdout.write(f"  + Aquaculture COA lines added: {n_coa}")

        station = Station.objects.filter(company_id=cid, is_active=True).order_by("id").first()
        today = date.today()
        d0 = today - timedelta(days=90)

        ponds: list[AquaculturePond] = []
        sort_base = AquaculturePond.objects.filter(company_id=cid).aggregate(m=Max("sort_order"))["m"] or 0

        for idx, code in enumerate(POND_CODES, start=1):
            p = AquaculturePond.objects.filter(company_id=cid, code=code).first()
            if not p:
                with transaction.atomic():
                    p = AquaculturePond(
                        company_id=cid,
                        name=f"Bulk Demo Pond {idx}",
                        code=code,
                        sort_order=int(sort_base) + idx * 10,
                        is_active=True,
                        notes=f"Bulk demo seed (≥5 examples) — {code}.",
                        leasing_area_decimal=Decimal("10.0000") + Decimal(idx),
                        water_area_decimal=Decimal("9.5000") + Decimal(idx) * Decimal("0.1"),
                        pond_depth_ft=Decimal("4.500") + Decimal(idx) * Decimal("0.1"),
                        pond_role="grow_out" if idx % 2 == 1 else "nursing",
                    )
                    p.save()
                    err = maybe_provision_auto_pos_customer(company_id=cid, pond=p, skip_auto=False)
                    if err:
                        raise CommandError(err)
                    p.refresh_from_db()
                self.stdout.write(self.style.SUCCESS(f"  + Pond {code}"))
            ponds.append(p)

        cycles: list[AquacultureProductionCycle] = []
        for idx, pond in enumerate(ponds):
            cy_code = f"BULK-DEMO-CY-{pond.code}"
            cy = AquacultureProductionCycle.objects.filter(company_id=cid, code=cy_code).first()
            if not cy:
                cy = AquacultureProductionCycle.objects.create(
                    company_id=cid,
                    pond=pond,
                    name=f"Bulk cycle {idx + 1}",
                    code=cy_code,
                    start_date=d0 + timedelta(days=idx * 5),
                    end_date=None if idx < 3 else today - timedelta(days=10 - idx),
                    is_active=True,
                    notes="Bulk demo production cycle.",
                )
                self.stdout.write(self.style.SUCCESS(f"  + Cycle {cy_code}"))
            cycles.append(cy)

        cats = (
            "feed_purchase",
            "electricity",
            "medicine_purchase",
            "equipment",
            "transportation",
        )
        grow = ponds[0]
        cy0 = cycles[0]
        for i, cat in enumerate(cats, start=1):
            memo = f"{EXP_MEMO_PREFIX}{i:02d} {cat}"
            if AquacultureExpense.objects.filter(company_id=cid, memo=memo).exists():
                continue
            AquacultureExpense.objects.create(
                company_id=cid,
                pond=grow,
                production_cycle=cy0,
                expense_category=cat,
                expense_date=today - timedelta(days=20 - i),
                amount=Decimal("5000.00") * i,
                memo=memo,
                vendor_name=f"Bulk Vendor Ref {i}",
                feed_weight_kg=Decimal("100") * i if cat == "feed_purchase" else None,
                feed_sack_count=Decimal("4") * i if cat == "feed_purchase" else None,
            )
            self.stdout.write(f"  + Expense {memo}")

        for i, pond in enumerate(ponds, start=1):
            memo = f"BULK-DEMO-SAMPLE-{i:02d}"
            sample_note = f"{memo} seine estimate"
            if AquacultureBiomassSample.objects.filter(company_id=cid, pond=pond, notes=sample_note).exists():
                continue
            AquacultureBiomassSample.objects.create(
                company_id=cid,
                pond=pond,
                production_cycle=cycles[i - 1],
                sample_date=today - timedelta(days=15 + i),
                estimated_fish_count=5000 + i * 200,
                estimated_total_weight_kg=Decimal("1500.0000") + Decimal(i * 50),
                avg_weight_kg=Decimal("0.280000") + Decimal(i) * Decimal("0.001"),
                fish_species="tilapia",
                notes=sample_note,
            )
            self.stdout.write(f"  + Biomass {memo}")

        inc_types = (
            "fish_harvest_sale",
            "fingerling_sale",
            "processing_value_add",
            "empty_feed_sack_sale",
            "other_income",
        )
        for i, itype in enumerate(inc_types, start=1):
            memo = f"BULK-DEMO-SALE-{i:02d}"
            if AquacultureFishSale.objects.filter(company_id=cid, memo=memo).exists():
                continue
            pond = ponds[(i - 1) % len(ponds)]
            cyc = cycles[(i - 1) % len(cycles)]
            AquacultureFishSale.objects.create(
                company_id=cid,
                pond=pond,
                production_cycle=cyc,
                income_type=itype,
                fish_species="tilapia",
                sale_date=today - timedelta(days=12 + i),
                weight_kg=Decimal("120.0000") + Decimal(i * 15),
                fish_count=800 + i * 50,
                total_amount=Decimal("45000.00") + Decimal(i * 5000),
                buyer_name=f"Bulk Buyer {i}",
                memo=memo,
            )
            self.stdout.write(f"  + Sale {memo}")

        kinds = ("loss", "loss", "adjustment", "adjustment", "loss")
        for i, ek in enumerate(kinds, start=1):
            memo = f"BULK-DEMO-LEDGER-{i:02d}"
            if AquacultureFishStockLedger.objects.filter(company_id=cid, memo=memo).exists():
                continue
            AquacultureFishStockLedger.objects.create(
                company_id=cid,
                pond=ponds[i % len(ponds)],
                production_cycle=cycles[i % len(cycles)],
                entry_date=today - timedelta(days=8 + i),
                entry_kind=ek,
                loss_reason="mortality" if ek == "loss" else "",
                fish_species="tilapia",
                fish_count_delta=-5 * i if ek == "loss" else 2,
                weight_kg_delta=Decimal("-2.5") * i if ek == "loss" else Decimal("1.0"),
                book_value=Decimal("0"),
                post_to_books=False,
                memo=memo,
            )
            self.stdout.write(f"  + Fish ledger {memo}")

        for i in range(1, 6):
            ref = f"BULK-DEMO-FA-{i:02d}"
            if AquacultureFeedingAdvice.objects.filter(company_id=cid, ai_advice_text__startswith=ref).exists():
                continue
            pi = (i - 1) % len(ponds)
            AquacultureFeedingAdvice.objects.create(
                company_id=cid,
                pond=ponds[pi],
                production_cycle=cycles[pi],
                target_date=today - timedelta(days=5 + i),
                status=AquacultureFeedingAdvice.STATUS_PENDING_REVIEW,
                pond_status_snapshot={"bulk_demo": True, "ref": ref},
                ai_advice_text=f"{ref} Example feeding plan text for UI lists.",
                suggested_feed_kg=Decimal("95") + Decimal(i * 3),
                sack_size_kg=25,
            )
            self.stdout.write(f"  + Feeding advice {ref}")

        v_count = Vendor.objects.filter(company_id=cid, is_active=True).count()
        to_add_v = max(0, 5 - v_count)
        for j in range(1, to_add_v + 1):
            code = f"{VENDOR_CODE_PREFIX}{j:02d}"
            if Vendor.objects.filter(company_id=cid, vendor_number=code).exists():
                continue
            Vendor.objects.create(
                company_id=cid,
                vendor_number=code,
                company_name=f"Bulk Example Supplier {j} Ltd",
                display_name=f"Bulk Supplier {j}",
                contact_person="AP Desk",
                email=f"bulk-vend-{j}@demo.local",
                phone=f"+880-2-9000{j:03d}",
                billing_address_line1=f"Demo Industrial Block {j}, Dhaka",
                default_station_id=station.id if station else None,
            )
            self.stdout.write(f"  + Vendor {code}")

        item = (
            Item.objects.filter(company_id=cid)
            .filter(Q(pos_category="general") | Q(pos_category="feed"))
            .exclude(pos_category="fuel")
            .order_by("id")
            .first()
        )
        vendors_qs = Vendor.objects.filter(company_id=cid, is_active=True).order_by("id")
        if item and vendors_qs.exists():
            for i in range(1, 6):
                bnum = f"{BILL_NUM_PREFIX}{i:02d}"
                if Bill.objects.filter(company_id=cid, bill_number=bnum).exists():
                    continue
                v = vendors_qs[(i - 1) % vendors_qs.count()]
                line_amt = Decimal("5000.00") + Decimal(i * 1000)
                tax = (line_amt * Decimal("0.15")).quantize(Decimal("0.01"))
                total = line_amt + tax
                bd = today - timedelta(days=3 + i)
                with transaction.atomic():
                    b = Bill.objects.create(
                        company_id=cid,
                        vendor_id=v.id,
                        receipt_station_id=station.id if station else None,
                        bill_number=bnum,
                        bill_date=bd,
                        due_date=bd + timedelta(days=21),
                        vendor_reference=f"BULK-PO-{i:04d}",
                        memo="Bulk demo draft bill (not posted).",
                        status="draft",
                        subtotal=line_amt,
                        tax_total=tax,
                        total=total,
                    )
                    pond_kw = {}
                    if i <= 3 and ponds:
                        pond_kw = {
                            "aquaculture_pond_id": ponds[i - 1].id,
                            "aquaculture_production_cycle_id": cycles[i - 1].id,
                            "aquaculture_cost_bucket": "equipment" if i == 2 else "feed",
                        }
                    BillLine.objects.create(
                        bill=b,
                        item_id=item.id,
                        description=f"{item.name} (bulk demo line {i})",
                        quantity=Decimal("10") + Decimal(i),
                        unit_price=Decimal("400.00") + Decimal(i * 10),
                        amount=line_amt,
                        **pond_kw,
                    )
                self.stdout.write(f"  + Draft bill {bnum}")

        pa = ChartOfAccount.objects.filter(company_id=cid, account_code="2410", is_active=True).first()
        sa = ChartOfAccount.objects.filter(company_id=cid, account_code="1030", is_active=True).first()
        ia = ChartOfAccount.objects.filter(company_id=cid, account_code="6620", is_active=True).first()
        if pa and sa:
            ensure_loan_module_default_accounts(cid)
            cp, _ = LoanCounterparty.objects.get_or_create(
                company_id=cid,
                code="BULK-LENDER-CP",
                defaults={
                    "name": "Bulk Demo Finance Ltd",
                    "role_type": "bank",
                    "party_kind": LoanCounterparty.PARTY_LENDER,
                    "is_active": True,
                },
            )
            stn = Station.objects.filter(company_id=cid, station_name="Main Station").first() or station
            for i in range(1, 6):
                lno = f"{LOAN_NO_PREFIX}{i:02d}"
                if Loan.objects.filter(company_id=cid, loan_no=lno).exists():
                    continue
                Loan.objects.create(
                    company_id=cid,
                    loan_no=lno,
                    direction=Loan.DIRECTION_BORROWED,
                    status="draft",
                    counterparty_id=cp.id,
                    station_id=stn.id if stn else None,
                    title=f"Bulk demo facility {i}",
                    principal_account_id=pa.id,
                    settlement_account_id=sa.id,
                    interest_account_id=ia.id if ia else None,
                    banking_model=Loan.BANKING_CONVENTIONAL,
                    product_type=Loan.PRODUCT_TERM_LOAN,
                    sanction_amount=Decimal("250000.00") * i,
                    outstanding_principal=Decimal("0"),
                    total_disbursed=Decimal("0"),
                    total_repaid_principal=Decimal("0"),
                    start_date=today.replace(day=1),
                    maturity_date=today.replace(year=today.year + 3, month=12, day=31),
                    annual_interest_rate=Decimal("10.0000"),
                    term_months=36,
                    notes="Bulk demo seed — draft loan.",
                )
                self.stdout.write(f"  + Draft loan {lno}")
        else:
            self.stdout.write(self.style.WARNING("  (skip bulk loans — COA 2410/1030 missing; run seed_master_full_demo)"))

        self.stdout.write(
            self.style.SUCCESS(
                "\nBulk example seed done for Master Filling Station. "
                "Aquaculture: 5 ponds, 5 cycles, 5 expenses, 5 samples, 5 sales, 5 ledger rows, 5 feeding advices; "
                "up to 5 extra vendors; 5 draft bills; 5 draft loans (when COA allows)."
            )
        )
