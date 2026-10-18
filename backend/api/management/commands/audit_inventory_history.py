"""Audit historical inventory coverage; optionally backfill provable cost evidence."""
import json
from datetime import date

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from api.models import Company, InvoiceLine, Item
from api.services.inventory_cost_evidence import invoice_stock_costs
from api.services.inventory_history import historical_inventory_positions
from api.services.item_catalog import item_tracks_physical_stock


class Command(BaseCommand):
    help = "Read-only inventory-history audit; --backfill-cost-evidence only records costs proved by existing posted journals."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument("--as-of", default=None)
        parser.add_argument("--backfill-cost-evidence", action="store_true")

    def handle(self, *args, **options):
        cid = options["company_id"]
        if not Company.objects.filter(pk=cid).exists():
            raise CommandError("Company not found.")
        try:
            as_of = date.fromisoformat(options["as_of"]) if options["as_of"] else timezone.localdate()
        except ValueError:
            raise CommandError("--as-of must be YYYY-MM-DD.")
        items = [item for item in Item.objects.filter(company_id=cid).order_by("id")
                 if item_tracks_physical_stock(item) and item.pos_category != "fish"]
        lines = list(InvoiceLine.objects.filter(
            invoice__company_id=cid, invoice__invoice_date__lte=as_of,
            invoice__internal_fish_transfer_line__isnull=True,
            stock_cost_amount__isnull=True, item_id__in=[item.id for item in items],
        ).exclude(invoice__status__in=("draft", "void")))
        costs = invoice_stock_costs(cid, lines)
        applied = 0
        if options["backfill_cost_evidence"]:
            with transaction.atomic():
                # No journal, physical quantity, opening date, price or item cost is changed.
                for line in lines:
                    if line.id in costs:
                        applied += InvoiceLine.objects.filter(pk=line.id, invoice__company_id=cid,
                            stock_cost_amount__isnull=True).update(stock_cost_amount=costs[line.id])
        positions = historical_inventory_positions(cid, items, as_of)
        issues = [{"item_id": iid, "warnings": p["warnings"]} for iid, p in positions.items() if not p["is_complete"]]
        self.stdout.write(json.dumps({
            "company_id": cid, "as_of_date": as_of.isoformat(), "item_count": len(items),
            "complete_items": len(items) - len(issues), "incomplete_items": len(issues),
            "provable_cost_snapshots": len(costs), "cost_snapshots_written": applied,
            "mode": "backfill-cost-evidence" if options["backfill_cost_evidence"] else "dry-run",
            "issues": issues,
        }, indent=2))
