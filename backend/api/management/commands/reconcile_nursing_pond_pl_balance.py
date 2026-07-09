"""
Balance a nursing pond P&L by spreading unallocated batch cost to fingerling transfer lines.

When nursing expenses exceed inter-pond transfer income (negative net profit), this command:
  1. Optionally resyncs batch transfer costs from the nursing cost pool
  2. Distributes any remaining gap across outgoing transfer lines (proportional to fish count)
  3. Reposts AUTO-AQ-FISH-XFER GL journals

Usage (from backend/, venv active):
  python manage.py reconcile_nursing_pond_pl_balance --pond-code P07 --dry-run
  python manage.py reconcile_nursing_pond_pl_balance --pond-code P07 --company-id 1
"""
from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import AquacultureFishPondTransfer, AquacultureFishPondTransferLine, AquaculturePond, Company
from api.services.aquaculture_data_bank_service import fiscal_period_for_end_date
from api.services.aquaculture_fish_transfer_gl_service import sync_aquaculture_fish_pond_transfer_gl
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.aquaculture_transfer_cost import resync_nursing_pond_transfer_costs


def _money_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _pond_pl_row(company_id: int, pond_id: int, start: date, end: date) -> dict:
    payload = compute_aquaculture_pl_summary_dict(
        company_id,
        start,
        end,
        pond_id,
        None,
        None,
        include_cycle_breakdown=False,
    )
    for row in payload.get("ponds") or []:
        if row.get("pond_id") == pond_id:
            return row
    return {}


def _pl_gap(row: dict) -> Decimal:
    income = _money_q(Decimal(str(row.get("income_total") or "0")))
    expense = _money_q(Decimal(str(row.get("expense_total") or "0")))
    return _money_q(expense - income)


def _transfer_lines_for_pond(company_id: int, pond_id: int):
    return list(
        AquacultureFishPondTransferLine.objects.filter(
            transfer__company_id=company_id,
            transfer__from_pond_id=pond_id,
        )
        .select_related("transfer", "to_pond")
        .order_by("transfer__transfer_date", "id")
    )


def _distribute_gap_to_lines(
    lines: list,
    gap: Decimal,
) -> list[tuple[object, Decimal, Decimal]]:
    """Return (line, old_cost, new_cost) for lines that change."""
    active = [ln for ln in lines if int(ln.fish_count or 0) > 0]
    if not active or gap <= 0:
        return []

    total_fish = sum(int(ln.fish_count or 0) for ln in active)
    if total_fish <= 0:
        return []

    bumps: list[Decimal] = []
    running = Decimal("0")
    for i, ln in enumerate(active):
        fc = int(ln.fish_count or 0)
        if i == len(active) - 1:
            bump = _money_q(gap - running)
        else:
            bump = _money_q(gap * Decimal(fc) / Decimal(total_fish))
            running += bump
        bumps.append(bump)

    changes: list[tuple[object, Decimal, Decimal]] = []
    for ln, bump in zip(active, bumps):
        old = _money_q(Decimal(str(ln.cost_amount or "0")))
        new = _money_q(old + bump)
        if new != old:
            changes.append((ln, old, new))
    return changes


