"""
Report (and optionally repair) items whose quantity_on_hand disagrees with its own stock basis.

Item.quantity_on_hand is a cached roll-up: tanks for fuel SKUs, pond rows for fish SKUs,
station + pond bins for everything else that is bin-tracked. Every supported write path
refreshes it, but a direct DB edit, an import, or a seeder that wrote bins straight through
can leave it stale — and stale QOH silently misvalues inventory reports and COGS relief.

Usage:
  python manage.py reconcile_item_stock --company-id 1
  python manage.py reconcile_item_stock --company-id 1 --apply
  python manage.py reconcile_item_stock --company-id 1 --json
"""

import json
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db.models import Sum

from api.models import Company, Item, ItemPondStock, ItemStationStock, Tank
from api.services.item_catalog import item_tracks_physical_stock
from api.services.station_stock import (
    item_uses_station_bins,
    refresh_item_quantity_on_hand,
    tanks_exist_for_item,
)


def _sum(qs, field: str) -> Decimal:
    return Decimal(qs.aggregate(s=Sum(field))["s"] or 0)


def _console_safe(text: str, stream) -> str:
    """Item names carry ₂/₃/— which a cp1252 Windows console cannot encode; never crash on output."""
    enc = getattr(stream, "encoding", None) or "utf-8"
    try:
        text.encode(enc)
    except (UnicodeEncodeError, LookupError):
        return text.encode(enc, "replace").decode(enc, "replace")
    return text


def expected_quantity_on_hand(company_id: int, item: Item) -> tuple[Decimal, str] | None:
    """The roll-up quantity this item should carry, plus the basis name. None = not stock-tracked."""
    if tanks_exist_for_item(company_id, item.id):
        return _sum(Tank.objects.filter(company_id=company_id, product_id=item.id), "current_stock"), "tanks"
    if not item_tracks_physical_stock(item):
        return None
    pond_rows = ItemPondStock.objects.filter(company_id=company_id, item_id=item.id)
    if (item.pos_category or "").strip().lower() == "fish":
        if not pond_rows.exists():
            return None
        return _sum(pond_rows, "quantity"), "pond rows"
    if not item_uses_station_bins(company_id, item):
        return None
    station_rows = ItemStationStock.objects.filter(company_id=company_id, item_id=item.id)
    return _sum(station_rows, "quantity") + _sum(pond_rows, "quantity"), "station + pond bins"


def find_stock_drift(company_id: int) -> list[dict]:
    out: list[dict] = []
    for item in Item.objects.filter(company_id=company_id).order_by("id"):
        got = expected_quantity_on_hand(company_id, item)
        if got is None:
            continue
        expected, basis = got
        current = item.quantity_on_hand or Decimal("0")
        if current == expected:
            continue
        out.append(
            {
                "item_id": item.id,
                "item_number": item.item_number or "",
                "name": item.name or "",
                "basis": basis,
                "quantity_on_hand": str(current),
                "expected": str(expected),
                "difference": str(current - expected),
            }
        )
    return out


class Command(BaseCommand):
    help = "Report items whose quantity_on_hand disagrees with tanks / bins; --apply recomputes it."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Recompute quantity_on_hand from the stock basis (bins/tanks are authoritative).",
        )
        parser.add_argument("--json", action="store_true", help="Output machine-readable JSON.")

    def handle(self, *args, **opts):
        cid = opts["company_id"]
        if not Company.objects.filter(pk=cid).exists():
            self.stderr.write(self.style.ERROR("No company with id %s" % cid))
            return
        rows = find_stock_drift(cid)
        if opts["apply"]:
            for r in rows:
                refresh_item_quantity_on_hand(cid, r["item_id"])
            remaining = find_stock_drift(cid)
            for r in rows:
                r["repaired"] = not any(x["item_id"] == r["item_id"] for x in remaining)
        if opts["json"]:
            self.stdout.write(json.dumps({"company_id": cid, "drift_count": len(rows), "rows": rows}, indent=2))
            return
        if not rows:
            self.stdout.write(self.style.SUCCESS("All stock-tracked items agree with their stock basis."))
            return
        self.stdout.write(self.style.WARNING("%d item(s) out of step with their stock basis:" % len(rows)))
        for r in rows:
            mark = ""
            if opts["apply"]:
                mark = "  [repaired]" if r.get("repaired") else "  [STILL OFF]"
            line = (
                "  #%-5s %-38s %-20s on hand=%-12s expected=%-12s diff=%s%s"
                % (r["item_id"], r["name"][:38], r["basis"], r["quantity_on_hand"],
                   r["expected"], r["difference"], mark)
            )
            self.stdout.write(_console_safe(line, self.stdout._out))
        if not opts["apply"]:
            self.stdout.write("\nRe-run with --apply to recompute quantity_on_hand from the stock basis.")
