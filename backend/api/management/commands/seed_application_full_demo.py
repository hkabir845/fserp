"""
One-shot sandbox data for pre-deployment testing: fuel station demo + HR samples +
aquaculture module + loans + optional draft AP bill.

Runs the existing professional Master demo (`seed_master_full_demo`), then layers:
  - Sample employees (same as `seed_master_employees --force`)
  - Company aquaculture license flags + aquaculture COA lines
  - Ponds (grow-out + nursery), production cycles, expenses (direct + shared),
    harvest sale, biomass sample, inter-pond transfer, fish stock ledger row
  - Draft term loan (borrowed) + lender counterparty
  - Optional draft vendor bill (shop line item)

Usage:
  cd backend
  python manage.py migrate
  python manage.py seed_application_full_demo

  # Same options as the fuel demo:
  python manage.py seed_application_full_demo --fresh --reset-demo-gl

  # Skip heavy sections:
  python manage.py seed_application_full_demo --skip-aquaculture --skip-loan
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q

from api.chart_templates.fuel_station import ensure_loan_module_default_accounts
from api.management.commands.seed_master_full_demo import resolve_master_company
from api.models import (
    AquacultureBiomassSample,
    AquacultureExpense,
    AquacultureExpensePondShare,
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquacultureFishSale,
    AquacultureFishStockLedger,
    AquaculturePond,
    AquacultureProductionCycle,
    Bill,
    BillLine,
    ChartOfAccount,
    Company,
    Item,
    Loan,
    LoanCounterparty,
    Station,
    Vendor,
)
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
from api.services.aquaculture_pond_pos_customer import maybe_provision_auto_pos_customer


# Idempotency: aquaculture block keyed by these pond codes.
POND_CODE_GROW = "APP-DEMO-GROW"
POND_CODE_NURSERY = "APP-DEMO-NURSERY"


class Command(BaseCommand):
    help = (
        "Seed Master Filling Station with full-stack demo data: fuel/GL (seed_master_full_demo), "
        "employees, aquaculture, demo loan, draft bill."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--fresh",
            action="store_true",
            help="Forward to seed_master_full_demo: replace Master COA, hardware, customers.",
        )
        parser.add_argument(
            "--reset-demo-gl",
            action="store_true",
            dest="reset_demo_gl",
            help="Forward to seed_master_full_demo: recreate DEMO-SEED-* journals.",
        )
        parser.add_argument(
            "--skip-employees",
            action="store_true",
            help="Do not run seed_master_employees --force.",
        )
        parser.add_argument(
            "--skip-aquaculture",
            action="store_true",
            help="Do not enable aquaculture or create pond/cycle/sample rows.",
        )
        parser.add_argument(
            "--skip-loan",
            action="store_true",
            help="Do not create demo loan counterparty + draft borrowed loan.",
        )
        parser.add_argument(
            "--skip-draft-bill",
            action="store_true",
            help="Do not create DEMO-BILL-SEED-1 draft vendor bill.",
        )

    def handle(self, *args, **options):
        fd_kw: dict = {}
        if options["fresh"]:
            fd_kw["fresh"] = True
        if options.get("reset_demo_gl"):
            fd_kw["reset_demo_gl"] = True

        self.stdout.write(self.style.NOTICE("==> Core ERP demo (chart, station, GL, customers, vendors, …)"))
        call_command("seed_master_full_demo", **fd_kw)

        master = resolve_master_company(self.stdout, self.style)
        cid = master.id

        if not options["skip_employees"]:
            self.stdout.write(self.style.NOTICE("==> Employees"))
            call_command("seed_master_employees", force=True)

        if not options["skip_aquaculture"]:
            self.stdout.write(self.style.NOTICE("==> Aquaculture module + sample pond data"))
            self._seed_aquaculture(master)

        if not options["skip_loan"]:
            self.stdout.write(self.style.NOTICE("==> Demo loan (draft, borrowed)"))
            self._seed_demo_loan(master)

        if not options["skip_draft_bill"]:
            self.stdout.write(self.style.NOTICE("==> Draft vendor bill (shop line)"))
            self._seed_draft_bill(master)

        self.stdout.write(
            self.style.SUCCESS(
                "\nApplication demo seed complete. Log in, select Master Filling Station, then test "
                "Fuel ops, Cashier, Reports, HR, Loans, Aquaculture, and Bills."
            )
        )

    def _coa(self, company_id: int, code: str) -> ChartOfAccount | None:
        return ChartOfAccount.objects.filter(
            company_id=company_id, account_code=code, is_active=True
        ).first()

    def _seed_aquaculture(self, master: Company) -> None:
        cid = master.id
        if AquaculturePond.objects.filter(company_id=cid, code=POND_CODE_GROW).exists():
            self.stdout.write(
                "  . Aquaculture demo ponds already present (codes APP-DEMO-*); skipping."
            )
            return

        master.aquaculture_licensed = True
        master.aquaculture_enabled = True
        master.save(update_fields=["aquaculture_licensed", "aquaculture_enabled", "updated_at"])

        n_coa = ensure_aquaculture_chart_accounts(cid)
        if n_coa:
            self.stdout.write(f"  + Aquaculture COA lines added: {n_coa}")

        station = Station.objects.filter(company_id=cid, station_name="Main Station").first()
        if not station:
            station = Station.objects.filter(company_id=cid, is_active=True).order_by("id").first()

        today = date.today()
        d_start = today - timedelta(days=120)

        with transaction.atomic():
            grow = AquaculturePond(
                company_id=cid,
                name="Demo Grow-out Pond",
                code=POND_CODE_GROW,
                sort_order=10,
                is_active=True,
                notes="Application demo seed — grow-out.",
                pond_size_decimal=Decimal("12.5000"),
                pond_role="grow_out",
            )
            grow.save()
            pe = maybe_provision_auto_pos_customer(company_id=cid, pond=grow, skip_auto=False)
            if pe:
                raise CommandError(f"Aquaculture POS customer: {pe}")
            grow.refresh_from_db()

            nursery = AquaculturePond(
                company_id=cid,
                name="Demo Nursery Pond",
                code=POND_CODE_NURSERY,
                sort_order=20,
                is_active=True,
                notes="Application demo seed — nursing.",
                pond_size_decimal=Decimal("4.2500"),
                pond_role="nursing",
            )
            nursery.save()
            pe = maybe_provision_auto_pos_customer(company_id=cid, pond=nursery, skip_auto=False)
            if pe:
                raise CommandError(f"Aquaculture POS customer: {pe}")
            nursery.refresh_from_db()

            if station:
                station.default_aquaculture_pond_id = grow.id
                station.save(update_fields=["default_aquaculture_pond"])
                self.stdout.write(f"  + Linked station {station.station_name!r} default pond -> grow-out.")

            cy_g = AquacultureProductionCycle(
                company_id=cid,
                pond=grow,
                name="Winter crop (demo)",
                code="APP-DEMO-CY-G1",
                start_date=d_start,
                end_date=None,
                is_active=True,
                notes="Open cycle for demo reporting.",
            )
            cy_g.save()

            cy_n = AquacultureProductionCycle(
                company_id=cid,
                pond=nursery,
                name="Fingerling batch (demo)",
                code="APP-DEMO-CY-N1",
                start_date=d_start,
                end_date=today - timedelta(days=30),
                is_active=True,
                notes="Closed nursery batch for transfer demo.",
            )
            cy_n.save()

            # Direct pond expenses (grow-out)
            AquacultureExpense.objects.create(
                company_id=cid,
                pond=grow,
                production_cycle=cy_g,
                expense_category="feed_purchase",
                expense_date=today - timedelta(days=14),
                amount=Decimal("185000.00"),
                memo="SEED: demo cash feed purchase",
                vendor_name="Local Feed Supplier",
                feed_sack_count=Decimal("74"),
                feed_weight_kg=Decimal("3700"),
            )
            AquacultureExpense.objects.create(
                company_id=cid,
                pond=grow,
                production_cycle=cy_g,
                expense_category="electricity",
                expense_date=today - timedelta(days=7),
                amount=Decimal("8200.50"),
                memo="SEED: aerator / pump power",
                vendor_name="PowerGrid",
            )

            # Shared electricity across ponds
            shared = AquacultureExpense.objects.create(
                company_id=cid,
                pond=None,
                production_cycle=None,
                expense_category="electricity",
                expense_date=today - timedelta(days=5),
                amount=Decimal("4500.00"),
                memo="SEED: shared site power",
                vendor_name="PowerGrid",
            )
            AquacultureExpensePondShare.objects.create(
                expense=shared, pond=grow, amount=Decimal("3000.00")
            )
            AquacultureExpensePondShare.objects.create(
                expense=shared, pond=nursery, amount=Decimal("1500.00")
            )

            # Harvest + secondary income line
            AquacultureFishSale.objects.create(
                company_id=cid,
                pond=grow,
                production_cycle=cy_g,
                income_type="fish_harvest_sale",
                fish_species="tilapia",
                sale_date=today - timedelta(days=3),
                weight_kg=Decimal("2850.5000"),
                fish_count=9500,
                total_amount=Decimal("712500.00"),
                buyer_name="Demo Wholesale Buyer",
                memo="SEED: main harvest",
            )
            AquacultureFishSale.objects.create(
                company_id=cid,
                pond=nursery,
                production_cycle=cy_n,
                income_type="fingerling_sale",
                fish_species="tilapia",
                sale_date=today - timedelta(days=45),
                weight_kg=Decimal("85.0000"),
                fish_count=17000,
                total_amount=Decimal("127500.00"),
                buyer_name="Neighbor Farm Co-op",
                memo="SEED: fingerling sale",
            )

            AquacultureBiomassSample.objects.create(
                company_id=cid,
                pond=grow,
                production_cycle=cy_g,
                sample_date=today - timedelta(days=10),
                estimated_fish_count=12000,
                estimated_total_weight_kg=Decimal("3600.0000"),
                avg_weight_kg=Decimal("0.300000"),
                fish_species="tilapia",
                notes="SEED: seine sample estimate",
            )

            xfer = AquacultureFishPondTransfer.objects.create(
                company_id=cid,
                from_pond=nursery,
                from_production_cycle=cy_n,
                transfer_date=today - timedelta(days=35),
                fish_species="tilapia",
                memo="SEED: stock fish to grow-out",
            )
            AquacultureFishPondTransferLine.objects.create(
                transfer=xfer,
                to_pond=grow,
                to_production_cycle=cy_g,
                weight_kg=Decimal("420.0000"),
                fish_count=28000,
                cost_amount=Decimal("185000.00"),
            )

            AquacultureFishStockLedger.objects.create(
                company_id=cid,
                pond=grow,
                production_cycle=cy_g,
                entry_date=today - timedelta(days=20),
                entry_kind="loss",
                loss_reason="mortality",
                fish_species="tilapia",
                fish_count_delta=-15,
                weight_kg_delta=Decimal("-12.5000"),
                book_value=Decimal("0"),
                post_to_books=False,
                memo="SEED: small mortality note (not posted to GL)",
            )

        self.stdout.write(self.style.SUCCESS("  + Aquaculture: 2 ponds, cycles, expenses, sales, sample, transfer, ledger."))

    def _seed_demo_loan(self, master: Company) -> None:
        cid = master.id
        if Loan.objects.filter(company_id=cid, loan_no="LOAN-DEMO-001").exists():
            self.stdout.write("  . Demo loan LOAN-DEMO-001 already exists.")
            return

        ensure_loan_module_default_accounts(cid)
        pa = self._coa(cid, "2410")
        sa = self._coa(cid, "1030")
        ia = self._coa(cid, "6620")
        if not pa or not sa:
            self.stdout.write(
                self.style.WARNING(
                    "  (skip loan — chart missing 2410 and/or 1030; run seed_master_full_demo first)"
                )
            )
            return

        stn = Station.objects.filter(company_id=cid, station_name="Main Station").first()
        cp, _ = LoanCounterparty.objects.get_or_create(
            company_id=cid,
            code="CP-LENDER-DEMO",
            defaults={
                "name": "Demo City Bank (working capital)",
                "role_type": "bank",
                "party_kind": LoanCounterparty.PARTY_LENDER,
                "is_active": True,
            },
        )

        Loan.objects.create(
            company_id=cid,
            loan_no="LOAN-DEMO-001",
            direction=Loan.DIRECTION_BORROWED,
            status="draft",
            counterparty_id=cp.id,
            station_id=stn.id if stn else None,
            title="Working capital term facility (demo)",
            principal_account_id=pa.id,
            settlement_account_id=sa.id,
            interest_account_id=ia.id if ia else None,
            interest_accrual_account_id=None,
            banking_model=Loan.BANKING_CONVENTIONAL,
            product_type=Loan.PRODUCT_TERM_LOAN,
            sanction_amount=Decimal("5000000.00"),
            outstanding_principal=Decimal("0"),
            total_disbursed=Decimal("0"),
            total_repaid_principal=Decimal("0"),
            start_date=date.today().replace(day=1),
            maturity_date=date.today().replace(year=date.today().year + 5, month=12, day=31),
            annual_interest_rate=Decimal("9.5000"),
            term_months=60,
            notes="Application demo seed — activate and disburse from Loans UI when ready.",
        )
        self.stdout.write("  + Draft loan LOAN-DEMO-001 (borrowed).")

    def _seed_draft_bill(self, master: Company) -> None:
        cid = master.id
        if Bill.objects.filter(company_id=cid, bill_number="DEMO-BILL-SEED-1").exists():
            self.stdout.write("  . Draft bill DEMO-BILL-SEED-1 already exists.")
            return

        vendor = Vendor.objects.filter(company_id=cid).order_by("id").first()
        item = (
            Item.objects.filter(company_id=cid)
            .filter(Q(pos_category="general") | Q(pos_category="service"))
            .exclude(pos_category="fuel")
            .order_by("id")
            .first()
        )
        if not vendor or not item:
            self.stdout.write(
                self.style.WARNING(
                    "  (skip draft bill — need at least one vendor and one general/service item)"
                )
            )
            return

        stn = Station.objects.filter(company_id=cid, station_name="Main Station").first()
        bd = date.today() - timedelta(days=2)
        with transaction.atomic():
            b = Bill(
                company_id=cid,
                vendor_id=vendor.id,
                receipt_station_id=stn.id if stn else None,
                bill_number="DEMO-BILL-SEED-1",
                bill_date=bd,
                due_date=bd + timedelta(days=14),
                vendor_reference="PO-DEMO-10492",
                memo="Application demo seed — draft only (not posted).",
                status="draft",
                subtotal=Decimal("12500.00"),
                tax_total=Decimal("1875.00"),
                total=Decimal("14375.00"),
            )
            b.save()
            BillLine.objects.create(
                bill=b,
                item_id=item.id,
                tank_id=None,
                description=f"{item.name} (demo line)",
                quantity=Decimal("50"),
                unit_price=Decimal("250.00"),
                amount=Decimal("12500.00"),
            )
        self.stdout.write(f"  + Draft bill DEMO-BILL-SEED-1 (vendor: {vendor.display_name or vendor.company_name}).")

