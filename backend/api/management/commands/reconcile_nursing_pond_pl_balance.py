"""
Balance a nursing pond P&L by spreading unallocated batch cost to fingerling transfer lines.

When nursing expenses and inter-pond transfer income disagree, this command:
  1. Optionally resyncs batch transfer costs from the nursing cost pool
  2. Reprices lines (cost + company inter-pond margin/kg) and refreshes fish-sale
     mirrors — GL always re-applies that price rule, so sale_amount alone cannot stick
  3. Remeasures the P&L gap, then raises/lowers in-period ``cost_amount`` (by fish count)
     so that after the same reprice, income lands on expense
  4. Reprices, refreshes mirrors, and reposts transfer GL

Usage (from backend/, venv active):
  python manage.py reconcile_nursing_pond_pl_balance --pond-code P07 --dry-run
  python manage.py reconcile_nursing_pond_pl_balance --pond-code P07 --company-id 1
"""
from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import (
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquacultureFishSale,
    AquaculturePond,
    Company,
)
from api.services.aquaculture_data_bank_service import fiscal_period_for_end_date
from api.services.aquaculture_fish_transfer_as_sale import ensure_fish_sale_for_transfer_line
from api.services.aquaculture_fish_transfer_gl_service import sync_aquaculture_fish_pond_transfer_gl
from api.services.aquaculture_internal_transfer_price import apply_internal_prices_to_transfer
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.aquaculture_transfer_cost import resync_nursing_pond_transfer_costs

# Allow up to ৳1: cost/kg rate quantization (4 dp) can leave a few paisa vs expense.
_GAP_TOL = Decimal("1.00")


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
    """Positive = expense exceeds income (deficit); negative = surplus income."""
    income = _money_q(Decimal(str(row.get("income_total") or "0")))
    expense = _money_q(Decimal(str(row.get("expense_total") or "0")))
    return _money_q(expense - income)


def _pl_effective_amount(line: AquacultureFishPondTransferLine) -> Decimal:
    sale = _money_q(Decimal(str(line.sale_amount or "0")))
    if sale > 0:
        return sale
    return _money_q(Decimal(str(line.cost_amount or "0")))


def _transfer_lines_for_pond(
    company_id: int,
    pond_id: int,
    *,
    period_start: date | None = None,
    period_end: date | None = None,
):
    qs = AquacultureFishPondTransferLine.objects.filter(
        transfer__company_id=company_id,
        transfer__from_pond_id=pond_id,
    )
    if period_start is not None:
        qs = qs.filter(transfer__transfer_date__gte=period_start)
    if period_end is not None:
        qs = qs.filter(transfer__transfer_date__lte=period_end)
    return list(qs.select_related("transfer", "to_pond").order_by("transfer__transfer_date", "id"))


def _reprice_and_mirror(company_id: int, lines: list) -> set[int]:
    """Apply cost+margin pricing, refresh fish-sale mirrors. Returns touched transfer ids."""
    touched: set[int] = set()
    for ln in lines:
        touched.add(int(ln.transfer_id))
    for tid in sorted(touched):
        tr = AquacultureFishPondTransfer.objects.prefetch_related("lines").get(pk=tid)
        apply_internal_prices_to_transfer(company_id, tr)
        for line in tr.lines.select_related("to_pond", "transfer").all():
            ensure_fish_sale_for_transfer_line(line, transfer=tr)
    return touched


def _fish_weights(lines: list) -> list[tuple[object, int]]:
    return [(ln, int(ln.fish_count or 0)) for ln in lines if int(ln.fish_count or 0) > 0]


def _mirror_by_line_id(line_ids: list[int]) -> dict[int, AquacultureFishSale]:
    if not line_ids:
        return {}
    return {
        int(s.source_fish_pond_transfer_line_id): s
        for s in AquacultureFishSale.objects.filter(source_fish_pond_transfer_line_id__in=line_ids)
        if s.source_fish_pond_transfer_line_id is not None
    }