class Command(BaseCommand):
    help = (
        "Balance nursing pond income vs expense by increasing fingerling transfer line costs "
        "and reposting GL."
    )

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, default=None, help="Company scope (auto if omitted)")
        parser.add_argument("--pond-code", type=str, required=True, help="Nursing pond code (e.g. P07)")
        parser.add_argument(
            "--period-start",
            type=str,
            default=None,
            help="P&L period start YYYY-MM-DD (default: company fiscal year containing period-end)",
        )
        parser.add_argument(
            "--period-end",
            type=str,
            default=None,
            help="P&L period end date YYYY-MM-DD (default: today)",
        )
        parser.add_argument(
            "--skip-resync",
            action="store_true",
            help="Skip batch cost resync; only distribute the measured gap",
        )
        parser.add_argument("--dry-run", action="store_true", help="Report only; no saves")

    def handle(self, *args, **options):
        pond_code = (options["pond_code"] or "").strip()
        if not pond_code:
            self.stderr.write(self.style.ERROR("--pond-code is required"))
            return

        company_id = options["company_id"]
        if company_id is None:
            company = (
                Company.objects.filter(custom_domain="mahasoftcorporation.com", is_deleted=False).first()
                or Company.objects.filter(subdomain="mahasoftcorporation", is_deleted=False).first()
                or Company.objects.filter(is_deleted=False, aquaculture_enabled=True).order_by("id").first()
            )
            if not company:
                self.stderr.write(self.style.ERROR("No company found; pass --company-id"))
                return
            company_id = company.id
        else:
            company = Company.objects.filter(pk=company_id).first()
            if not company:
                self.stderr.write(self.style.ERROR(f"Company {company_id} not found"))
                return

        pond = AquaculturePond.objects.filter(company_id=company_id, code__iexact=pond_code).first()
        if not pond:
            pond = AquaculturePond.objects.filter(
                company_id=company_id,
                name__icontains=pond_code,
                pond_role="nursing",
            ).first()
        if not pond:
            self.stderr.write(self.style.ERROR(f"Pond code {pond_code!r} not found for company {company_id}"))
            return

        period_end = date.today()
        if options["period_end"]:
            period_end = date.fromisoformat(options["period_end"])
        if options.get("period_start"):
            period_start = date.fromisoformat(options["period_start"])
        else:
            period_start, period_end = fiscal_period_for_end_date(company, period_end)

        dry = options["dry_run"]
        self.stdout.write(
            f"Company {company_id} ({company.name!r}), pond {pond.id} {pond.name!r} code={pond.code!r}, "
            f"period {period_start} .. {period_end}, dry_run={dry}"
        )

        row = _pond_pl_row(company_id, pond.id, period_start, period_end)
        if not row:
            self.stderr.write(self.style.ERROR("No P&L row returned for pond"))
            return

        gap = _pl_gap(row)
        self.stdout.write(
            f"Before: income={row.get('income_total')} expense={row.get('expense_total')} "
            f"net_profit={row.get('net_profit')} gap(expense-income)={gap}"
        )

        if gap <= Decimal("0.01"):
            self.stdout.write(self.style.SUCCESS("Pond P&L already balanced (gap <= 0.01)."))
            return

        gap_after = gap
        with transaction.atomic():
            if not options["skip_resync"]:
                n = resync_nursing_pond_transfer_costs(
                    company_id=company_id,
                    from_pond_id=pond.id,
                    from_production_cycle_id=None,
                    sync_gl=False,
                )
                self.stdout.write(f"Batch resync updated {n} transfer line(s)")

                row = _pond_pl_row(company_id, pond.id, period_start, period_end)
                gap = _pl_gap(row)
                self.stdout.write(
                    f"After resync: income={row.get('income_total')} expense={row.get('expense_total')} "
                    f"net_profit={row.get('net_profit')} gap={gap}"
                )

            if gap <= Decimal("0.01"):
                if not dry:
                    self._repost_gl(company_id, pond.id)
                self.stdout.write(self.style.SUCCESS("Balanced after resync."))
                if dry:
                    transaction.set_rollback(True)
                return

            lines = _transfer_lines_for_pond(company_id, pond.id)
            total_xfer_cost = _money_q(
                sum((Decimal(str(ln.cost_amount or "0")) for ln in lines), Decimal("0"))
            )
            self.stdout.write(f"Outgoing transfer lines: {len(lines)}, total cost_amount={total_xfer_cost}")

            changes = _distribute_gap_to_lines(lines, gap)
            if not changes:
                self.stderr.write(self.style.ERROR("No transfer lines to distribute gap to."))
                if dry:
                    transaction.set_rollback(True)
                return

            self.stdout.write(f"Distributing gap {gap} across {len(changes)} line(s):")
            for ln, old, new in changes:
                dest = ln.to_pond.code or ln.to_pond.name
                self.stdout.write(
                    f"  line {ln.id} xfer#{ln.transfer_id} -> {dest} fish={ln.fish_count}: "
                    f"{old} -> {new} (+{_money_q(new - old)})"
                )
                if not dry:
                    ln.cost_amount = new
                    ln.save(update_fields=["cost_amount"])

            if not dry:
                gl_stats = self._repost_gl(company_id, pond.id)
                self.stdout.write(
                    f"GL repost: posted={gl_stats['posted']} skipped={gl_stats['skipped']}"
                )

            row = _pond_pl_row(company_id, pond.id, period_start, period_end)
            if dry:
                income_before = _money_q(Decimal(str(row.get("income_total") or "0")))
                expense = _money_q(Decimal(str(row.get("expense_total") or "0")))
                gap_after = Decimal("0.00")
                self.stdout.write(
                    f"After adjustment (projected): income={_money_q(income_before + gap)} "
                    f"expense={expense} net_profit={gap_after}"
                )
            else:
                gap_after = _pl_gap(row)
                self.stdout.write(
                    f"After adjustment: income={row.get('income_total')} expense={row.get('expense_total')} "
                    f"net_profit={row.get('net_profit')} gap={gap_after}"
                )

            if dry:
                transaction.set_rollback(True)
                self.stdout.write(self.style.WARNING("DRY RUN — rolled back"))

        if gap_after <= Decimal("0.01"):
            self.stdout.write(self.style.SUCCESS("Nursing pond P&L balanced."))
        else:
            self.stdout.write(
                self.style.WARNING(f"Remaining gap {gap_after} — may need manual review or stock ledger fix.")
            )

    def _repost_gl(self, company_id: int, pond_id: int) -> dict:
        transfers = AquacultureFishPondTransfer.objects.filter(
            company_id=company_id,
            from_pond_id=pond_id,
        ).prefetch_related("lines")
        posted = 0
        skipped = 0
        for tr in transfers:
            result = sync_aquaculture_fish_pond_transfer_gl(company_id, tr)
            if result.get("posted"):
                posted += 1
                self.stdout.write(
                    self.style.SUCCESS(
                        f"  Transfer #{tr.id}: GL {result.get('journal_entry_number')} "
                        f"amount={result.get('total_gl_amount')}"
                    )
                )
            else:
                skipped += 1
                self.stdout.write(
                    self.style.WARNING(
                        f"  Transfer #{tr.id}: GL skipped ({result.get('reason')}) "
                        f"requested={result.get('total_requested')}"
                    )
                )
        return {"posted": posted, "skipped": skipped}
