"""
Load professional demo data for Master Filling Station (one command).

Runs chart of accounts, fuel island/nozzle graph, shop items, customers, then adds
vendors, VAT, bank accounts, posted demo GL (opening + sample sales/COGS/OPEX so
Reports → P&L shows clear net profit), shift templates, and a sample tank dip where missing.

Re-run the command to add any new demo journal types that did not exist yet (each
entry_number is created once). Use --reset-demo-gl to delete all DEMO-SEED-* journals
and recreate them (fixes stale amounts / ensures DEMO-SEED-PROFIT-ANCHOR exists).

Prerequisite: company named "Master Filling Station" (or one flagged is_master=true).

Usage:
  cd backend
  python manage.py seed_master_full_demo
  python manage.py seed_master_full_demo --fresh   # wipe & reseed Master COA, hardware, customers
"""
from __future__ import annotations

from datetime import date, time
from decimal import Decimal

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

from api.models import (
    BankAccount,
    ChartOfAccount,
    Company,
    JournalEntry,
    ShiftTemplate,
    Tank,
    TankDip,
    Tax,
    TaxRate,
    Vendor,
)
from api.services.gl_posting import _create_posted_entry


SAMPLE_VENDORS = [
    {
        "company_name": "Bangladesh Petroleum Logistics Ltd",
        "display_name": "BPL Logistics",
        "contact_person": "Procurement Desk",
        "email": "procurement@bpl-demo.local",
        "phone": "+880-2-5500100",
        "billing_address_line1": "Tejgaon Industrial Area, Dhaka",
    },
    {
        "company_name": "National Lubricants Distributors",
        "display_name": "National Lubricants",
        "contact_person": "Sales",
        "email": "sales@natlube-demo.local",
        "phone": "+880-171-1002000",
        "billing_address_line1": "Motijheel C/A, Dhaka",
    },
    {
        "company_name": "City C-Store Wholesale",
        "display_name": "City Wholesale",
        "contact_person": "Warehouse",
        "email": "orders@citywholesale-demo.local",
        "phone": "+880-181-2003000",
        "billing_address_line1": "Ashulia, Gazipur",
    },
    {
        "company_name": "PowerGrid Utilities Co.",
        "display_name": "PowerGrid",
        "contact_person": "Accounts",
        "email": "ap@powergrid-demo.local",
        "phone": "+880-2-9334400",
        "billing_address_line1": "WASA Road, Dhaka",
    },
]


def resolve_master_company(stdout, style) -> Company:
    master = Company.objects.filter(
        name__iexact="Master Filling Station", is_deleted=False
    ).first()
    if not master:
        master = Company.objects.filter(is_master="true", is_deleted=False).first()
    if not master:
        raise CommandError(
            'No "Master Filling Station" company found. Create it in Admin → Companies '
            "(SaaS Dashboard), then run this command again."
        )
    if master.name.strip().lower() != "master filling station":
        stdout.write(
            style.WARNING(
                f'Using company id={master.id} name={master.name!r} (not exact "Master Filling Station"). '
                "Consider renaming for consistency with other seed commands."
            )
        )
    if master.is_master != "true":
        master.is_master = "true"
        master.save(update_fields=["is_master"])
        stdout.write(style.SUCCESS("Set is_master=true on selected company."))
    return master


