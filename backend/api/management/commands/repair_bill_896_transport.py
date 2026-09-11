"""
One-off repair: BILL-896 missing mill transport (sack qty had no kg → 0 tons).
240 sacks × 25 kg = 6 t × 950 = 5,700 → payable 436,560.
"""

from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import F

from api.models import Bill, BillLine, Item, JournalEntry, JournalEntryLine, Vendor
from api.services.vendor_purchase_terms import sync_monthly_scheme_reserve


class Command(BaseCommand):
    help = "Repair BILL-896 mill transport credit (6 t × 950) and set Grower Feed sack kg."

    def handle(self, *args, **options):
        bill = Bill.objects.filter(bill_number="BILL-896").select_related("vendor").first()
        if not bill:
            self.stderr.write("BILL-896 not found")
            return

        with transaction.atomic():
            line = BillLine.objects.filter(bill=bill).select_related("item").first()
            if not line or not line.item_id:
                self.stderr.write("No item line on BILL-896")
                return

            item = Item.objects.filter(pk=line.item_id).first()
            if item and (item.content_weight_kg is None or item.content_weight_kg <= 0):
                item.content_weight_kg = Decimal("25")
                if not (item.unit or "").strip():
                    item.unit = "sack"
                item.save(update_fields=["content_weight_kg", "unit"])
                self.stdout.write(f"Set item {item.id} content_weight_kg=25")

            qty = Decimal(line.quantity)
            mrp = Decimal(line.mrp or 0)
            disc = Decimal(line.instant_discount_amount or 0)
            transport = Decimal("5700.00")
            gross = (qty * mrp).quantize(Decimal("0.01"))
            net = (gross - disc - transport).quantize(Decimal("0.01"))
            if net < 0:
                self.stderr.write(f"Net would be negative: {net}")
                return

            old_total = Decimal(bill.total or 0)
            if old_total == net and Decimal(line.transport_amount or 0) == transport:
                self.stdout.write("BILL-896 already has transport applied")
                return

            line.transport_amount = transport
            line.amount = net
            line.unit_price = (net / qty).quantize(Decimal("0.01")) if qty else Decimal("0")
            line.save(update_fields=["transport_amount", "amount", "unit_price"])

            bill.subtotal = net
            bill.total = net
            bill.save(update_fields=["subtotal", "total"])

            delta = (old_total - net).quantize(Decimal("0.01"))
            if bill.vendor_ap_incremented and bill.vendor_id and delta > 0:
                Vendor.objects.filter(pk=bill.vendor_id).update(
                    current_balance=F("current_balance") - delta
                )

            je = JournalEntry.objects.filter(
                company_id=bill.company_id, entry_number=f"AUTO-BILL-{bill.id}"
            ).first()
            if je:
                for jl in JournalEntryLine.objects.filter(journal_entry=je):
                    if jl.debit and jl.debit > 0:
                        JournalEntryLine.objects.filter(pk=jl.pk).update(debit=net)
                    if jl.credit and jl.credit > 0:
                        JournalEntryLine.objects.filter(pk=jl.pk).update(credit=net)

            if bill.vendor_id:
                vendor = Vendor.objects.filter(pk=bill.vendor_id).first()
                if vendor:
                    sync_monthly_scheme_reserve(bill.company_id, vendor, bill.bill_date)

        bill.refresh_from_db()
        line = BillLine.objects.filter(bill=bill).first()
        self.stdout.write(
            self.style.SUCCESS(
                f"BILL-896 total={bill.total} transport={line.transport_amount} "
                f"amount={line.amount} (expected 436560.00 / 5700.00)"
            )
        )
