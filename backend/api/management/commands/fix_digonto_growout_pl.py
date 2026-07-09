"""
Correct Digonto grow-out (P04) P&L on VPS/live DB:
  1. Reset inflated P05→P04/P02 fingerling transfer line costs and repost GL
  2. Remove duplicate landlord lease payments over the FY target for Digonto

Usage (backend/, venv active):
  python manage.py fix_digonto_growout_pl --dry-run
  python manage.py fix_digonto_growout_pl --company-id 2
"""
from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import F, Value
from django.db.models.functions import Greatest

from api.models import (
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquacultureLandlordLedgerEntry,
    AquaculturePond,
    Company,
)
from api.services.aquaculture_data_bank_service import fiscal_period_for_end_date
from api.services.aquaculture_fish_transfer_gl_service import sync_aquaculture_fish_pond_transfer_gl
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.gl_posting import delete_landlord_lease_payment_journal

P04_TRANSFER_COST = Decimal("123913.98")
LEASE_FY_TARGET = Decimal("676500.00")
# Erroneous/duplicate Digonto lease payments identified on VPS (sum = 174,000 BDT).
LEASE_REMOVE_IDS = (111, 112, 116, 88, 89, 84, 82, 29)


def _money(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _pond_pl_row(company_id: int, pond_id: int, start: date, end: date) -> dict:
    payload = compute_aquaculture_pl_summary_dict(
        company_id, start, end, pond_id, None, None, include_cycle_breakdown=False
    )
    for row in payload.get("ponds") or []:
        if row.get("pond_id") == pond_id:
            return row
    return {}


def _reverse_lease_paid(company_id: int, ent: AquacultureLandlordLedgerEntry) -> None:
    if ent.applies_to_lease_paid and ent.pond_id and ent.lease_paid_delta is not None:
        dec = _money(Decimal(str(ent.lease_paid_delta)))
        AquaculturePond.objects.filter(pk=ent.pond_id, company_id=company_id).update(
            lease_paid_to_landlord=Greatest(
                F("lease_paid_to_landlord") - dec,
                Value(Decimal("0")),
            )
        )


def _lease_payment_ids_to_trim(
    company_id: int,
    pond_id: int,
    start: date,
    end: date,
    target: Decimal,
) -> list[int]:
    ents = AquacultureLandlordLedgerEntry.objects.filter(
        landlord__company_id=company_id,
        pond_id=pond_id,
        kind=AquacultureLandlordLedgerEntry.KIND_PAYMENT,
        entry_date__gte=start,
        entry_date__lte=end,
        bank_account_id__isnull=False,
        pk__in=LEASE_REMOVE_IDS,
    ).order_by("-entry_date", "-id")
    return [ent.id for ent in ents]


class Command(BaseCommand):
    help = "Fix Digonto grow-out P04 transfer costs and excess lease payments."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, default=2)
        parser.add_argument("--pond-code", type=str, default="P04")
        parser.add_argument("--nursing-code", type=str, default="P05")
        parser.add_argument("--lease-target", type=str, default=str(LEASE_FY_TARGET))
        parser.add_argument("--period-end", type=str, default="2026-06-30")
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        company_id = options["company_id"]
        company = Company.objects.filter(pk=company_id).first()
        if not company:
            self.stderr.write(self.style.ERROR(f"Company {company_id} not found"))
            return

        grow = AquaculturePond.objects.filter(company_id=company_id, code__iexact=options["pond_code"]).first()
        nursing = AquaculturePond.objects.filter(company_id=company_id, code__iexact=options["nursing_code"]).first()
        if not grow or not nursing:
            self.stderr.write(self.style.ERROR("P04/P05 ponds not found"))
            return

        period_end = date.fromisoformat(options["period_end"])
        period_start, period_end = fiscal_period_for_end_date(company, period_end)
        if period_start > date(2025, 7, 1):
            period_start = date(2025, 7, 1)

        lease_target = _money(Decimal(options["lease_target"]))
        dry = options["dry_run"]

        self.stdout.write(
            f"Company {company_id} period {period_start}..{period_end} dry_run={dry}"
        )
        before = _pond_pl_row(company_id, grow.id, period_start, period_end)
        self.stdout.write(
            f"P04 before: income={before.get('income_total')} expense={before.get('expense_total')} "
            f"net={before.get('net_profit')} xfer_in={before.get('fish_transfer_cost_in')} "
            f"lease={before.get('lease_cost')}"
        )

        p04_line = (
            AquacultureFishPondTransferLine.objects.filter(
                transfer__company_id=company_id,
                transfer__from_pond_id=nursing.id,
                to_pond_id=grow.id,
                transfer__transfer_date__gte=period_start,
            )
            .select_related("transfer")
            .order_by("transfer__transfer_date", "id")
            .first()
        )
        if not p04_line:
            self.stderr.write(self.style.ERROR("No P05→P04 transfer line in period"))
            return

        p02_line = (
            AquacultureFishPondTransferLine.objects.filter(
                transfer__company_id=company_id,
                transfer__from_pond_id=nursing.id,
                transfer__transfer_date=p04_line.transfer.transfer_date,
            )
            .exclude(pk=p04_line.pk)
            .select_related("to_pond", "transfer")
            .first()
        )

        p04_fish = int(p04_line.fish_count or 0)
        p04_new = P04_TRANSFER_COST
        p02_new = None
        if p02_line and p04_fish > 0:
            p02_fish = int(p02_line.fish_count or 0)
            p02_new = _money(p04_new * Decimal(p02_fish) / Decimal(p04_fish))

        self.stdout.write(
            f"Transfer line #{p04_line.id} -> P04: {p04_line.cost_amount} -> {p04_new} (fish={p04_fish})"
        )
        if p02_line and p02_new is not None:
            self.stdout.write(
                f"Transfer line #{p02_line.id} -> {p02_line.to_pond.code}: "
                f"{p02_line.cost_amount} -> {p02_new}"
            )

        lease_remove_ids = _lease_payment_ids_to_trim(
            company_id, grow.id, period_start, period_end, lease_target
        )
        xfer_save = _money(Decimal(str(p04_line.cost_amount or 0)) - p04_new)
        lease_save = _money(
            sum(
                abs(Decimal(str(e.amount_signed or 0)))
                for e in AquacultureLandlordLedgerEntry.objects.filter(pk__in=lease_remove_ids)
            )
        )
        self.stdout.write(f"Lease payments to remove ({len(lease_remove_ids)}): {lease_remove_ids} (sum={lease_save})")
        self.stdout.write(f"Projected expense reduction: xfer={xfer_save} lease={lease_save}")
        proj_net = _money(
            Decimal(str(before.get("net_profit") or 0)) + xfer_save + lease_save
        )
        self.stdout.write(f"Projected net profit: {proj_net}")

        with transaction.atomic():
            if not dry:
                p04_line.cost_amount = p04_new
                p04_line.save(update_fields=["cost_amount"])
                if p02_line and p02_new is not None:
                    p02_line.cost_amount = p02_new
                    p02_line.save(update_fields=["cost_amount"])

                xfer_ids = {p04_line.transfer_id}
                if p02_line:
                    xfer_ids.add(p02_line.transfer_id)
                for tid in sorted(xfer_ids):
                    tr = AquacultureFishPondTransfer.objects.get(pk=tid)
                    r = sync_aquaculture_fish_pond_transfer_gl(company_id, tr)
                    self.stdout.write(
                        f"  GL xfer #{tid}: posted={r.get('posted')} amount={r.get('total_gl_amount')}"
                    )

                for eid in lease_remove_ids:
                    ent = AquacultureLandlordLedgerEntry.objects.filter(
                        pk=eid, landlord__company_id=company_id
                    ).first()
                    if not ent:
                        continue
                    self.stdout.write(
                        f"  Delete lease ent#{eid} {ent.entry_date} "
                        f"{_money(abs(Decimal(str(ent.amount_signed or 0))))} {ent.memo[:40] if ent.memo else ''}"
                    )
                    _reverse_lease_paid(company_id, ent)
                    delete_landlord_lease_payment_journal(company_id, ent.id)
                    ent.delete()

            after = _pond_pl_row(company_id, grow.id, period_start, period_end)
            self.stdout.write(
                f"P04 after: income={after.get('income_total')} expense={after.get('expense_total')} "
                f"net={after.get('net_profit')} xfer_in={after.get('fish_transfer_cost_in')} "
                f"lease={after.get('lease_cost')}"
            )

            if dry:
                transaction.set_rollback(True)
                self.stdout.write(self.style.WARNING("DRY RUN — rolled back"))

        self.stdout.write(self.style.SUCCESS("Done."))
