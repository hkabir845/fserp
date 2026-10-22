"""Reconcile posted accounting dimensions to the saved bill Charge-to allocations."""
import json
from datetime import date

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from api.models import Bill, JournalEntry, Payment, PaymentBillAllocation
from api.services.gl_posting import resync_posted_bill_journal_from_lines
from api.exceptions import GlPostingError


class Command(BaseCommand):
    help = "Preview accounting entity corrections from saved bill Charge to; --apply writes them."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument("--through", type=date.fromisoformat, required=True)
        parser.add_argument("--bill-id", type=int, action="append")
        parser.add_argument("--apply", action="store_true")

    @transaction.atomic
    def handle(self, *args, **options):
        bills = Bill.objects.filter(company_id=options["company_id"], bill_date__lte=options["through"])
        if options["bill_id"]:
            bills = bills.filter(pk__in=options["bill_id"])
            if bills.count() != len(set(options["bill_id"])):
                raise CommandError("Bill ids must belong to this company and date range")
        changes = []
        skipped = []
        for bill in bills.order_by("id"):
            entry = JournalEntry.objects.filter(
                company_id=bill.company_id, entry_number=f"AUTO-BILL-{bill.id}", is_posted=True,
            ).first()
            if entry is None:
                continue
            before = self._bill_snapshot(entry, bill)
            try:
                if not resync_posted_bill_journal_from_lines(bill.company_id, bill.id, preserve_accounts=True):
                    continue
            except GlPostingError as exc:
                skipped.append({"bill_id": bill.id, "bill_number": bill.bill_number, "reason": str(exc)})
                continue
            entry.refresh_from_db()
            after = self._bill_snapshot(entry, bill)
            if before != after:
                changes.append({"bill_id": bill.id, "bill_number": bill.bill_number,
                                "before": before, "after": after})
        self.stdout.write(json.dumps({"mode": "apply" if options["apply"] else "dry-run",
                                      "changed_bill_count": len(changes), "changes": changes,
                                      "skipped_bill_count": len(skipped), "skipped_bills": skipped}, indent=2))
        if not options["apply"]:
            transaction.set_rollback(True)

    def _snapshot(self, entry):
        return {"header_station_id": entry.station_id, "lines": [
            {key: str(value) if key in ("debit", "credit") else value for key, value in row.items()}
            for row in entry.lines.order_by("id").values(
                "account_id", "debit", "credit", "station_id", "aquaculture_pond_id",
                "aquaculture_production_cycle_id", "aquaculture_cost_bucket",
                "tenant_reporting_category_id", "fuel_station_expense_rollup",
            )
        ]}

    def _bill_snapshot(self, entry, bill):
        payment_ids = PaymentBillAllocation.objects.filter(
            bill_id=bill.id, payment__company_id=bill.company_id,
        ).values_list("payment_id", flat=True)
        numbers = [f"AUTO-PAY-{pk}-MADE" for pk in payment_ids]
        return {"bill_journal": self._snapshot(entry), "payment_register_stations": dict(
            Payment.objects.filter(pk__in=payment_ids, company_id=bill.company_id).values_list("id", "station_id")
        ), "payment_journals": {
            payment.entry_number: self._snapshot(payment)
            for payment in JournalEntry.objects.filter(
                company_id=bill.company_id, entry_number__in=numbers, is_posted=True,
            ).order_by("id")
        }}