class Command(BaseCommand):
    help = "Seed Master Filling Station with full demo data (accounting, fuel ops, AR/AP, shifts)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--fresh",
            action="store_true",
            help="Replace Master chart, fuel hardware tree, and customers, then re-run extensions.",
        )
        parser.add_argument(
            "--reset-demo-gl",
            action="store_true",
            help="Delete all DEMO-SEED-* posted journals for Master company, then recreate demo P&L sample.",
        )

    def handle(self, *args, **options):
        fresh = options["fresh"]
        reset_demo_gl = options["reset_demo_gl"]
        master = resolve_master_company(self.stdout, self.style)
        cid = master.id
        self.stdout.write(self.style.SUCCESS(f"Master company id={cid} ({master.name})"))

        if reset_demo_gl:
            demo_qs = JournalEntry.objects.filter(
                company_id=cid, entry_number__startswith="DEMO-SEED"
            )
            n = demo_qs.count()
            demo_qs.delete()
            self.stdout.write(
                self.style.WARNING(f"Removed {n} demo journal(s) (DEMO-SEED-*).")
            )

        self.stdout.write(self.style.NOTICE("==> Chart of accounts (fuel_station_v1, full)"))
        chart_kw = {"profile": "full"}
        if fresh:
            chart_kw["replace"] = True
        call_command("seed_master_chart_of_accounts", **chart_kw)

        self.stdout.write(self.style.NOTICE("==> Stations, tanks, islands, dispensers, meters, nozzles"))
        nozzle_kw = {}
        if fresh:
            nozzle_kw["replace"] = True
        call_command("seed_master_nozzles", **nozzle_kw)

        self.stdout.write(self.style.NOTICE("==> General POS / shop items"))
        call_command("seed_master_general_products")

        self.stdout.write(self.style.NOTICE("==> Sample customers (12)"))
        cust_kw = {}
        if fresh:
            cust_kw["replace"] = True
        call_command("seed_master_customers", **cust_kw)

        self.stdout.write(self.style.NOTICE("==> Sample vendors"))
        self._seed_vendors(cid)

        self.stdout.write(self.style.NOTICE("==> VAT tax + rate"))
        self._seed_tax(cid)

        self.stdout.write(self.style.NOTICE("==> Bank accounts (linked to COA when possible)"))
        self._seed_bank_accounts(cid)

        self.stdout.write(self.style.NOTICE("==> Demo GL (opening + sample fuel sale for P&L / balanced BS)"))
        self._seed_demo_gl(cid)

        self.stdout.write(self.style.NOTICE("==> Shift templates"))
        self._seed_shift_templates(cid)

        self.stdout.write(self.style.NOTICE("==> Sample tank dips (if tanks exist)"))
        self._seed_tank_dips(cid)

        self.stdout.write(self.style.NOTICE("==> Sample SaaS broadcasts (Master Filling Station)"))
        call_command("seed_master_sample_broadcasts")

        self.stdout.write(
            self.style.SUCCESS(
                "\nDone. Select Master Filling Station in the sidebar (FSMS ERP), then explore "
                "Stations, Cashier, Customers, Vendors, Chart of Accounts, Tax, Bank Accounts, Shifts, and Reports."
            )
        )

    def _seed_vendors(self, cid: int) -> None:
        for i, row in enumerate(SAMPLE_VENDORS, start=1):
            v, created = Vendor.objects.get_or_create(
                company_id=cid,
                company_name=row["company_name"],
                defaults={
                    "vendor_number": f"VND-DEMO-{i:02d}",
                    "display_name": row["display_name"],
                    "contact_person": row.get("contact_person") or "",
                    "email": row.get("email") or "",
                    "phone": row.get("phone") or "",
                    "billing_address_line1": row.get("billing_address_line1") or "",
                    "opening_balance": Decimal("0"),
                    "current_balance": Decimal("0"),
                    "is_active": True,
                },
            )
            if created:
                self.stdout.write(f"  + Vendor: {v.company_name}")
            else:
                self.stdout.write(f"  . Exists: {v.company_name}")

    def _seed_tax(self, cid: int) -> None:
        tax, created = Tax.objects.get_or_create(
            company_id=cid,
            name="VAT",
            defaults={
                "description": "Value Added Tax (demo)",
                "is_active": True,
            },
        )
        if created:
            self.stdout.write("  + Tax: VAT")
        else:
            self.stdout.write("  . Tax VAT exists")
        if not tax.rates.exists():
            TaxRate.objects.create(
                tax=tax,
                rate=Decimal("15.0000"),
                effective_from=date.today().replace(year=date.today().year - 1),
            )
            self.stdout.write("  + Tax rate 15%")
        else:
            self.stdout.write("  . Tax rate(s) already present")

    def _seed_bank_accounts(self, cid: int) -> None:
        coa_bank = ChartOfAccount.objects.filter(company_id=cid, account_code="1030").first()
        coa_cash = ChartOfAccount.objects.filter(company_id=cid, account_code="1010").first()

        specs = [
            {
                "account_name": "Operating - City Bank (demo)",
                "account_number": "MFS-OP-1001",
                "bank_name": "City Bank PLC",
                "chart": coa_bank,
                "opening": Decimal("250000.00"),
            },
            {
                "account_name": "Station Tills - Petty Cash (demo)",
                "account_number": "MFS-CASH-01",
                "bank_name": "On-site Cash",
                "account_type": "CASH",
                "chart": coa_cash,
                "opening": Decimal("15000.00"),
            },
        ]
        for spec in specs:
            exists = BankAccount.objects.filter(
                company_id=cid, account_number=spec["account_number"]
            ).first()
            if exists:
                self.stdout.write(f"  . Bank: {spec['account_name']}")
                continue
            b = BankAccount(
                company_id=cid,
                chart_account_id=spec["chart"].id if spec.get("chart") else None,
                account_name=spec["account_name"],
                account_number=spec["account_number"],
                bank_name=spec["bank_name"],
                account_type=spec.get("account_type") or "CHECKING",
                opening_balance=spec["opening"],
                current_balance=spec["opening"],
                opening_balance_date=date.today(),
                is_active=True,
            )
            b.save()
            self.stdout.write(f"  + Bank: {b.account_name}")

    def _seed_demo_gl(self, cid: int) -> None:
        """
        Posted journals so Reports → P&L and Balance Sheet show clear sample profit.
        Each entry is idempotent (fixed entry_number). Missing entries are added even if
        some demo journals already exist.
        """
        def coa(code: str) -> ChartOfAccount | None:
            return ChartOfAccount.objects.filter(company_id=cid, account_code=code).first()

        def ensure_je(
            entry_number: str,
            description: str,
            lines: list,
            blurb: str,
        ) -> None:
            if JournalEntry.objects.filter(company_id=cid, entry_number=entry_number).exists():
                self.stdout.write(self.style.NOTICE(f"  . {entry_number} (already present)"))
                return
            je = _create_posted_entry(cid, d0, entry_number, description, lines)
            if je:
                self.stdout.write(self.style.SUCCESS(f"  + {entry_number} - {blurb}"))
            else:
                self.stdout.write(self.style.WARNING(f"  (could not post {entry_number})"))

        a1010 = coa("1010")
        a1030 = coa("1030")
        a1200 = coa("1200")
        a3200 = coa("3200")
        a4100 = coa("4100")
        a4110 = coa("4110")
        a4200 = coa("4200")
        a4230 = coa("4230")
        a5100 = coa("5100")
        a5120 = coa("5120")
        a1220 = coa("1220")
        a6100 = coa("6100")
        a6200 = coa("6200")

        core = [a1010, a1030, a1200, a3200, a4100, a5100]
        if not all(core):
            self.stdout.write(
                self.style.WARNING(
                    "  (skip demo GL — chart missing 1010/1030/1200/3200/4100/5100; run chart seed first)"
                )
            )
            return

        d0 = date.today()
        memo_o = "Demo opening balances — seed_master_full_demo"
        opening_lines = [
            (a1010, Decimal("15000.00"), Decimal("0"), memo_o),
            (a1030, Decimal("250000.00"), Decimal("0"), memo_o),
            (a1200, Decimal("800000.00"), Decimal("0"), memo_o),
            (a3200, Decimal("0"), Decimal("1065000.00"), memo_o),
        ]
        ensure_je(
            "DEMO-SEED-OPENING",
            memo_o,
            opening_lines,
            "cash, bank, fuel inventory vs opening equity",
        )

        # Fuel petrol: strong gross profit (visible on P&L Income + COGS)
        memo_f = "Demo fuel sales (petrol) + COGS — seed_master_full_demo"
        fuel_rev = Decimal("425000.00")
        fuel_cogs = Decimal("318000.00")
        fuel_lines = [
            (a1010, fuel_rev, Decimal("0"), memo_f),
            (a4100, Decimal("0"), fuel_rev, memo_f),
            (a5100, fuel_cogs, Decimal("0"), memo_f),
            (a1200, Decimal("0"), fuel_cogs, memo_f),
        ]
        ensure_je("DEMO-SEED-SALES", memo_f, fuel_lines, f"petrol Tk {fuel_rev} sales, Tk {fuel_cogs} COGS")

        # Diesel second income line (full fuel story on P&L)
        if a4110:
            memo_d = "Demo fuel sales (diesel) + COGS — seed_master_full_demo"
            d_rev = Decimal("198000.00")
            d_cogs = Decimal("151500.00")
            diesel_lines = [
                (a1010, d_rev, Decimal("0"), memo_d),
                (a4110, Decimal("0"), d_rev, memo_d),
                (a5100, d_cogs, Decimal("0"), memo_d),
                (a1200, Decimal("0"), d_cogs, memo_d),
            ]
            ensure_je(
                "DEMO-SEED-SALES-DIESEL",
                memo_d,
                diesel_lines,
                f"diesel Tk {d_rev} sales, Tk {d_cogs} COGS",
            )
        else:
            self.stdout.write("  . DEMO-SEED-SALES-DIESEL (no 4110 account — skipped)")

        # C-store (full chart only): extra income + shop COGS
        if a4200 and a5120 and a1220:
            memo_c = "Demo C-store sales + COGS — seed_master_full_demo"
            cs_rev = Decimal("88000.00")
            cs_cogs = Decimal("52000.00")
            cstore_lines = [
                (a1010, cs_rev, Decimal("0"), memo_c),
                (a4200, Decimal("0"), cs_rev, memo_c),
                (a5120, cs_cogs, Decimal("0"), memo_c),
                (a1220, Decimal("0"), cs_cogs, memo_c),
            ]
            ensure_je(
                "DEMO-SEED-SALES-CSTORE",
                memo_c,
                cstore_lines,
                f"C-store Tk {cs_rev} sales, Tk {cs_cogs} COGS",
            )
        else:
            self.stdout.write("  . DEMO-SEED-SALES-CSTORE (4200/5120/1220 not all present — skipped)")

        # Operating expenses so Net Income < Gross Profit (realistic P&L)
        if a6200 and a6100:
            memo_x = "Demo operating expenses — seed_master_full_demo"
            rent = Decimal("48000.00")
            util = Decimal("12500.00")
            opex_lines = [
                (a6200, rent, Decimal("0"), memo_x),
                (a6100, util, Decimal("0"), memo_x),
                (a1010, Decimal("0"), rent + util, memo_x),
            ]
            ensure_je(
                "DEMO-SEED-OPEX",
                memo_x,
                opex_lines,
                f"rent Tk {rent} + utilities Tk {util}",
            )
        else:
            self.stdout.write("  . DEMO-SEED-OPEX (6100/6200 not present — skipped)")

        # Large profit anchor so Reports → P&L stays clearly positive even with heavy 5200 shrink / live COGS.
        anchor_rev = Decimal("2800000.00")
        anchor_cogs = Decimal("950000.00")
        if a1010 and a4230 and a5100 and a1200:
            memo_a = "Demo profit anchor (other revenue + COGS) — seed_master_full_demo"
            anchor_lines = [
                (a1010, anchor_rev, Decimal("0"), memo_a),
                (a4230, Decimal("0"), anchor_rev, memo_a),
                (a5100, anchor_cogs, Decimal("0"), memo_a),
                (a1200, Decimal("0"), anchor_cogs, memo_a),
            ]
            ensure_je(
                "DEMO-SEED-PROFIT-ANCHOR",
                memo_a,
                anchor_lines,
                f"other operating revenue Tk {anchor_rev}, COGS Tk {anchor_cogs} -> gross +Tk {anchor_rev - anchor_cogs}",
            )
        else:
            self.stdout.write(
                self.style.WARNING(
                    "  . DEMO-SEED-PROFIT-ANCHOR (need 1010, 4230, 5100, 1200 — skipped)"
                )
            )

        # Totals for operator (approximate; P&L is authoritative)
        inc = fuel_rev + (Decimal("198000.00") if a4110 else Decimal("0"))
        cog = fuel_cogs + (Decimal("151500.00") if a4110 else Decimal("0"))
        if a4200 and a5120 and a1220:
            inc += Decimal("88000.00")
            cog += Decimal("52000.00")
        ox = Decimal("60500.00") if (a6200 and a6100) else Decimal("0")
        if a1010 and a4230 and a5100 and a1200:
            inc += anchor_rev
            cog += anchor_cogs
        demo_net = inc - cog - ox
        self.stdout.write(
            self.style.NOTICE(
                f"  -> Sample P&L (demo journals, excl. opening): income ~Tk {inc}, COGS ~Tk {cog}, "
                f"opex ~Tk {ox}, net ~Tk {demo_net}"
            )
        )

    def _seed_shift_templates(self, cid: int) -> None:
        # Same-calendar-day windows (avoids ambiguous overnight parsing in UIs)
        templates = [
            ("Morning Shift", time(6, 0), time(14, 0)),
            ("Evening Shift", time(14, 0), time(22, 0)),
            ("Late Evening", time(22, 0), time(23, 45)),
        ]
        for name, st, et in templates:
            t, created = ShiftTemplate.objects.get_or_create(
                company_id=cid,
                name=name,
                defaults={"start_time": st, "end_time": et},
            )
            if created:
                self.stdout.write(f"  + Shift template: {name}")
            else:
                self.stdout.write(f"  . Shift template: {name}")

    def _seed_tank_dips(self, cid: int) -> None:
        tanks = list(Tank.objects.filter(company_id=cid, is_active=True))
        if not tanks:
            self.stdout.write(self.style.WARNING("  (no tanks — skipped)"))
            return
        dip_date = date.today()
        for tank in tanks:
            if TankDip.objects.filter(tank_id=tank.id, dip_date=dip_date).exists():
                self.stdout.write(f"  . Tank dip today exists: {tank.tank_name}")
                continue
            book_before = tank.current_stock or Decimal("0")
            vol = book_before if book_before > 0 else Decimal("1000.0000")
            TankDip.objects.create(
                company_id=cid,
                tank_id=tank.id,
                dip_date=dip_date,
                volume=vol,
                book_stock_before=book_before,
                water_level=Decimal("0"),
                notes="Demo dip — seed_master_full_demo",
            )
            self.stdout.write(f"  + Tank dip: {tank.tank_name} ({vol} L)")
