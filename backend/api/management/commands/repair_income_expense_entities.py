"""Preview/apply explicit historical bill and POS donation entity corrections."""
import json
from datetime import date

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from api.models import Bill, JournalEntry, Station


class Command(BaseCommand):
    help = "Repair entity tags only; dry-run by default. Does not change journal amounts."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument("--through", type=date.fromisoformat, required=True)
        parser.add_argument("--head-office-bill-number", action="append", default=[])
        parser.add_argument("--donation-station-id", type=int)
        parser.add_argument("--apply", action="store_true")

    @transaction.atomic
    def handle(self, *args, **options):
        cid = options["company_id"]
        through = options["through"]
        changes = []
        numbers = set(options["head_office_bill_number"])
        bills = list(Bill.objects.select_for_update().filter(
            company_id=cid, bill_number__in=numbers, bill_date__lte=through,
        ))
        if len(bills) != len(numbers):
            raise CommandError("Bill numbers must identify exactly one company bill each within the date range")
        for bill in bills:
            lines = list(bill.lines.select_for_update().all())
            if not lines or any(
                "head office" not in " ".join((line.description or "").lower().split())
                or line.aquaculture_pond_id is not None for line in lines
            ):
                raise CommandError(f"{bill.bill_number}: all lines must explicitly describe Head Office and have no pond")
            entry = JournalEntry.objects.select_for_update().filter(
                company_id=cid, entry_number=f"AUTO-BILL-{bill.id}", is_posted=True,
            ).first()
            if entry is None or entry.entry_date != bill.bill_date:
                raise CommandError(f"{bill.bill_number}: matching posted bill journal not found")
            journal_lines = list(entry.lines.select_for_update().all())
            if any(line.aquaculture_pond_id is not None for line in journal_lines):
                raise CommandError(f"{bill.bill_number}: journal has pond dimensions; refusing to overwrite")
            for obj, field in [(bill, "receipt_station_id"), (entry, "station_id")]:
                self._clear(obj, field, changes)
            for line in lines:
                self._clear(line, "receipt_station_id", changes)
                self._set(line, "charge_to_head_office", True, changes)
            for line in journal_lines:
                self._clear(line, "station_id", changes)

        station_id = options["donation_station_id"]
        if station_id is not None:
            if not Station.objects.filter(pk=station_id, company_id=cid, is_active=True).exists():
                raise CommandError("Donation station must be active and belong to this company")
            entries = JournalEntry.objects.select_for_update().filter(
                company_id=cid, is_posted=True, entry_date__lte=through,
                entry_number__startswith="AUTO-POS-DON-", station_id__isnull=True,
            )
            for entry in entries:
                lines = list(entry.lines.select_for_update().all())
                # Never replace an existing pond or another site's attribution.
                if any(line.aquaculture_pond_id is not None or line.station_id not in (None, station_id) for line in lines):
                    raise CommandError(f"{entry.entry_number}: conflicting entity tags")
                self._set(entry, "station_id", station_id, changes)
                for line in lines:
                    self._set(line, "station_id", station_id, changes)

        self.stdout.write(json.dumps({
            "mode": "apply" if options["apply"] else "dry-run",
            "company_id": cid, "through": through.isoformat(),
            "changed_field_count": len(changes), "changes": changes,
        }, indent=2))
        if not options["apply"]:
            transaction.set_rollback(True)

    def _clear(self, obj, field, changes):
        self._set(obj, field, None, changes)

    def _set(self, obj, field, value, changes):
        previous = getattr(obj, field)
        if previous == value:
            return
        changes.append({"model": obj._meta.label, "id": obj.pk,
                        "field": field, "before": previous, "after": value})
        setattr(obj, field, value)
        obj.save(update_fields=[field])
