"""
Audit pond biomass load (kg/dec) and optionally scale water_area_decimal.

kg/dec = biomass_kg ÷ water_area_decimal. A value ~10× too high usually means water area
was entered in acres (or acres×10) instead of Bangladesh decimals (1 acre = 100 decimals).

Examples:
  python manage.py audit_aquaculture_pond_load --company-id 2
  python manage.py audit_aquaculture_pond_load --company-id 2 --scale-water-by 10 --apply
  python manage.py audit_aquaculture_pond_load --company-id 2 --pond-id 17 --scale-water-by 10 --apply
"""
from __future__ import annotations

from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import AquaculturePond, Company
from api.services.aquaculture_stock_service import compute_fish_stock_position_breakdown_rows
from api.services.aquaculture_units import quantize_pond_area_decimal


def _d(v) -> Decimal:
    if v is None or v == "":
        return Decimal("0")
    try:
        return Decimal(str(v))
    except Exception:
        return Decimal("0")


class Command(BaseCommand):
    help = (
        "List kg/dec load per pond/batch and flag likely water-area unit mistakes; "
        "optionally multiply water_area_decimal by a factor (e.g. 10)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument("--pond-id", type=int, default=None, help="Limit to one pond.")
        parser.add_argument(
            "--scale-water-by",
            type=str,
            default=None,
            help="Multiply water_area_decimal by this factor (e.g. 10). Dry-run unless --apply.",
        )
        parser.add_argument(
            "--also-scale-leasing",
            action="store_true",
            help="With --scale-water-by, also scale leasing_area_decimal by the same factor.",
        )
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Persist --scale-water-by changes (otherwise dry-run).",
        )
        parser.add_argument(
            "--high-kg-dec",
            type=str,
            default="80",
            help="Flag grow-out rows at or above this kg/dec (default 80).",
        )

    def handle(self, *args, **options):
        cid = int(options["company_id"])
        if not Company.objects.filter(pk=cid, is_deleted=False).exists():
            self.stderr.write(self.style.ERROR(f"Company id={cid} not found."))
            return

        pond_id = options.get("pond_id")
        high = _d(options["high_kg_dec"])
        scale_raw = options.get("scale_water_by")
        scale = _d(scale_raw) if scale_raw not in (None, "") else None
        apply = bool(options["apply"])
        also_lease = bool(options["also_scale_leasing"])

        ponds = AquaculturePond.objects.filter(company_id=cid, is_active=True).order_by("sort_order", "id")
        if pond_id is not None:
            ponds = ponds.filter(pk=pond_id)

        pond_list = list(ponds)
        if not pond_list:
            self.stdout.write(self.style.WARNING("No ponds matched."))
            return

        self.stdout.write(
            f"company_id={cid} ponds={len(pond_list)} "
            f"(kg/dec = biomass ÷ water_area_decimal; 1 acre = 100 decimals)"
        )
        flagged = 0
        for p in pond_list:
            wa = p.water_area_decimal
            rows = compute_fish_stock_position_breakdown_rows(cid, pond_id=p.id)
            if not rows:
                self.stdout.write(
                    f"  pond id={p.id} {p.name!r} water={wa} — no stock rows"
                )
                continue
            for r in rows:
                dens = _d(r.get("stock_density_kg_per_decimal"))
                bio = _d(r.get("biomass_kg_for_load") or r.get("effective_net_weight_kg"))
                book = _d(r.get("book_net_weight_kg") or r.get("implied_net_weight_kg"))
                fish = r.get("implied_net_fish_count")
                cy = r.get("production_cycle_name") or r.get("production_cycle_id")
                role = (r.get("pond_role") or p.pond_role or "grow_out").strip()
                suspect = dens >= high and (role in ("grow_out", "other", "") or dens >= high * 2)
                if suspect:
                    flagged += 1
                mark = " ** CHECK WATER AREA (often ×10 or ×100 short) **" if suspect else ""
                self.stdout.write(
                    f"  pond id={p.id} {p.name!r} cycle={cy!r} species={r.get('fish_species')} "
                    f"water={wa} bio={bio} book={book} fish={fish} kg/dec={dens} "
                    f"label={r.get('load_level_label')!r}{mark}"
                )

        self.stdout.write(self.style.NOTICE(f"Flagged high-load rows: {flagged}"))

        if scale is None:
            if flagged:
                self.stdout.write(
                    self.style.NOTICE(
                        "If kg/dec is ~10× too high vs farm spreadsheet, water area is usually 10× too small. "
                        "Re-run with --scale-water-by 10 --apply (add --also-scale-leasing if lease land matches)."
                    )
                )
            return

        if scale <= 0:
            self.stderr.write(self.style.ERROR("--scale-water-by must be > 0"))
            return

        self.stdout.write(
            self.style.WARNING(
                f"{'APPLY' if apply else 'DRY-RUN'}: multiply water_area_decimal by {scale}"
                + (" and leasing_area_decimal" if also_lease else "")
            )
        )
        updated = 0
        with transaction.atomic():
            for p in AquaculturePond.objects.select_for_update().filter(
                company_id=cid, pk__in=[x.id for x in pond_list]
            ):
                if p.water_area_decimal is None or p.water_area_decimal <= 0:
                    self.stdout.write(f"  skip id={p.id} {p.name!r} — no water area")
                    continue
                old_w = p.water_area_decimal
                new_w = quantize_pond_area_decimal(old_w * scale)
                old_l = p.leasing_area_decimal
                new_l = old_l
                fields = ["water_area_decimal", "updated_at"]
                p.water_area_decimal = new_w
                if also_lease and old_l is not None and old_l > 0:
                    new_l = quantize_pond_area_decimal(old_l * scale)
                    p.leasing_area_decimal = new_l
                    fields.append("leasing_area_decimal")
                self.stdout.write(
                    f"  id={p.id} {p.name!r}: water {old_w} → {new_w}"
                    + (f"; lease {old_l} → {new_l}" if also_lease else "")
                )
                if apply:
                    p.save(update_fields=fields)
                    updated += 1

        if apply:
            self.stdout.write(self.style.SUCCESS(f"Updated {updated} pond(s)."))
        else:
            self.stdout.write(self.style.NOTICE("Dry-run only — pass --apply to save."))
