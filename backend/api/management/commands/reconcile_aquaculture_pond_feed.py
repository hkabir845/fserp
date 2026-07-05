"""
Audit pond feed GL posting and unused pond-warehouse stock; optionally backfill journals and return feed to shop.

Usage (on VPS):
  python manage.py reconcile_aquaculture_pond_feed --company-id 1
  python manage.py reconcile_aquaculture_pond_feed --company-id 1 --fix-gl
  python manage.py reconcile_aquaculture_pond_feed --company-id 1 --return-feed --fix-gl
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import Company
from api.services.aquaculture_pond_feed_reconcile_service import (
    audit_pond_feed_gl_and_stock,
    backfill_pond_feed_gl_gaps,
    return_pond_feed_stock_to_shop,
)


class Command(BaseCommand):
    help = (
        "Audit pond feed consumption GL (AUTO-AQ-POND/SHOP), flag mis-posted feeding advice expenses, "
        "and optionally backfill journals or return unused pond feed to shop."
    )

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument(
            "--fix-gl",
            action="store_true",
            help="Backfill missing AUTO-AQ-POND-* and AUTO-AQ-SHOP-* journal entries.",
        )
        parser.add_argument(
            "--return-feed",
            action="store_true",
            help="Return all feed SKUs from pond warehouse to shop (no GL; reduces pond on-hand).",
        )
        parser.add_argument(
            "--station-id",
            type=int,
            default=None,
            help="Shop station for feed returns (default: last receipt station or company default).",
        )
        parser.add_argument(
            "--pond-id",
            type=int,
            default=None,
            help="Limit feed return to one pond.",
        )

    def handle(self, *args, **options):
        company_id = options["company_id"]
        company = Company.objects.filter(pk=company_id).first()
        if not company:
            self.stderr.write(self.style.ERROR(f"Company {company_id} not found"))
            return

        report = audit_pond_feed_gl_and_stock(company_id)

        self.stdout.write(f"Pond feed reconcile - company {company_id} ({company.name!r})")
        self.stdout.write("")

        pond_gaps = report["pond_consumption_gaps"]
        shop_gaps = report["shop_issue_gaps"]
        if not pond_gaps and not shop_gaps:
            self.stdout.write(self.style.SUCCESS("No missing consumption / shop-issue GL journals."))
        else:
            if pond_gaps:
                self.stdout.write(self.style.WARNING(f"Pond consumption GL gaps: {len(pond_gaps)}"))
                for row in pond_gaps:
                    self.stdout.write(
                        f"  expense #{row['record_id']}  {row['label']}  "
                        f"amount={row.get('amount')}  expected={row['expected_entry_number']}"
                    )
            if shop_gaps:
                self.stdout.write(self.style.WARNING(f"Shop issue GL gaps: {len(shop_gaps)}"))
                for row in shop_gaps:
                    self.stdout.write(
                        f"  expense #{row['record_id']}  {row['label']}  "
                        f"amount={row.get('amount')}  expected={row['expected_entry_number']}"
                    )

        feed_stock = report["pond_feed_stock"]
        if feed_stock:
            self.stdout.write("")
            self.stdout.write(
                self.style.WARNING(
                    f"Pond warehouse feed on hand ({len(feed_stock)} row(s)) - not yet feed cost until consumed:"
                )
            )
            for row in feed_stock:
                self.stdout.write(
                    f"  pond {row['pond_id']} {row['pond_name']!r}  "
                    f"item {row['item_id']} {row['item_name']!r}  "
                    f"qty={row['quantity']} {row['unit']}  unit_cost={row['unit_cost']}"
                )
        else:
            self.stdout.write(self.style.SUCCESS("No feed stock sitting at pond warehouses."))

        manual = report["advice_manual_feed_purchase"]
        if manual:
            self.stdout.write("")
            self.stdout.write(
                self.style.WARNING(
                    f"Applied feeding advice with manual feed_purchase expense ({len(manual)}) - "
                    "counts as pond feed cost without pond-warehouse consumption:"
                )
            )
            for row in manual:
                self.stdout.write(
                    f"  advice #{row['advice_id']} pond {row['pond_id']} {row['pond_name']!r}  "
                    f"kg={row['applied_kg']}  expense #{row['expense_id']} amount={row['amount']}  "
                    f"gl={'yes' if row['has_gl'] else 'no'}"
                )
            self.stdout.write(
                "  Review these in Aquaculture > Feeding; delete wrong expenses and re-apply with "
                "consume_pond_stock when feed was drawn from the pond warehouse."
            )

        no_exp = report["advice_applied_without_expense"]
        if no_exp:
            self.stdout.write("")
            self.stdout.write(
                self.style.WARNING(
                    f"Applied feeding advice with kg but no linked expense ({len(no_exp)}):"
                )
            )
            for row in no_exp:
                self.stdout.write(
                    f"  advice #{row['advice_id']} pond {row['pond_id']} {row['pond_name']!r}  "
                    f"kg={row['applied_kg']}  date={row['target_date']}"
                )

        if options["fix_gl"]:
            self.stdout.write("")
            self.stdout.write("Backfilling missing GL journals...")
            stats = backfill_pond_feed_gl_gaps(company_id)
            self.stdout.write(
                self.style.SUCCESS(
                    f"Posted pond={stats['pond_consumption']} shop={stats['shop_issue']} "
                    f"failed={stats['failed']}"
                )
            )

        if options["return_feed"]:
            if not feed_stock:
                self.stdout.write("Nothing to return.")
                return
            self.stdout.write("")
            self.stdout.write("Returning pond feed to shop...")
            with transaction.atomic():
                actions = return_pond_feed_stock_to_shop(
                    company_id,
                    station_id=options.get("station_id"),
                    pond_id=options.get("pond_id"),
                )
            for act in actions:
                self.stdout.write(
                    self.style.SUCCESS(
                        f"  {act['return_number']} pond {act['pond_id']} {act['pond_name']!r} "
                        f"-> station {act['station_id']}  lines={len(act['lines'])}"
                    )
                )
            if not actions:
                self.stdout.write("No returns created.")
