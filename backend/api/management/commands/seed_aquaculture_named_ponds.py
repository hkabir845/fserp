"""Create standard named aquaculture ponds with realistic lease and production fields (Bangladesh-style demo)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Max

from api.models import AquacultureFishStockLedger, AquaculturePond, Company
from api.services.aquaculture_pond_pos_customer import maybe_provision_auto_pos_customer

STOCK_MEMO_TAG = "[POND-DEMO-STOCK]"

# Canonical demo rows: idempotent by pond name (case-insensitive) within a company.
POND_PROFILES: tuple[dict, ...] = (
    {
        "name": "Digonta",
        "role": "nursing",
        "code_stem": "DIGONTA",
        "water_area_decimal": Decimal("0.6500"),
        "leasing_area_decimal": Decimal("0.8000"),
        "pond_depth_ft": Decimal("4.200"),
        "lease_contract_start": date(2019, 6, 1),
        "lease_contract_end": date(2029, 5, 31),
        "lease_price_per_decimal_per_year": Decimal("18500.0000"),
        "lease_paid_to_landlord": Decimal("95000.00"),
        "notes": (
            "Nursing unit beside the hatchery channel. 40-mesh hapas; daily grading. "
            "Water ~0.65 dec effective surface; lease measured on 0.8 dec including bank strip."
        ),
        "demo_fish_count": 52000,
        "demo_weight_kg": Decimal("1040.0000"),
    },
    {
        "name": "Mynuddin",
        "role": "grow_out",
        "code_stem": "MYNUDDIN",
        "water_area_decimal": Decimal("2.4000"),
        "leasing_area_decimal": Decimal("2.6500"),
        "pond_depth_ft": Decimal("5.800"),
        "lease_contract_start": date(2019, 6, 1),
        "lease_contract_end": date(2029, 5, 31),
        "lease_price_per_decimal_per_year": Decimal("18500.0000"),
        "lease_paid_to_landlord": Decimal("310000.00"),
        "notes": (
            "Main grow-out: paddlewheel aeration on south corner; monosex tilapia from spring nursing transfer. "
            "Leasing area includes access path on north bund."
        ),
        "demo_fish_count": 11800,
        "demo_weight_kg": Decimal("3540.0000"),
    },
    {
        "name": "Ashari-1",
        "role": "grow_out",
        "code_stem": "ASHARI1",
        "water_area_decimal": Decimal("3.1000"),
        "leasing_area_decimal": Decimal("3.3500"),
        "pond_depth_ft": Decimal("6.200"),
        "lease_contract_start": date(2019, 6, 1),
        "lease_contract_end": date(2029, 5, 31),
        "lease_price_per_decimal_per_year": Decimal("18500.0000"),
        "lease_paid_to_landlord": Decimal("400000.00"),
        "notes": (
            "Largest production cell; deeper average depth for dry-season carry. Improved GIFT line; "
            "bamboo sluice maintenance budgeted each monsoon."
        ),
        "demo_fish_count": 14200,
        "demo_weight_kg": Decimal("4970.0000"),
    },
    {
        "name": "Ashari-2",
        "role": "grow_out",
        "code_stem": "ASHARI2",
        "water_area_decimal": Decimal("1.8500"),
        "leasing_area_decimal": Decimal("2.0500"),
        "pond_depth_ft": Decimal("5.000"),
        "lease_contract_start": date(2019, 6, 1),
        "lease_contract_end": date(2029, 5, 31),
        "lease_price_per_decimal_per_year": Decimal("18500.0000"),
        "lease_paid_to_landlord": Decimal("379250.00"),
        "notes": (
            "Earthen pond with inlet from shared canal; slightly shallower — watch afternoon DO in April–May. "
            "Lease prepaid through contract term (balance zero in demo)."
        ),
        "demo_fish_count": 9600,
        "demo_weight_kg": Decimal("2880.0000"),
    },
)


def _unique_pond_code(company_id: int, base: str) -> str:
    stem = (base or "P").strip().upper().replace(" ", "")[:64] or "P"
    code = stem
    n = 0
    while AquaculturePond.objects.filter(company_id=company_id, code__iexact=code).exists():
        n += 1
        suffix = f"-{n}"
        code = f"{stem[: max(1, 64 - len(suffix))]}{suffix}"
    return code[:64]


def _apply_profile(p: AquaculturePond, spec: dict) -> None:
    p.pond_role = spec["role"]
    p.water_area_decimal = spec["water_area_decimal"]
    p.leasing_area_decimal = spec["leasing_area_decimal"]
    p.pond_depth_ft = spec["pond_depth_ft"]
    p.lease_contract_start = spec["lease_contract_start"]
    p.lease_contract_end = spec["lease_contract_end"]
    p.lease_price_per_decimal_per_year = spec["lease_price_per_decimal_per_year"]
    p.lease_paid_to_landlord = spec["lease_paid_to_landlord"]
    p.notes = spec["notes"]


class Command(BaseCommand):
    help = (
        "Create Digonta (nursing), Mynuddin & Ashari grow-out ponds with realistic lease and water-area demo data. "
        "For http://localhost:3000/aquaculture/ponds use: seed_aquaculture_named_ponds --fill-page "
        "(and --provision-pos-customer on first create). "
        "See also --backfill-existing and --with-demo-stock."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--company-id",
            type=int,
            default=None,
            help="Company primary key (default: first company with aquaculture_enabled, else lowest id).",
        )
        parser.add_argument(
            "--provision-pos-customer",
            action="store_true",
            help="Auto-create a POS customer per new pond (same as UI default). Default: skip until you configure ponds.",
        )
        parser.add_argument(
            "--backfill-existing",
            action="store_true",
            help="Update ponds that match these names with the canonical sample lease / area / depth / notes.",
        )
        parser.add_argument(
            "--with-demo-stock",
            action="store_true",
            help=f"Add one tilapia stock adjustment per pond (memo {STOCK_MEMO_TAG!r}) so Load (tilapia) columns populate.",
        )
        parser.add_argument(
            "--fill-page",
            action="store_true",
            help="Shorthand for localhost/UI demos: same as --backfill-existing --with-demo-stock.",
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
            self.stdout.write(self.style.NOTICE("Enabled aquaculture on company for module access."))

        skip_auto = not bool(options["provision_pos_customer"])
        fill_page = bool(options["fill_page"])
        backfill = bool(options["backfill_existing"]) or fill_page
        with_stock = bool(options["with_demo_stock"]) or fill_page

        max_sort = AquaculturePond.objects.filter(company_id=cid).aggregate(m=Max("sort_order"))["m"] or 0
        next_order = int(max_sort) + 1

        created = 0
        skipped_new = 0
        backfilled = 0

        for spec in POND_PROFILES:
            name = str(spec["name"]).strip()[:200]
            existing = AquaculturePond.objects.filter(company_id=cid, name__iexact=name).first()
            if existing:
                if backfill:
                    with transaction.atomic():
                        p = AquaculturePond.objects.select_for_update().get(pk=existing.pk)
                        _apply_profile(p, spec)
                        p.save()
                    self.stdout.write(self.style.SUCCESS(f"Backfilled sample fields: {name!r}"))
                    backfilled += 1
                else:
                    self.stdout.write(self.style.WARNING(f"Skip (exists): {name!r} — use --backfill-existing to refresh"))
                    skipped_new += 1
                pond_for_stock = AquaculturePond.objects.get(pk=existing.pk)
            else:
                code = _unique_pond_code(cid, spec["code_stem"])
                with transaction.atomic():
                    p = AquaculturePond(
                        company_id=cid,
                        name=name,
                        code=code,
                        sort_order=next_order,
                        is_active=True,
                    )
                    _apply_profile(p, spec)
                    p.save()
                    err = maybe_provision_auto_pos_customer(company_id=cid, pond=p, skip_auto=skip_auto)
                    if err:
                        raise RuntimeError(err)
                    p.save()
                self.stdout.write(self.style.SUCCESS(f"Created pond {name!r} ({spec['role']}) code={code}"))
                created += 1
                next_order += 1
                pond_for_stock = p

            if with_stock:
                self._ensure_demo_stock_row(cid, pond_for_stock, spec)

        self.stdout.write(
            self.style.NOTICE(
                f"Done. company_id={cid} created={created} skipped_new={skipped_new} backfilled={backfilled} "
                f"pos_customer_on_new={'yes' if not skip_auto else 'skipped'} demo_stock={'yes' if with_stock else 'no'}"
            )
        )

    def _ensure_demo_stock_row(self, company_id: int, pond: AquaculturePond, spec: dict) -> None:
        if AquacultureFishStockLedger.objects.filter(
            company_id=company_id, pond_id=pond.id, memo__contains=STOCK_MEMO_TAG
        ).exists():
            return
        fc = int(spec["demo_fish_count"])
        wkg = spec["demo_weight_kg"]
        AquacultureFishStockLedger.objects.create(
            company_id=company_id,
            pond=pond,
            production_cycle=None,
            entry_date=date.today(),
            entry_kind="adjustment",
            loss_reason="",
            fish_species="tilapia",
            fish_count_delta=fc,
            weight_kg_delta=wkg,
            book_value=Decimal("0"),
            post_to_books=False,
            memo=(
                f"{STOCK_MEMO_TAG} Opening reconcile after seine / cast-net estimate — demo only, not posted to GL."
            ),
        )
        self.stdout.write(self.style.NOTICE(f"  + Demo tilapia stock row for {pond.name!r}"))
