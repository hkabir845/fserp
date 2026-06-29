"""
Backfill missing auto-posted journal entries found by audit_gl_posting_gaps.

Usage:
  python manage.py backfill_gl_posting_gaps --company-id 1 --dry-run
  python manage.py backfill_gl_posting_gaps --company-id 1 --type vendor_payment_made
  python manage.py backfill_gl_posting_gaps --company-id 1 --type vendor_bill --type vendor_payment_made
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import (
    AquacultureExpense,
    AquacultureExpenseInventoryLine,
    AquacultureFishStockLedger,
    AquacultureLandlordLedgerEntry,
    BankDeposit,
    Bill,
    Company,
    FundTransfer,
    Invoice,
    Payment,
    PayrollRun,
)
from api.services.gl_posting import (
    GlPostingError,
    post_aquaculture_fish_stock_ledger_journal,
    post_aquaculture_manual_expense_journal,
    post_aquaculture_pond_feed_consumption_journal,
    post_aquaculture_shop_stock_issue_journal,
    post_bank_deposit_journal,
    post_bill_journal,
    post_fund_transfer_journal,
    post_payroll_salary,
    sync_invoice_gl,
    sync_landlord_lease_payment_journal,
    sync_payment_made_gl,
    sync_payment_received_gl,
)
from api.services.gl_posting_audit import GAP_FINDERS, audit_company_gl_gaps


class Command(BaseCommand):
    help = "Backfill missing AUTO-* journal entries for bills, payments, invoices, etc."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument(
            "--type",
            action="append",
            dest="gap_types",
            choices=list(GAP_FINDERS.keys()),
            help="Limit to gap type(s). Default: all.",
        )
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        company_id = options["company_id"]
        gap_types = options.get("gap_types")
        dry = options["dry_run"]

        if not Company.objects.filter(pk=company_id).exists():
            self.stderr.write(self.style.ERROR(f"Company {company_id} not found"))
            return

        report = audit_company_gl_gaps(company_id, gap_types=gap_types)
        if report["total_gaps"] == 0:
            self.stdout.write(self.style.SUCCESS("Nothing to backfill."))
            return

        if dry:
            self.stdout.write(self.style.WARNING("DRY RUN — no database changes"))

        posted = 0
        failed = 0

        for gt, rows in report["gaps_by_type"].items():
            for row in rows:
                rid = row["record_id"]
                label = row["label"]
                if dry:
                    self.stdout.write(f"Would backfill {gt} #{rid}: {label}")
                    continue
                ok, err = self._backfill_one(company_id, gt, rid)
                if ok:
                    posted += 1
                    self.stdout.write(self.style.SUCCESS(f"Posted {gt} #{rid}: {label}"))
                else:
                    failed += 1
                    self.stdout.write(self.style.ERROR(f"FAILED {gt} #{rid}: {err}"))

        if dry:
            self.stdout.write(f"Would attempt {report['total_gaps']} backfill(s).")
        else:
            self.stdout.write(
                self.style.SUCCESS(f"Backfill complete: {posted} posted, {failed} failed.")
            )

    def _backfill_one(self, company_id: int, gap_type: str, record_id: int) -> tuple[bool, str]:
        try:
            with transaction.atomic():
                if gap_type == "vendor_payment_made":
                    p = Payment.objects.filter(
                        pk=record_id, company_id=company_id, payment_type="made"
                    ).first()
                    if not p:
                        return False, "Payment not found"
                    sync_payment_made_gl(company_id, p)
                    return True, ""

                if gap_type == "customer_payment_received":
                    p = Payment.objects.filter(
                        pk=record_id, company_id=company_id, payment_type="received"
                    ).first()
                    if not p:
                        return False, "Payment not found"
                    sync_payment_received_gl(company_id, p)
                    return True, ""

                if gap_type == "vendor_bill":
                    bill = Bill.objects.filter(pk=record_id, company_id=company_id).first()
                    if not bill:
                        return False, "Bill not found"
                    post_bill_journal(company_id, bill)
                    return True, ""

                if gap_type == "invoice_sale":
                    inv = Invoice.objects.filter(pk=record_id, company_id=company_id).first()
                    if not inv:
                        return False, "Invoice not found"
                    sync_invoice_gl(company_id, inv)
                    return True, ""

                if gap_type == "aquaculture_landlord_payment":
                    ent = AquacultureLandlordLedgerEntry.objects.filter(
                        pk=record_id, landlord__company_id=company_id
                    ).first()
                    if not ent:
                        return False, "Landlord ledger entry not found"
                    _, gerr = sync_landlord_lease_payment_journal(company_id, ent)
                    if gerr:
                        return False, gerr
                    return True, ""

                if gap_type == "aquaculture_shop_issue":
                    exp = AquacultureExpense.objects.filter(
                        pk=record_id, company_id=company_id
                    ).first()
                    if not exp:
                        return False, "Aquaculture expense not found"
                    line_rows = [
                        (ln.item, ln.quantity)
                        for ln in AquacultureExpenseInventoryLine.objects.filter(
                            expense_id=exp.id
                        ).select_related("item")
                        if ln.item_id
                    ]
                    ok = post_aquaculture_shop_stock_issue_journal(
                        company_id,
                        exp.id,
                        exp.expense_date,
                        exp.source_station_id,
                        line_rows,
                    )
                    if not ok:
                        return False, "Could not post shop issue COGS (check 5120/1220 and item costs)"
                    return True, ""

                if gap_type == "aquaculture_pond_consumption":
                    exp = AquacultureExpense.objects.filter(
                        pk=record_id, company_id=company_id
                    ).first()
                    if not exp:
                        return False, "Aquaculture expense not found"
                    line_rows = [
                        (ln.item, ln.quantity)
                        for ln in AquacultureExpenseInventoryLine.objects.filter(
                            expense_id=exp.id
                        ).select_related("item")
                        if ln.item_id
                    ]
                    ok = post_aquaculture_pond_feed_consumption_journal(
                        company_id, exp.id, exp.expense_date, line_rows
                    )
                    if not ok:
                        return False, "Could not post pond consumption COGS"
                    return True, ""

                if gap_type == "aquaculture_manual_expense":
                    exp = AquacultureExpense.objects.filter(
                        pk=record_id, company_id=company_id
                    ).first()
                    if not exp:
                        return False, "Aquaculture expense not found"
                    ok = post_aquaculture_manual_expense_journal(
                        company_id, exp.id, exp.expense_date
                    )
                    if not ok:
                        return False, "Could not post pond cash expense (check funding account and 671x COA)"
                    return True, ""

                if gap_type == "aquaculture_fish_stock_ledger":
                    row = AquacultureFishStockLedger.objects.filter(
                        pk=record_id, company_id=company_id
                    ).select_related("pond").first()
                    if not row:
                        return False, "Fish stock ledger row not found"
                    pond_label = (
                        row.pond.pond_name if row.pond_id and row.pond else f"pond #{row.pond_id}"
                    )
                    is_write_down = row.entry_kind == "loss" or (
                        row.weight_kg_delta is not None and row.weight_kg_delta < 0
                    )
                    je = post_aquaculture_fish_stock_ledger_journal(
                        company_id,
                        row.id,
                        row.entry_date,
                        is_write_down=is_write_down,
                        book_value=row.book_value,
                        pond_label=pond_label,
                        line_memo=row.memo or "",
                        credit_opening_equity=False,
                    )
                    if not je:
                        return False, "Could not post fish stock ledger journal (check 1581/6726/4244)"
                    AquacultureFishStockLedger.objects.filter(pk=row.pk).update(journal_entry_id=je.id)
                    return True, ""

                if gap_type == "fund_transfer":
                    ft = FundTransfer.objects.filter(pk=record_id, company_id=company_id).first()
                    if not ft:
                        return False, "Fund transfer not found"
                    ok = post_fund_transfer_journal(company_id, ft)
                    if not ok:
                        return False, "Could not post (link bank registers to chart accounts)"
                    return True, ""

                if gap_type == "bank_deposit":
                    dep = BankDeposit.objects.filter(pk=record_id, company_id=company_id).first()
                    if not dep:
                        return False, "Bank deposit not found"
                    ok = post_bank_deposit_journal(company_id, dep)
                    if not ok:
                        return False, "Could not post bank deposit journal"
                    return True, ""

                if gap_type == "payroll_posted":
                    pr = PayrollRun.objects.filter(pk=record_id, company_id=company_id).first()
                    if not pr:
                        return False, "Payroll run not found"
                    je, err = post_payroll_salary(company_id, pr)
                    if not je:
                        return False, err or "Payroll journal not created"
                    return True, ""

                return False, f"Unknown gap type {gap_type}"
        except GlPostingError as e:
            return False, e.detail
        except Exception as e:
            return False, str(e)
