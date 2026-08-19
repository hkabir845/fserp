"""
Move harvest bio-asset relief off the mortality account and onto cost of fish sold (5240).

Before account 5240 existed, finalizing a pond harvest relieved 1581 Biological Inventory against
6726 "Mortality, Predation & Shrinkage" - the only 1581-relief account there was. The ledger stayed
balanced, but the income statement read wrong in two ways: aquaculture revenue (4240-4243) carried
no cost of goods sold, so gross profit was overstated by the whole cost of the fish; and the
mortality line was inflated by every sale, making a healthy farm look like it was losing stock.

This re-posts AUTO-AQ-SALE-{id}-BIO for finalized sales so the relief lands on 5240. Amounts are
unchanged - only the expense account moves - so net income is identical before and after; what
changes is that gross profit and mortality finally mean what they say.

Usage:
  python manage.py repair_harvest_cost_of_sales --company-id 1 --dry-run
  python manage.py repair_harvest_cost_of_sales --company-id 1
  python manage.py repair_harvest_cost_of_sales --all-companies
"""
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Sum

from api.models import AquacultureFishSale, Company, JournalEntryLine

LEGACY_CODE = "6726"
TARGET_CODE = "5240"


class Command(BaseCommand):
    help = "Re-post aquaculture harvest relief from 6726 mortality to 5240 cost of fish sold."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int)
        parser.add_argument("--all-companies", action="store_true")
        parser.add_argument("--dry-run", action="store_true", help="Report without writing.")

    def handle(self, *args, **options):
        company_id = options.get("company_id")
        all_companies = bool(options.get("all_companies"))
        dry_run = bool(options.get("dry_run"))

        if not company_id and not all_companies:
            raise CommandError("Pass --company-id <id> or --all-companies.")

        if all_companies:
            company_ids = list(
                Company.objects.filter(is_deleted=False, aquaculture_enabled=True)
                .order_by("id")
                .values_list("id", flat=True)
            )
        else:
            if not Company.objects.filter(pk=company_id, is_deleted=False).exists():
                raise CommandError(f"Company {company_id} not found.")
            company_ids = [int(company_id)]

        grand_total = Decimal("0")
        grand_count = 0
        for cid in company_ids:
            moved, amount = self._repair_company(cid, dry_run=dry_run)
            grand_count += moved
            grand_total += amount

        verb = "Would move" if dry_run else "Moved"
        self.stdout.write(
            self.style.SUCCESS(
                f"{verb} {grand_count} harvest relief journal(s) totalling {grand_total} "
                f"from {LEGACY_CODE} to {TARGET_CODE}."
            )
        )

    def _repair_company(self, company_id: int, *, dry_run: bool) -> tuple[int, Decimal]:
        from api.services.aquaculture_sale_bio_relief_service import (
            sync_aquaculture_fish_sale_bio_relief,
        )

        # Only sales whose relief journal still debits the mortality account need repair.
        stale_sale_ids: list[int] = []
        for sale_id in (
            AquacultureFishSale.objects.filter(company_id=company_id)
            .exclude(invoice_id__isnull=True)
            .order_by("id")
            .values_list("id", flat=True)
        ):
            legacy = JournalEntryLine.objects.filter(
                journal_entry__company_id=company_id,
                journal_entry__entry_number=f"AUTO-AQ-SALE-{sale_id}-BIO",
                journal_entry__is_posted=True,
                account__account_code=LEGACY_CODE,
                debit__gt=0,
            ).aggregate(t=Sum("debit"))["t"]
            if legacy:
                stale_sale_ids.append(int(sale_id))

        if not stale_sale_ids:
            self.stdout.write(f"Company {company_id}: nothing to repair.")
            return 0, Decimal("0")

        moved = 0
        total = Decimal("0")
        for sale_id in stale_sale_ids:
            sale = (
                AquacultureFishSale.objects.select_related("pond", "production_cycle")
                .filter(pk=sale_id, company_id=company_id)
                .first()
            )
            if not sale:
                continue
            if dry_run:
                amt = JournalEntryLine.objects.filter(
                    journal_entry__company_id=company_id,
                    journal_entry__entry_number=f"AUTO-AQ-SALE-{sale_id}-BIO",
                    account__account_code=LEGACY_CODE,
                    debit__gt=0,
                ).aggregate(t=Sum("debit"))["t"] or Decimal("0")
                self.stdout.write(f"  sale {sale_id}: would move {amt}")
                moved += 1
                total += Decimal(str(amt))
                continue

            result = sync_aquaculture_fish_sale_bio_relief(company_id, sale)
            if not result.get("posted"):
                self.stdout.write(
                    self.style.WARNING(
                        f"  sale {sale_id}: not re-posted ({result.get('basis_note') or 'no relief'})"
                    )
                )
                continue
            amt = Decimal(str(result.get("relief_amount") or "0"))
            self.stdout.write(f"  sale {sale_id}: moved {amt} to {TARGET_CODE}")
            moved += 1
            total += amt

        self.stdout.write(f"Company {company_id}: {moved} sale(s), {total}.")
        return moved, total