def _log_line_vs_mirror(stdout, lines: list) -> Decimal:
    """
    P&L income for invoiced IPT lines follows AquacultureFishSale.total_amount, not
    line.sale_amount. Stale mirrors understate income and make a naive gap raise overshoot.
    """
    mirrors = _mirror_by_line_id([int(ln.id) for ln in lines])
    line_sale_total = Decimal("0")
    mirror_total = Decimal("0")
    stale = 0
    for ln in lines:
        sale = _money_q(Decimal(str(ln.sale_amount or "0")))
        cost = _money_q(Decimal(str(ln.cost_amount or "0")))
        line_sale_total += sale if sale > 0 else cost
        mir = mirrors.get(int(ln.id))
        if mir is None:
            stdout.write(
                f"  line {ln.id}: cost={cost} sale={sale} mirror=MISSING"
            )
            stale += 1
            continue
        mir_amt = _money_q(Decimal(str(mir.total_amount or "0")))
        mirror_total += mir_amt
        drift = _money_q(sale - mir_amt) if sale > 0 else _money_q(cost - mir_amt)
        if abs(drift) > _GAP_TOL:
            stale += 1
        inv = f" invoice#{mir.invoice_id}" if mir.invoice_id else " (no invoice)"
        stdout.write(
            f"  line {ln.id}: cost={cost} sale={sale} mirror={mir_amt}{inv} drift={drift}"
        )
    stdout.write(
        f"Line vs mirror totals: line_pl={_money_q(line_sale_total)} "
        f"mirror={_money_q(mirror_total)} drift={_money_q(line_sale_total - mirror_total)} "
        f"stale_lines={stale}"
    )
    return _money_q(line_sale_total - mirror_total)


def _split_by_fish(total: Decimal, weighted: list[tuple[object, int]]) -> list[Decimal]:
    if not weighted:
        return []
    total_fish = sum(fc for _, fc in weighted)
    parts: list[Decimal] = []
    running = Decimal("0")
    for i, (_, fc) in enumerate(weighted):
        if i == len(weighted) - 1:
            parts.append(_money_q(total - running))
        else:
            part = _money_q(total * Decimal(fc) / Decimal(total_fish))
            running += part
            parts.append(part)
    return parts


def _distribute_cost_delta(
    lines: list,
    delta: Decimal,
) -> list[tuple[object, Decimal, Decimal]]:
    """
    Spread ``delta`` onto ``cost_amount`` by fish count.

    Sale is not set here — ``apply_internal_prices_to_transfer`` owns sale
    (cost + margin/kg), and GL re-runs that rule on every post.
    """
    active = _fish_weights(lines)
    if not active or delta == 0:
        return []

    parts = _split_by_fish(delta, active)
    changes: list[tuple[object, Decimal, Decimal]] = []
    for (ln, _), part in zip(active, parts):
        if part == 0:
            continue
        old_cost = _money_q(Decimal(str(ln.cost_amount or "0")))
        new_cost = _money_q(old_cost + part)
        if new_cost < 0:
            new_cost = Decimal("0.00")
        if new_cost == old_cost:
            continue
        changes.append((ln, old_cost, new_cost))
    return changes


