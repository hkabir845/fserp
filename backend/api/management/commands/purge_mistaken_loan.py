"""
Purge one mistaken loan and its AUTO-LOAN-* journals only.

Does NOT delete Chart of Account accounts, other loans, or counterparty opening JEs.

  python manage.py purge_mistaken_loan --company-id 2 --loan-no LN-00001
  python manage.py purge_mistaken_loan --company-id 2 --loan-no LN-00001 --execute
"""
from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction


class Command(BaseCommand):
    help = "Remove one loan + its AUTO-LOAN journals (dry-run unless --execute)."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, required=True)
        parser.add_argument("--loan-no", type=str, required=True)
        parser.add_argument(
            "--execute",
            action="store_true",
            help="Actually delete. Default is dry-run (inspect only).",
        )

    def handle(self, *args, **options):
        from api.models import (
            AquacultureFinancingAllocation,
            Company,
            JournalEntry,
            Loan,
            LoanDisbursement,
            LoanInterestAccrual,
            LoanRepayment,
        )

        cid = int(options["company_id"])
        loan_no = (options["loan_no"] or "").strip()
        execute = bool(options["execute"])

        company = Company.objects.filter(pk=cid).first()
        if not company:
            raise CommandError(f"company_id={cid} not found")

        lo = Loan.objects.filter(company_id=cid, loan_no=loan_no).first()
        if not lo:
            raise CommandError(f"Loan {loan_no!r} not found for company {cid} ({company.name})")

        je_ids: set[int] = set()
        for d in lo.disbursements.all():
            if d.journal_entry_id:
                je_ids.add(int(d.journal_entry_id))
        for r in lo.repayments.all():
            if r.journal_entry_id:
                je_ids.add(int(r.journal_entry_id))
            if r.reversal_journal_entry_id:
                je_ids.add(int(r.reversal_journal_entry_id))
        for a in lo.interest_accruals.all():
            if a.journal_entry_id:
                je_ids.add(int(a.journal_entry_id))
            if a.reversal_journal_entry_id:
                je_ids.add(int(a.reversal_journal_entry_id))

        jes = list(JournalEntry.objects.filter(id__in=je_ids, company_id=cid).order_by("id"))
        bad = [j for j in jes if not (j.entry_number or "").startswith("AUTO-LOAN-")]
        if bad:
            raise CommandError(
                "Refusing: linked journal is not AUTO-LOAN-* — "
                + ", ".join(f"{j.id}:{j.entry_number}" for j in bad)
            )

        n_disp = lo.disbursements.count()
        n_repay = lo.repayments.count()
        n_accr = lo.interest_accruals.count()
        n_alloc = AquacultureFinancingAllocation.objects.filter(loan=lo).count()
        cp = lo.counterparty

        self.stdout.write(f"Company: id={cid} name={company.name}")
        self.stdout.write(
            f"Loan: id={lo.id} no={lo.loan_no} status={lo.status} "
            f"principal={lo.principal_amount} outstanding={lo.outstanding_principal}"
        )
        self.stdout.write(
            f"Counterparty: id={cp.id if cp else None} "
            f"name={(cp.display_name if cp else '')}  (kept — not deleted)"
        )
        self.stdout.write(
            f"Children: disbursements={n_disp} repayments={n_repay} "
            f"accruals={n_accr} aq_allocations={n_alloc}"
        )
        self.stdout.write(f"Journals to purge ({len(jes)}):")
        for j in jes:
            lines = list(j.lines.all())
            self.stdout.write(
                f"  JE id={j.id} {j.entry_number} date={j.entry_date} "
                f"posted={j.is_posted} lines={len(lines)}"
            )
            for ln in lines:
                self.stdout.write(
                    f"    {ln.account.account_code} {ln.account.account_name}: "
                    f"Dr {ln.debit} Cr {ln.credit}"
                )
        self.stdout.write(
            "COA account rows (2410/1160/1030/…) are NOT deleted — only this loan's journal lines."
        )

        if not execute:
            self.stdout.write(self.style.WARNING("Dry-run only. Re-run with --execute to delete."))
            return

        with transaction.atomic():
            AquacultureFinancingAllocation.objects.filter(loan=lo).delete()
            LoanInterestAccrual.objects.filter(loan=lo).delete()
            LoanRepayment.objects.filter(loan=lo).delete()
            LoanDisbursement.objects.filter(loan=lo).delete()
            lo.delete()
            # Cascade deletes JournalEntryLine via FK
            JournalEntry.objects.filter(id__in=[j.id for j in jes], company_id=cid).delete()

        still = Loan.objects.filter(company_id=cid, loan_no=loan_no).exists()
        left_jes = JournalEntry.objects.filter(id__in=je_ids, company_id=cid).count()
        if still or left_jes:
            raise CommandError(f"Purge incomplete: loan_exists={still} journals_left={left_jes}")

        self.stdout.write(self.style.SUCCESS(f"Purged {loan_no} and {len(jes)} AUTO-LOAN journal(s)."))
