"""Read-only source/journal/report audit across all dates and entities."""
import json
import re
from collections import defaultdict
from datetime import date
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Min, Max

from api.models import AquaculturePond, AquaculturePondPlOpening, Bill, Company, Invoice, JournalEntry, Payment, Station
from api.services.bill_list_allocations import bill_charge_to_amount, bill_line_entity_scope_key
from api.services.gl_posting import _invoice_line_pond_id
from api.services.reporting import _pl_bucket, report_income_expense_statement

ZERO = Decimal("0")
EPSILON = Decimal("0.02")


def journal_key(line, entry):
    if line.aquaculture_pond_id:
        return f"p:{line.aquaculture_pond_id}"
    station = line.station_id or entry.station_id
    return str(station) if station else "ho"


class Command(BaseCommand):
    help = "Read-only audit: source Charge to vs posted entities, report reconciliation, and suspect dates."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int)
        parser.add_argument("--start-date", type=date.fromisoformat)
        parser.add_argument("--end-date", type=date.fromisoformat)
        parser.add_argument("--summary", action="store_true", help="Omit detailed mismatched journal rows")

    def handle(self, *args, **options):
        companies = Company.objects.filter(is_deleted=False).order_by("id")
        if options["company_id"] is not None:
            companies = companies.filter(pk=options["company_id"])
            if not companies.exists():
                raise CommandError("Company not found")
        if options["start_date"] and options["end_date"] and options["start_date"] > options["end_date"]:
            raise CommandError("Start date must not exceed end date")
        output = [self.audit(company, options) for company in companies]
        if options["summary"]:
            for company in output:
                company.pop("issues", None)
        self.stdout.write(json.dumps({"read_only": True, "companies": output}, default=str, indent=2))

    def audit(self, company, options):
        entries = JournalEntry.objects.filter(company=company, is_posted=True)
        span = entries.aggregate(start=Min("entry_date"), end=Max("entry_date"))
        if not span["start"]:
            return {"company_id": company.id, "company_name": company.name, "posted_journal_count": 0}
        start = options["start_date"] or span["start"]
        end = options["end_date"] or span["end"]
        if start > end:
            raise CommandError("Resolved start date exceeds end date; provide an explicit --end-date")
        entries = entries.filter(entry_date__gte=start, entry_date__lte=end).prefetch_related("lines__account")
        bills = {bill.id: bill for bill in Bill.objects.filter(company=company).prefetch_related("lines__tank")}
        invoices = {invoice.id: invoice for invoice in Invoice.objects.filter(company=company).prefetch_related("lines")}
        payments = {payment.id: payment for payment in Payment.objects.filter(company=company).prefetch_related("bill_allocations")}
        pond_ids = set(AquaculturePond.objects.filter(company=company).values_list("id", flat=True))
        opening_pond_ids = set(AquaculturePondPlOpening.objects.filter(company=company).values_list("pond_id", flat=True))
        issues, dates, candidates = [], [], []
        for payment in payments.values():
            if start <= payment.payment_date <= end and payment.payment_date.year < 2000:
                dates.append({"type": "payment", "id": payment.id, "date": payment.payment_date,
                              "amount": payment.amount, "reference": payment.reference})
        for bill in bills.values():
            if not start <= bill.bill_date <= end:
                continue
            if bill.bill_date.year < 2000:
                dates.append({"type": "bill", "id": bill.id, "number": bill.bill_number, "date": bill.bill_date})
            for line in bill.lines.all():
                if "head office" in " ".join((line.description or "").lower().split()):
                    key = bill_line_entity_scope_key(line, bill)
                    candidates.append({"bill_id": bill.id, "bill_number": bill.bill_number,
                                       "line_id": line.id, "date": bill.bill_date, "description": line.description,
                                       "amount": line.amount, "charge_to": key,
                                       "needs_review": key != "ho"})
        for entry in entries:
            if entry.entry_date.year < 2000:
                dates.append({"type": "journal", "id": entry.id, "number": entry.entry_number, "date": entry.entry_date})
            debit = sum((line.debit for line in entry.lines.all()), ZERO)
            credit = sum((line.credit for line in entry.lines.all()), ZERO)
            if debit != credit:
                issues.append({"type": "unbalanced_journal", "journal": entry.entry_number,
                               "debit": debit, "credit": credit})
            opening = re.fullmatch(r"AUTO-POND-PL-OB-(\d+)", entry.entry_number or "")
            if opening:
                pond_id = int(opening[1])
                if pond_id not in pond_ids or pond_id not in opening_pond_ids:
                    issues.append({"type": "orphaned_pond_opening_journal", "journal": entry.entry_number,
                                   "description": entry.description, "date": entry.entry_date,
                                   "original_pond_id": pond_id, "pond_exists": pond_id in pond_ids,
                                   "source_openings_exist": pond_id in opening_pond_ids,
                                   "expense": sum((line.debit - line.credit for line in entry.lines.all()
                                                   if _pl_bucket(line.account) in ("expense", "cost_of_goods_sold")), ZERO)})
                elif any(line.aquaculture_pond_id != pond_id for line in entry.lines.all()):
                    issues.append({"type": "pond_opening_entity_mismatch", "journal": entry.entry_number,
                                   "expected_pond_id": pond_id})
            match = re.fullmatch(r"AUTO-BILL-(\d+)", entry.entry_number or "")
            if match and int(match[1]) in bills:
                bill = bills[int(match[1])]
                if bill.status in ("draft", "void"):
                    issues.append({"type": "posted_journal_for_inactive_bill", "bill_id": bill.id,
                                   "bill_number": bill.bill_number, "status": bill.status})
                keys = {bill_line_entity_scope_key(line, bill) for line in bill.lines.all()}
                expected = {}
                for key in keys:
                    scope = {"head_office": True} if key == "ho" else (
                        {"pond_id": int(key[2:])} if key.startswith("p:") else {"station_id": int(key)}
                    )
                    expected[key] = bill_charge_to_amount(bill, bill.total or ZERO, **scope)
                for side in ("debit", "credit"):
                    actual = defaultdict(lambda: ZERO)
                    for line in entry.lines.all():
                        actual[journal_key(line, entry)] += getattr(line, side)
                    expected_nonzero = {k: v for k, v in expected.items() if v}
                    actual_nonzero = {k: v for k, v in actual.items() if v}
                    if any(abs(expected_nonzero.get(k, ZERO) - actual_nonzero.get(k, ZERO)) > EPSILON
                           for k in expected_nonzero.keys() | actual_nonzero.keys()):
                        issues.append({"type": "bill_charge_to_mismatch", "bill_id": bill.id,
                                       "bill_number": bill.bill_number, "journal": entry.entry_number,
                                       "date": entry.entry_date, "side": side,
                                       "expected": expected_nonzero, "actual": actual_nonzero})
                if entry.entry_date != bill.bill_date:
                    issues.append({"type": "bill_journal_date_mismatch", "bill_id": bill.id,
                                   "bill_number": bill.bill_number, "bill_date": bill.bill_date,
                                   "journal_date": entry.entry_date})
            match = re.fullmatch(r"AUTO-INV-(\d+)-(SALE|COGS)", entry.entry_number or "")
            if match and int(match[1]) in invoices:
                invoice = invoices[int(match[1])]
                expected = set()
                for line in invoice.lines.all():
                    pond = _invoice_line_pond_id(company.id, line, invoice)
                    station = line.receipt_station_id or invoice.station_id
                    expected.add(f"p:{pond}" if pond else str(station) if station else "ho")
                actual = {journal_key(line, entry) for line in entry.lines.all() if _pl_bucket(line.account)}
                if expected and actual - expected:
                    issues.append({"type": "invoice_charge_to_mismatch", "invoice_id": invoice.id,
                                   "invoice_number": invoice.invoice_number, "journal": entry.entry_number,
                                   "expected_entities": sorted(expected), "actual_entities": sorted(actual)})
            match = re.fullmatch(r"AUTO-PAY-(\d+)-(MADE|RCV)", entry.entry_number or "")
            if match and int(match[1]) in payments:
                payment = payments[int(match[1])]
                if entry.entry_date != payment.payment_date:
                    issues.append({"type": "payment_journal_date_mismatch", "payment_id": payment.id,
                                   "payment_date": payment.payment_date, "journal_date": entry.entry_date})
                if match[2] == "MADE":
                    expected = defaultdict(lambda: ZERO)
                    allocated = ZERO
                    for allocation in payment.bill_allocations.all():
                        bill = bills.get(allocation.bill_id)
                        if bill is None:
                            continue
                        allocated += allocation.amount
                        for key in {bill_line_entity_scope_key(line, bill) for line in bill.lines.all()}:
                            scope = {"head_office": True} if key == "ho" else (
                                {"pond_id": int(key[2:])} if key.startswith("p:") else {"station_id": int(key)}
                            )
                            expected[key] += bill_charge_to_amount(bill, allocation.amount, **scope)
                    if payment.amount > allocated:
                        expected[str(payment.station_id) if payment.station_id else "ho"] += payment.amount - allocated
                    for side in ("debit", "credit"):
                        actual = defaultdict(lambda: ZERO)
                        for line in entry.lines.all():
                            actual[journal_key(line, entry)] += getattr(line, side)
                        if any(abs(expected.get(key, ZERO) - actual.get(key, ZERO)) > EPSILON
                               for key in expected.keys() | actual.keys()):
                            issues.append({"type": "payment_charge_to_mismatch", "payment_id": payment.id,
                                           "journal": entry.entry_number, "side": side,
                                           "expected": dict(expected), "actual": dict(actual)})

        combined = report_income_expense_statement(company.id, start, end)
        checks = []
        for side in ("income", "expense"):
            line_total = sum((Decimal(str(row[side])) for row in combined["lines"]), ZERO)
            checks.append({"check": f"all_{side}_lines_match_total",
                           "passed": abs(line_total - Decimal(combined[f"total_{side}"])) <= EPSILON})
        office = report_income_expense_statement(company.id, start, end, unscoped_dims=True)
        scopes = [("ho", office)]
        for station in Station.objects.filter(company=company):
            scopes.append((str(station.id), report_income_expense_statement(company.id, start, end, station_id=station.id)))
        for key, scoped in scopes:
            for side in ("income", "expense"):
                amount = sum((Decimal(str(row[side])) for row in combined["lines"]
                              if (row["entity_type"] == "unscoped" if key == "ho" else
                                  row["entity_type"] == "station" and row["entity_id"] == int(key))), ZERO)
                checks.append({"check": f"entity_{side}_matches_all", "entity": key,
                               "passed": abs(amount - Decimal(scoped[f"total_{side}"])) <= EPSILON})
        counts = defaultdict(int)
        for issue in issues:
            counts[issue["type"]] += 1
        return {"company_id": company.id, "company_name": company.name,
                "period": {"start": start, "end": end}, "posted_journal_count": entries.count(),
                "issue_counts": dict(counts), "issues": issues, "suspect_dates": dates,
                "head_office_description_checks": candidates,
                "head_office_report": {"income": office["total_income"], "expense": office["total_expense"],
                                       "lines": office["lines"]},
                "report_checks": checks,
                "note": "Description matches are review hints, not allocation instructions. Pond totals retain the existing internal-trade elimination policy."}