class Command(BaseCommand):
    help = (
        "Balance nursing pond income vs expense by adjusting fingerling transfer "
        "cost_amount (period-scoped), repricing sale via the inter-pond margin rule, "
        "syncing IPT mirrors, and reposting GL."
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

            lines = _transfer_lines_for_pond(
                company_id, pond.id, period_start=period_start, period_end=period_end
            )
            self.stdout.write("Before reprice — line sale vs IPT mirror (P&L uses mirror when present):")
            _log_line_vs_mirror(self.stdout, lines)

            touched = _reprice_and_mirror(company_id, lines)
            self.stdout.write(
                f"Repriced + mirrored {len(lines)} line(s) across {len(touched)} transfer(s)"
            )

            # Reload after reprice mutated sale_amount.
            lines = _transfer_lines_for_pond(
                company_id, pond.id, period_start=period_start, period_end=period_end
            )
            self.stdout.write("After reprice/mirror — line vs mirror:")
            _log_line_vs_mirror(self.stdout, lines)

            row = _pond_pl_row(company_id, pond.id, period_start, period_end)
            gap = _pl_gap(row)
            self.stdout.write(
                f"After reprice/mirror: income={row.get('income_total')} expense={row.get('expense_total')} "
                f"net_profit={row.get('net_profit')} gap={gap}"
            )

            if abs(gap) <= _GAP_TOL:
                if not dry:
                    self._repost_gl(company_id, pond.id, period_start, period_end, only_ids=touched)
                self.stdout.write(self.style.SUCCESS("Pond P&L balanced after reprice/mirror."))
                if dry:
                    transaction.set_rollback(True)
                return

            total_xfer_cost = _money_q(
                sum((Decimal(str(ln.cost_amount or "0")) for ln in lines), Decimal("0"))
            )
            total_pl_amt = _money_q(sum((_pl_effective_amount(ln) for ln in lines), Decimal("0")))
            self.stdout.write(
                f"Outgoing transfer lines in period: {len(lines)}, "
                f"total cost_amount={total_xfer_cost}, total pl_effective={total_pl_amt}"
            )

            gap_before_distribute = gap
            changes = _distribute_cost_delta(lines, gap)
            if not changes:
                self.stderr.write(self.style.ERROR("No transfer lines in period to distribute gap to."))
                if dry:
                    transaction.set_rollback(True)
                return

            verb = "Raising cost" if gap > 0 else "Lowering cost"
            self.stdout.write(f"{verb} by {abs(gap)} across {len(changes)} line(s) (sale follows margin rule):")
            touched_transfer_ids: set[int] = set()
            for ln, old_cost, new_cost in changes:
                dest = ln.to_pond.code or ln.to_pond.name
                self.stdout.write(
                    f"  line {ln.id} xfer#{ln.transfer_id} -> {dest} fish={ln.fish_count}: "
                    f"cost {old_cost} -> {new_cost}"
                )
                ln.cost_amount = new_cost
                ln.save(update_fields=["cost_amount"])
                touched_transfer_ids.add(int(ln.transfer_id))

            _reprice_and_mirror(company_id, lines)
            lines = _transfer_lines_for_pond(
                company_id, pond.id, period_start=period_start, period_end=period_end
            )
            for ln in lines:
                if int(ln.transfer_id) in touched_transfer_ids:
                    self.stdout.write(
                        f"  line {ln.id}: sale now {_money_q(Decimal(str(ln.sale_amount or 0)))} "
                        f"(cost {_money_q(Decimal(str(ln.cost_amount or 0)))})"
                    )

            if not dry:
                gl_stats = self._repost_gl(
                    company_id, pond.id, period_start, period_end, only_ids=touched_transfer_ids
                )
                self.stdout.write(
                    f"GL repost: posted={gl_stats['posted']} skipped={gl_stats['skipped']}"
                )
                # GL re-applies internal prices; refresh mirrors one last time.
                lines = _transfer_lines_for_pond(
                    company_id, pond.id, period_start=period_start, period_end=period_end
                )
                _reprice_and_mirror(company_id, [ln for ln in lines if int(ln.transfer_id) in touched_transfer_ids])

            row = _pond_pl_row(company_id, pond.id, period_start, period_end)
            gap_after = _pl_gap(row)
            self.stdout.write(
                f"After adjustment: income={row.get('income_total')} expense={row.get('expense_total')} "
                f"net_profit={row.get('net_profit')} gap={gap_after}"
            )

            # Fail closed if we made the imbalance worse (classic stale-mirror overshoot).
            if abs(gap_after) > abs(gap_before_distribute) + _GAP_TOL:
                self.stderr.write(
                    self.style.ERROR(
                        f"Adjustment worsened gap ({gap_before_distribute} -> {gap_after}); rolling back."
                    )
                )
                transaction.set_rollback(True)
                return

            if dry:
                transaction.set_rollback(True)
                self.stdout.write(self.style.WARNING("DRY RUN — rolled back"))

        if abs(gap_after) <= _GAP_TOL:
            self.stdout.write(self.style.SUCCESS("Nursing pond P&L balanced."))
        else:
            self.stdout.write(
                self.style.WARNING(
                    f"Remaining gap {gap_after} — may need manual review "
                    "(other income/expense outside transfer lines, or GL caps)."
                )
            )

    def _repost_gl(
        self,
        company_id: int,
        pond_id: int,
        period_start: date,
        period_end: date,
        *,
        only_ids: set[int] | None = None,
    ) -> dict:
        transfers = AquacultureFishPondTransfer.objects.filter(
            company_id=company_id,
            from_pond_id=pond_id,
            transfer_date__gte=period_start,
            transfer_date__lte=period_end,
        ).prefetch_related("lines")
        if only_ids is not None:
            transfers = transfers.filter(id__in=only_ids)
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
