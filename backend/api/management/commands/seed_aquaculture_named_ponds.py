"""Create standard named aquaculture ponds with realistic lease and production fields (Bangladesh-style demo)."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Max

from api.models import (
    AquacultureFishStockLedger,
    AquaculturePond,
    AquacultureProductionCycle,
    AquacultureWarehouseGroup,
    Company,
)
from api.services.aquaculture_pond_pos_customer import maybe_provision_auto_pos_customer

from api.services.aquaculture_pond_site import default_nursing_name_for_site

STOCK_MEMO_TAG = "[POND-DEMO-STOCK]"

# Canonical demo rows: idempotent by pond name (case-insensitive) within a company.
# Mynuddin is a same-site pair: nursing phase + grow-out phase on one physical pond.
# Areas are Bangladesh land decimals (1 acre = 100 decimals). Never store acre counts here —
# that understates area by ~100× and inflates kg/dec / pcs/dec by the same factor.
POND_PROFILES: tuple[dict, ...] = (
    {
        "name": "Digonta",
        "role": "nursing",
        "physical_site_name": "Digonta",
        "linked_grow_out_name": "Digonta-Grow Out",
        "code_stem": "DIGONTA",
        "water_area_decimal": Decimal("65.00"),
        "leasing_area_decimal": Decimal("80.00"),
        "pond_depth_ft": Decimal("4.20"),
        "lease_contract_start": date(2019, 6, 1),
        "lease_contract_end": date(2029, 5, 31),
        "lease_price_per_decimal_per_year": Decimal("18500.0000"),
        "lease_paid_to_landlord": Decimal("95000.00"),
        "notes": (
            "Nursing unit beside the hatchery channel. 40-mesh hapas; daily grading. "
            "Water ~65 dec effective surface; lease measured on 80 dec including bank strip."
        ),
        "demo_fish_count": 52000,
        "demo_weight_kg": Decimal("1040.0000"),
    },
    {
        "name": "Mynuddin",
        "role": "grow_out",
        "physical_site_name": "Mynuddin",
        "site_pair": True,
        "code_stem": "MYNUDDIN",
        "water_area_decimal": Decimal("240.00"),
        "leasing_area_decimal": Decimal("265.00"),
        "pond_depth_ft": Decimal("5.80"),
        "lease_contract_start": date(2019, 6, 1),
        "lease_contract_end": date(2029, 5, 31),
        "lease_price_per_decimal_per_year": Decimal("18500.0000"),
        "lease_paid_to_landlord": Decimal("310000.00"),
        "notes": (
            "Main grow-out: paddlewheel aeration on south corner; monosex tilapia from spring nursing transfer. "
            "Leasing area includes access path on north bund (~265 dec leased / ~240 dec water)."
        ),
        "demo_fish_count": 11800,
        "demo_weight_kg": Decimal("3540.0000"),
    },
    {
        "name": "Ashari-1",
        "role": "grow_out",
        "code_stem": "ASHARI1",
        "water_area_decimal": Decimal("800.00"),
        "leasing_area_decimal": Decimal("835.00"),
        "pond_depth_ft": Decimal("6.20"),
        "lease_contract_start": date(2019, 6, 1),
        "lease_contract_end": date(2029, 5, 31),
        "lease_price_per_decimal_per_year": Decimal("18500.0000"),
        "lease_paid_to_landlord": Decimal("400000.00"),
        "notes": (
            "Largest production cell (~800 dec water / ~8 acres); deeper average depth for dry-season carry. "
            "Improved GIFT line; bamboo sluice maintenance budgeted each monsoon."
        ),
        "demo_fish_count": 14200,
        "demo_weight_kg": Decimal("4970.0000"),
    },
    {
        "name": "Ashari-2",
        "role": "grow_out",
        "code_stem": "ASHARI2",
        "water_area_decimal": Decimal("480.00"),
        "leasing_area_decimal": Decimal("520.00"),
        "pond_depth_ft": Decimal("5.00"),
        "lease_contract_start": date(2019, 6, 1),
        "lease_contract_end": date(2029, 5, 31),
        "lease_price_per_decimal_per_year": Decimal("18500.0000"),
        "lease_paid_to_landlord": Decimal("379250.00"),
        "notes": (
            "Earthen pond with inlet from shared canal (~480 dec water); slightly shallower — watch afternoon DO "
            "in April–May. Lease prepaid through contract term (balance zero in demo)."
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


def _mid_cycle_for_pond(company_id: int, pond: AquaculturePond) -> AquacultureProductionCycle:
    cy = (
        AquacultureProductionCycle.objects.filter(
            company_id=company_id,
            pond=pond,
            is_active=True,
            name__icontains="Mid Cycle",
        )
        .order_by("-start_date", "-id")
        .first()
    )
    if cy:
        return cy
    cy = AquacultureProductionCycle.objects.filter(company_id=company_id, pond=pond, code="0").first()
    if cy:
        return cy
    label = (pond.name or "Pond").strip()
    return AquacultureProductionCycle.objects.create(
        company_id=company_id,
        pond=pond,
        name=f"{label} Mid Cycle",
        code="0",
        start_date=date.today() - timedelta(days=365),
        is_active=True,
        notes=f"Auto-created for {STOCK_MEMO_TAG} cycle tagging.",
    )


def _apply_profile(p: AquaculturePond, spec: dict, *, force_areas: bool = False) -> None:
    """
    Apply demo profile fields.

    Water / leasing / depth are only overwritten when the pond is new, areas are missing,
    or ``force_areas`` is True. This prevents ``--backfill-existing`` from shrinking real
    production water areas (e.g. 800 dec) down to an old demo typo and inflating kg/dec ~10–100×.
    """
    p.pond_role = spec["role"]
    site = (spec.get("physical_site_name") or "").strip()
    if site:
        p.physical_site_name = site[:120]
    new_wa = spec["water_area_decimal"]
    new_la = spec["leasing_area_decimal"]
    new_depth = spec["pond_depth_ft"]
    if force_areas or p.pk is None:
        p.water_area_decimal = new_wa
        p.leasing_area_decimal = new_la
        p.pond_depth_ft = new_depth
    else:
        if p.water_area_decimal is None or p.water_area_decimal <= 0:
            p.water_area_decimal = new_wa
        if p.leasing_area_decimal is None or p.leasing_area_decimal <= 0:
            p.leasing_area_decimal = new_la
        if p.pond_depth_ft is None or p.pond_depth_ft <= 0:
            p.pond_depth_ft = new_depth
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
            help=(
                "Update ponds that match these names with canonical lease / notes "
                "(water & leasing areas only filled when missing; use --force-areas to overwrite)."
            ),
        )
        parser.add_argument(
            "--force-areas",
            action="store_true",
            help="With --backfill-existing, overwrite water_area_decimal / leasing_area_decimal / depth.",
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
        force_areas = bool(options["force_areas"])
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
                        _apply_profile(p, spec, force_areas=force_areas)
                        p.save()
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"Backfilled sample fields: {name!r}"
                            + (" (areas forced)" if force_areas else " (areas kept if already set)")
                        )
                    )
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
                    _apply_profile(p, spec, force_areas=True)
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

        self._ensure_digonta_site_pair(cid)
        self._ensure_mynuddin_site_pair(cid, skip_auto=skip_auto, next_order_start=next_order)
        self._ensure_ashari_shared_warehouse_group(cid)

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
        cy = _mid_cycle_for_pond(company_id, pond)
        AquacultureFishStockLedger.objects.create(
            company_id=company_id,
            pond=pond,
            production_cycle=cy,
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

    def _ensure_digonta_site_pair(self, company_id: int) -> None:
        nursing = AquaculturePond.objects.filter(
            company_id=company_id, name__iexact="Digonta", pond_role="nursing", is_active=True
        ).first()
        if not nursing:
            return
        grow_name = "Digonta-Grow Out"
        grow = AquaculturePond.objects.filter(company_id=company_id, name__iexact=grow_name, is_active=True).first()
        if not grow:
            grow = AquaculturePond.objects.create(
                company_id=company_id,
                name=grow_name,
                code=_unique_pond_code(company_id, "DIGONTA-GO"),
                sort_order=(nursing.sort_order or 0) + 1,
                is_active=True,
                pond_role="grow_out",
                physical_site_name="Digonta",
            )
            self.stdout.write(self.style.SUCCESS(f"Created grow-out pair {grow_name!r} for Digonta site"))
        elif not (grow.physical_site_name or "").strip():
            grow.physical_site_name = "Digonta"
            grow.save(update_fields=["physical_site_name", "updated_at"])
        if not (nursing.physical_site_name or "").strip():
            nursing.physical_site_name = "Digonta"
        if nursing.linked_grow_out_pond_id != grow.id:
            nursing.linked_grow_out_pond_id = grow.id
        nursing.save(update_fields=["physical_site_name", "linked_grow_out_pond_id", "updated_at"])

    def _ensure_mynuddin_site_pair(self, company_id: int, *, skip_auto: bool, next_order_start: int) -> None:
        grow = AquaculturePond.objects.filter(
            company_id=company_id, name__iexact="Mynuddin", pond_role="grow_out", is_active=True
        ).first()
        if not grow:
            return
        site = (grow.physical_site_name or "").strip() or "Mynuddin"
        if not (grow.physical_site_name or "").strip():
            grow.physical_site_name = site
            grow.save(update_fields=["physical_site_name", "updated_at"])
        nursing_name = default_nursing_name_for_site(site)
        nursing = AquaculturePond.objects.filter(
            company_id=company_id, name__iexact=nursing_name, pond_role="nursing", is_active=True
        ).first()
        if not nursing:
            nursing = AquaculturePond.objects.filter(
                company_id=company_id,
                physical_site_name__iexact=site,
                pond_role="nursing",
                is_active=True,
            ).first()
        if not nursing:
            nursing = AquaculturePond(
                company_id=company_id,
                name=nursing_name,
                code=_unique_pond_code(company_id, "MYNUDDIN-N"),
                sort_order=max(0, (grow.sort_order or next_order_start) - 1),
                is_active=True,
                pond_role="nursing",
                physical_site_name=site,
                linked_grow_out_pond=grow,
                water_area_decimal=grow.water_area_decimal,
                leasing_area_decimal=grow.leasing_area_decimal,
            )
            nursing.save()
            err = maybe_provision_auto_pos_customer(company_id=company_id, pond=nursing, skip_auto=skip_auto)
            if err:
                raise RuntimeError(err)
            nursing.save()
            self.stdout.write(self.style.SUCCESS(f"Created nursing pair {nursing_name!r} for Mynuddin site"))
        elif nursing.linked_grow_out_pond_id != grow.id:
            nursing.linked_grow_out_pond_id = grow.id
            if not (nursing.physical_site_name or "").strip():
                nursing.physical_site_name = site
            nursing.save(update_fields=["physical_site_name", "linked_grow_out_pond_id", "updated_at"])

    def _ensure_ashari_shared_warehouse_group(self, company_id: int) -> None:
        grp = AquacultureWarehouseGroup.objects.filter(company_id=company_id, code__iexact="ASHARI-WH").first()
        created = False
        if not grp:
            grp = AquacultureWarehouseGroup.objects.create(
                company_id=company_id,
                name="Ashari shared shed",
                code="ASHARI-WH",
                notes="Canal-bund feed/medicine store for Ashari-1 and Ashari-2 (demo).",
                is_active=True,
            )
            created = True
        linked = 0
        for pname in ("Ashari-1", "Ashari-2"):
            p = AquaculturePond.objects.filter(company_id=company_id, name__iexact=pname).first()
            if p and p.warehouse_group_id != grp.id:
                p.warehouse_group_id = grp.id
                p.save(update_fields=["warehouse_group_id", "updated_at"])
                linked += 1
        if created:
            self.stdout.write(self.style.SUCCESS(f"Created shared warehouse group {grp.name!r}"))
        if linked:
            self.stdout.write(self.style.NOTICE(f"  Linked {linked} Ashari pond(s) to {grp.name!r}"))
