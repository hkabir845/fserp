"""Assign explicitly reviewed expense lines to Head Office, including paid bills."""
import json
from collections import defaultdict
from datetime import date
from decimal import Decimal, InvalidOperation

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from api.exceptions import GlPostingError
from api.models import Bill, BillLine, JournalEntry, JournalEntryLine, Payment
from api.services.coa_constants import pl_bucket_for_coa
from api.services.gl_posting import resync_posted_bill_journal_from_lines


def line_spec(value):
    try:
        raw_id, raw_amount = value.split(":", 1)
        line_id, amount = int(raw_id), Decimal(raw_amount)
        if line_id <= 0 or not amount.is_finite() or amount <= 0:
            raise ValueError
        return line_id, amount
    except (ValueError, InvalidOperation):
        raise CommandError("Each --line must be LINE_ID:EXPECTED_AMOUNT with a positive amount")


def snapshot(entries):
    return [{"id": entry.id, "number": entry.entry_number, "date": entry.entry_date,
             "is_posted": entry.is_posted, "station_id": entry.station_id,
             "lines": list(entry.lines.order_by("id").values(
                 "account_id", "debit", "credit", "station_id", "aquaculture_pond_id",
             ))} for entry in entries]


def financial_signature(rows):
    result = []
    for row in rows:
        accounts = defaultdict(lambda: [Decimal(0), Decimal(0)])
        for line in row["lines"]:
            accounts[line["account_id"]][0] += line["debit"]
            accounts[line["account_id"]][1] += line["credit"]
        result.append((row["id"], row["date"], row["is_posted"],
                       sorted((key, *amounts) for key, amounts in accounts.items())))
    return result


class Command(BaseCommand):
    help = "Repair user-confirmed Head Office expense lines; requires exact date/amounts. Dry-run by default."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument("--on-date", type=date.fromisoformat, required=True)
        parser.add_argument("--line", action="append", type=line_spec, required=True,
                            help="Reviewed LINE_ID:EXPECTED_AMOUNT; repeat for each expense line")
        parser.add_argument("--apply", action="store_true")

    @transaction.atomic
    def handle(self, *args, **options):
        expected = dict(options["line"])
        if len(expected) != len(options["line"]):
            raise CommandError("Each bill line must be specified exactly once")
        cid = options["company_id"]
        # Use the same parent-before-child lock order as the accounting resync.
        bills = list(Bill.objects.select_for_update().filter(
            company_id=cid, lines__id__in=expected,
        ).order_by("id"))
        bills = list({bill.id: bill for bill in bills}.values())
        lines = list(BillLine.objects.select_for_update(of=("self",)).filter(
            bill__company_id=cid, id__in=expected,
        ).select_related("bill", "expense_account").order_by("id"))
        if len(lines) != len(expected):
            raise CommandError("Every reviewed line must exist and belong to the selected company")
        for line in lines:
            account = line.expense_account
            if line.bill.bill_date != options["on_date"] or line.amount != expected[line.id]:
                raise CommandError(f"Line {line.id}: date or amount differs from the reviewed record")
            if (line.bill.status not in ("open", "paid", "partial", "overdue")
                    or line.item_id or line.tank_id or line.aquaculture_pond_id
                    or line.aquaculture_production_cycle_id or line.aquaculture_cost_bucket
                    or account is None or account.company_id != cid
                    or pl_bucket_for_coa(account.account_type, account.account_sub_type,
                                         account.account_code) != "expense"):
                raise CommandError(f"Line {line.id}: only posted non-inventory, non-pond expense lines are supported")
        numbers = [f"AUTO-BILL-{bill.id}" for bill in bills]
        payments = Payment.objects.filter(company_id=cid, bill_allocations__bill_id__in=[b.id for b in bills])
        numbers += [f"AUTO-PAY-{pk}-MADE" for pk in payments.values_list("id", flat=True).distinct()]
        entries = list(JournalEntry.objects.select_for_update().filter(
            company_id=cid, entry_number__in=numbers,
        ).order_by("id"))
        for bill in bills:
            if not any(e.entry_number == f"AUTO-BILL-{bill.id}" and e.is_posted
                       and e.entry_date == bill.bill_date for e in entries):
                raise CommandError(f"{bill.bill_number}: matching posted bill journal not found")
        list(JournalEntryLine.objects.select_for_update().filter(
            journal_entry_id__in=[entry.id for entry in entries],
        ).order_by("id"))
        before = snapshot(entries)
        changes = []
        for line in lines:
            if not line.charge_to_head_office or line.receipt_station_id is not None:
                changes.append({"line_id": line.id, "bill_number": line.bill.bill_number,
                                "amount": line.amount, "before": {
                                    "charge_to_head_office": line.charge_to_head_office,
                                    "receipt_station_id": line.receipt_station_id,
                                }, "after": {"charge_to_head_office": True, "receipt_station_id": None}})
                line.charge_to_head_office = True
                line.receipt_station_id = None
                line.save(update_fields=["charge_to_head_office", "receipt_station"])
        try:
            for bill in bills:
                resync_posted_bill_journal_from_lines(cid, bill.id, preserve_accounts=True)
        except GlPostingError as exc:
            raise CommandError(str(exc)) from exc
        for entry in entries:
            entry.refresh_from_db()
        after = snapshot(entries)
        if financial_signature(before) != financial_signature(after):
            raise CommandError("Journal amounts, accounts, dates or posting states changed; rolling back")
        journal_changes = [{"before": old, "after": new}
                           for old, new in zip(before, after) if old != new]
        self.stdout.write(json.dumps({
            "mode": "apply" if options["apply"] else "dry-run", "company_id": cid,
            "on_date": options["on_date"], "changed_source_line_count": len(changes),
            "source_changes": changes, "changed_journal_count": len(journal_changes),
            "journal_changes": journal_changes, "financial_totals_unchanged": True,
        }, default=str, indent=2))
        if not options["apply"]:
            transaction.set_rollback(True)
