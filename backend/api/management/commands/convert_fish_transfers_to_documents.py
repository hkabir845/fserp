"""
Re-paper historical inter-pond fish transfers as invoices and bills.

Inter-pond fish movement is no longer a "transfer": the selling pond raises an invoice and the
buying pond records a bill, exactly as it would with any other counterparty. This command
converts the transfers that were recorded under the old model:

  1. prices every line at its cost per kg + the company's inter-pond margin (default 20 BDT/kg),
  2. raises the invoice/bill pair for each priced line,
  3. posts them through 1595 (see aquaculture_internal_trade_posting),
  4. removes the superseded AUTO-AQ-FISH-XFER journal so nothing is counted twice.

It moves no fish. The stock ledger, biomass samples and head counts already recorded those
movements; this changes only how the money is documented.

Net GL is designed to be unchanged by the conversion — the old transfer journal and the new
document pair produce the same balances apart from the two 1595 legs, which cancel company-wide.
The command proves it: it prints the trial balance and every affected account before and after,
and with --apply refuses to commit if company-level assets, liabilities or equity moved.

Usage:
  python manage.py convert_fish_transfers_to_documents --company-id 1              # dry run
  python manage.py convert_fish_transfers_to_documents --company-id 1 --apply
  python manage.py convert_fish_transfers_to_documents --company-id 1 --json
"""

import json
from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Sum

from api.models import (
    AquacultureFishPondTransfer,
    Bill,
    ChartOfAccount,
    Company,
    Invoice,
    JournalEntry,
    JournalEntryLine,
)
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
from api.services.aquaculture_fish_transfer_gl_service import (
    sync_aquaculture_fish_pond_transfer_gl,
)
from api.services.aquaculture_internal_trade_posting import internal_trade_documents_posted
from api.services.aquaculture_internal_transfer_price import internal_transfer_margin_per_kg

WATCHED_CODES = ("1581", "1585", "1595", "4245", "5245")


def _console_safe(text: str, stream) -> str:
    enc = getattr(stream, "encoding", None) or "utf-8"
    try:
        text.encode(enc)
    except (UnicodeEncodeError, LookupError):
        return text.encode(enc, "replace").decode(enc, "replace")
    return text


def _trial_balance(company_id: int) -> tuple[Decimal, Decimal]:
    agg = JournalEntryLine.objects.filter(
        journal_entry__company_id=company_id, journal_entry__is_posted=True
    ).aggregate(d=Sum("debit"), c=Sum("credit"))
    return (agg["d"] or Decimal("0")), (agg["c"] or Decimal("0"))


def _account_balances(company_id: int) -> dict[str, Decimal]:
    out: dict[str, Decimal] = {}
    for coa in ChartOfAccount.objects.filter(company_id=company_id, account_code__in=WATCHED_CODES):
        agg = JournalEntryLine.objects.filter(
            account_id=coa.id, journal_entry__is_posted=True
        ).aggregate(d=Sum("debit"), c=Sum("credit"))
        out[coa.account_code] = (agg["d"] or Decimal("0")) - (agg["c"] or Decimal("0"))
    return out


def _reported_totals(company_id: int) -> dict[str, Decimal]:
    """
    The company statements as a reader sees them — the figures the conversion must not move.

    Deliberately the reported numbers, not raw GL sums. Inter-pond margin legitimately lands in
    1581/4245/5245 in the ledger; consolidation removes it at render time (4245/5245 dropped from
    income, the unsold margin written down through 1585). So the ledger moves by the margin while
    the company's published profit and assets do not, and it is the published ones that must hold
    still. Per-pond results are expected to move: that is the entire point of the exercise.
    """
    from api.services.reporting import report_balance_sheet, report_income_statement

    start = date(2000, 1, 1)
    end = date.today() + timedelta(days=365 * 5)
    pl = report_income_statement(company_id, start, end)
    bs = report_balance_sheet(company_id, start, end)
    return {
        "net_income": Decimal(str(pl["net_income"])),
        "income": Decimal(str(pl["income"]["total"])),
        "cost_of_goods_sold": Decimal(str(pl["cost_of_goods_sold"]["total"])),
        "expenses": Decimal(str(pl["expenses"]["total"])),
        "total_assets": Decimal(str(bs["assets"]["total"])),
        "total_liabilities": Decimal(str(bs["liabilities"]["total"])),
        "total_equity": Decimal(str(bs["equity"]["total"])),
    }


class Command(BaseCommand):
    help = "Convert inter-pond fish transfers into posted seller invoices and buyer bills."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Commit the conversion. Without it the command reports what it would do and rolls back.",
        )
        parser.add_argument(
            "--transfer-id",
            type=int,
            action="append",
            dest="transfer_ids",
            help="Convert only this transfer (repeatable). Default: every transfer for the company.",
        )
        parser.add_argument("--json", action="store_true", help="Machine-readable output.")

    def _say(self, msg: str) -> None:
        self.stdout.write(_console_safe(msg, self.stdout._out))

    def handle(self, *args, **opts):
        cid = opts["company_id"]
        company = Company.objects.filter(pk=cid).first()
        if not company:
            self.stderr.write(self.style.ERROR("No company with id %s" % cid))
            return

        margin = internal_transfer_margin_per_kg(cid)
        qs = AquacultureFishPondTransfer.objects.filter(company_id=cid).order_by("id")
        if opts.get("transfer_ids"):
            qs = qs.filter(id__in=opts["transfer_ids"])
        transfers = list(qs)

        before_tb = _trial_balance(cid)
        before_accounts = _account_balances(cid)
        before_eq = _reported_totals(cid)

        result: dict = {
            "company_id": cid,
            "company": company.name,
            "margin_per_kg": str(margin),
            "applied": bool(opts["apply"]),
            "transfers": [],
        }

        try:
            with transaction.atomic():
                # 1581/1585/1595/4245/5245 carry inter-pond trade; seed any the tenant is missing
                # so the conversion cannot silently post nothing.
                seeded = ensure_aquaculture_chart_accounts(cid)
                result["chart_accounts_created"] = seeded
                for t in transfers:
                    row = {
                        "transfer_id": t.id,
                        "transfer_date": t.transfer_date.isoformat() if t.transfer_date else None,
                        "lines": [],
                    }
                    already = [
                        internal_trade_documents_posted(cid, t.id, lid)
                        for lid in t.lines.values_list("id", flat=True)
                    ]
                    if already and all(already):
                        # Already converted. Re-posting would recompute the cost relief against a
                        # 1581 balance this very conversion reduced, quietly shifting cost of sales
                        # between ponds, so a converted trade is left exactly as it is.
                        row["skipped_already_converted"] = True
                        row["documents_raised"] = 0
                        row["documents_skipped"] = []
                        row["legacy_transfer_journal_removed"] = True
                        for line in t.lines.select_related("to_pond").all():
                            row["lines"].append({
                                "line_id": line.id,
                                "posted": False,
                                "already_posted": True,
                                "reason": "already converted",
                                "weight_kg": str(line.weight_kg or 0),
                                "rate_per_kg": str(line.sale_rate_per_kg or 0),
                                "price": str(line.sale_amount or 0),
                                "cost": str(line.cost_amount or 0),
                            })
                        result["transfers"].append(row)
                        continue

                    # One code path for a new trade and an old one: the seam clears whatever the
                    # trade posted before (the retired transfer journal, or an earlier run of
                    # this command), prices the lines, raises the documents and posts them. That
                    # is what makes re-running this safe.
                    gl = sync_aquaculture_fish_pond_transfer_gl(cid, t)
                    row["lines_repriced"] = None
                    row["documents_raised"] = gl.get("documents", 0)
                    row["documents_skipped"] = gl.get("document_skips", [])
                    row["legacy_transfer_journal_removed"] = not JournalEntry.objects.filter(
                        company_id=cid, entry_number="AUTO-AQ-FISH-XFER-%d" % t.id
                    ).exists()

                    t.refresh_from_db()
                    by_line = {p.get("line_id"): p for p in (gl.get("lines") or [])}
                    for line in t.lines.select_related("to_pond").all():
                        posted = by_line.get(line.id) or {
                            "line_id": line.id,
                            "posted": False,
                            "reason": gl.get("reason") or "nothing to post for this line",
                        }
                        inv = Invoice.all_objects.filter(
                            internal_fish_transfer_line_id=line.id
                        ).values_list("invoice_number", flat=True).first()
                        bill = Bill.all_objects.filter(
                            internal_fish_transfer_line_id=line.id
                        ).values_list("bill_number", flat=True).first()
                        posted["invoice_number"] = inv
                        posted["bill_number"] = bill
                        posted["weight_kg"] = str(line.weight_kg or 0)
                        posted["rate_per_kg"] = str(line.sale_rate_per_kg or 0)
                        row["lines"].append(posted)
                    result["transfers"].append(row)

                after_tb = _trial_balance(cid)
                after_accounts = _account_balances(cid)
                after_eq = _reported_totals(cid)
                result["trial_balance_before"] = [str(before_tb[0]), str(before_tb[1])]
                result["trial_balance_after"] = [str(after_tb[0]), str(after_tb[1])]
                result["trial_balance_balanced"] = after_tb[0] == after_tb[1]
                result["accounts"] = {
                    code: {
                        "before": str(before_accounts.get(code, Decimal("0"))),
                        "after": str(after_accounts.get(code, Decimal("0"))),
                        "change": str(
                            after_accounts.get(code, Decimal("0"))
                            - before_accounts.get(code, Decimal("0"))
                        ),
                    }
                    for code in WATCHED_CODES
                }
                result["reported_totals"] = {
                    k: {
                        "before": str(before_eq[k]),
                        "after": str(after_eq[k]),
                        "change": str(after_eq[k] - before_eq[k]),
                    }
                    for k in before_eq
                }

                drift = {k: after_eq[k] - before_eq[k] for k in before_eq}
                material = {k: v for k, v in drift.items() if v != 0}
                result["company_totals_unchanged"] = not material

                if after_tb[0] != after_tb[1]:
                    raise RuntimeError(
                        "conversion left the trial balance out of balance by %s" % (after_tb[0] - after_tb[1])
                    )
                if material:
                    raise RuntimeError(
                        "conversion moved the company's reported statements, which a re-papering "
                        "must not do: %s" % ", ".join("%s %s" % (k, v) for k, v in material.items())
                    )
                if not opts["apply"]:
                    raise _DryRun()
        except _DryRun:
            result["note"] = "Dry run — nothing was saved. Re-run with --apply to commit."
        except RuntimeError as e:
            result["error"] = str(e)
            result["note"] = "Rolled back; no changes were saved."

        if opts["json"]:
            self.stdout.write(json.dumps(result, indent=2))
            return

        self._say("Inter-pond fish transfer conversion — %s (company %s)" % (company.name, cid))
        self._say("Margin applied: %s BDT per kg on top of each line's cost per kg" % margin)
        if result.get("chart_accounts_created"):
            self._say("Chart accounts created for inter-pond trade: %s" % result["chart_accounts_created"])
        self._say("")
        for row in result["transfers"]:
            self._say(
                "Transfer #%s  %s   documents=%s  retired transfer journal cleared=%s"
                % (
                    row["transfer_id"], row["transfer_date"],
                    row.get("documents_raised"), row.get("legacy_transfer_journal_removed"),
                )
            )
            for ln in row["lines"]:
                if ln.get("already_posted") and ln.get("reason") == "already converted":
                    self._say("    line %-5s already converted (%s / %s)" % (
                        ln["line_id"], ln.get("invoice_number") or "-", ln.get("bill_number") or "-"))
                elif ln.get("posted") or ln.get("already_posted"):
                    self._say(
                        "    line %-5s %-22s -> %-22s %8s kg @ %10s/kg   cost %12s  price %12s  margin %10s   %s / %s"
                        % (
                            ln["line_id"], ln.get("seller", "?")[:22], ln.get("buyer", "?")[:22],
                            ln.get("weight_kg"), ln.get("rate_per_kg"), ln.get("cost"),
                            ln.get("price"), ln.get("margin"),
                            ln.get("invoice_number") or "-", ln.get("bill_number") or "-",
                        )
                    )
                else:
                    self._say("    line %-5s not posted: %s" % (ln["line_id"], ln.get("reason")))
            for s in row.get("documents_skipped") or []:
                self._say("    skipped: %s" % s)

        self._say("")
        self._say("Trial balance  before D/C %s / %s   after %s / %s   balanced=%s" % (
            result["trial_balance_before"][0], result["trial_balance_before"][1],
            result["trial_balance_after"][0], result["trial_balance_after"][1],
            result.get("trial_balance_balanced"),
        ))
        for code, v in result["accounts"].items():
            self._say("  %-5s %18s -> %18s   change %s" % (code, v["before"], v["after"], v["change"]))
        self._say("")
        for k, v in result["reported_totals"].items():
            self._say("  reported %-19s %18s -> %18s   change %s" % (k, v["before"], v["after"], v["change"]))

        if result.get("error"):
            self.stdout.write(self.style.ERROR("\n%s" % result["error"]))
            self.stdout.write(self.style.ERROR(result.get("note", "")))
            return
        self._say("")
        if result.get("company_totals_unchanged"):
            self.stdout.write(self.style.SUCCESS(
                "The company's reported profit and balance sheet are unchanged — this is a "
                "re-papering, not a restatement. Per-pond results move, which is the point."
            ))
        if not opts["apply"]:
            self.stdout.write(self.style.WARNING(result.get("note", "")))
        else:
            self.stdout.write(self.style.SUCCESS("Applied."))


class _DryRun(Exception):
    """Internal: unwinds the transaction after a dry run."""
