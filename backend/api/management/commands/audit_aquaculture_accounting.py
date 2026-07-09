"""
Thorough aquaculture + GL audit for VPS/live data.

Checks accounting rules:
  - Net profit = income − expenses (per pond and company)
  - Nursing ponds: transfer-out income ≈ expenses (unallocated cost gap)
  - Grow-out: transfer-in costs match transfer line cost_amount
  - Lease payments vs implied annual (area × rate)
  - Duplicate landlord payments (same pond/date/amount)
  - Missing auto-posted GL journals (gl_posting_audit)
  - Transfer line cost vs AUTO-AQ-FISH-XFER GL amount

Usage:
  python manage.py audit_aquaculture_accounting --company-id 2
  python manage.py audit_aquaculture_accounting --company-id 2 --json
  python manage.py audit_aquaculture_accounting --company-id 2 --fix-transfer-gl
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.core.management.base import BaseCommand
from django.db.models import Sum

from api.models import (
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquacultureLandlordLedgerEntry,
    AquaculturePond,
    Company,
    JournalEntry,
)
from api.services.aquaculture_data_bank_service import fiscal_period_for_end_date
from api.services.aquaculture_fish_transfer_gl_service import sync_aquaculture_fish_pond_transfer_gl
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.gl_posting_audit import audit_company_gl_gaps

MONEY = lambda d: Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _pond_implied_annual_lease(pond: AquaculturePond) -> Decimal | None:
    area = pond.leasing_area_decimal
    rate = pond.lease_price_per_decimal_per_year
    if area and rate:
        return MONEY(area * rate)
    return None


def _transfer_gl_amount(company_id: int, transfer_id: int) -> Decimal:
    je = JournalEntry.objects.filter(
        company_id=company_id,
        entry_number=f"AUTO-AQ-FISH-XFER-{transfer_id}",
        is_posted=True,
    ).first()
    if not je:
        return Decimal("0")
    return MONEY(
        je.lines.filter(debit__gt=0).aggregate(s=Sum("debit"))["s"] or Decimal("0")
    )


class Command(BaseCommand):
    help = "Audit aquaculture P&L, transfers, lease, and GL posting on live data."

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, default=2)
        parser.add_argument("--period-end", type=str, default="2026-06-30")
        parser.add_argument("--json", action="store_true")
        parser.add_argument(
            "--fix-transfer-gl",
            action="store_true",
            help="Repost AUTO-AQ-FISH-XFER GL where line costs differ from journal",
        )

    def handle(self, *args, **options):
        company_id = options["company_id"]
        company = Company.objects.filter(pk=company_id).first()
        if not company:
            self.stderr.write(self.style.ERROR(f"Company {company_id} not found"))
            return

        period_end = date.fromisoformat(options["period_end"])
        period_start, period_end = fiscal_period_for_end_date(company, period_end)
        if period_start > date(2025, 7, 1):
            period_start = date(2025, 7, 1)

        issues: list[dict] = []
        warnings: list[dict] = []

        pl = compute_aquaculture_pl_summary_dict(
            company_id, period_start, period_end, None, None, None, False
        )

        # 1) P&L formula per pond
        for row in pl.get("ponds") or []:
            pid = row["pond_id"]
            income = MONEY(row.get("income_total") or 0)
            expense = MONEY(row.get("expense_total") or 0)
            net = MONEY(row.get("net_profit") or 0)
            calc = MONEY(income - expense)
            if abs(calc - net) > Decimal("0.02"):
                issues.append(
                    {
                        "type": "pl_formula",
                        "pond_id": pid,
                        "pond_name": row.get("pond_name"),
                        "detail": f"net {net} != income {income} - expense {expense} (= {calc})",
                    }
                )

        # 2) Nursing pond transfer balance
        for pond in AquaculturePond.objects.filter(company_id=company_id, pond_role="nursing"):
            row = next((r for r in pl["ponds"] if r["pond_id"] == pond.id), {})
            income = MONEY(row.get("income_total") or 0)
            expense = MONEY(row.get("expense_total") or 0)
            net = MONEY(row.get("net_profit") or 0)
            gap = MONEY(expense - income)
            xfer_out = AquacultureFishPondTransferLine.objects.filter(
                transfer__from_pond_id=pond.id,
                transfer__transfer_date__gte=period_start,
                transfer__transfer_date__lte=period_end,
            ).count()
            entry = {
                "type": "nursing_pl_gap",
                "pond_id": pond.id,
                "pond_code": pond.code,
                "pond_name": pond.name,
                "income": str(income),
                "expense": str(expense),
                "net": str(net),
                "gap_expense_minus_income": str(gap),
                "fy_transfer_lines_out": xfer_out,
            }
            if xfer_out == 0 and net < 0:
                entry["note"] = "Expected: fry/feed costs before first fingerling transfer out"
                warnings.append(entry)
            elif abs(net) <= Decimal("500"):
                continue
            elif net < Decimal("-500"):
                issues.append(entry)
            else:
                entry["note"] = "Transfer income exceeds nursing expenses (cost pool not fully allocated)"
                warnings.append(entry)

        # 3) Lease vs implied annual per grow-out pond
        for pond in AquaculturePond.objects.filter(company_id=company_id, pond_role="grow_out"):
            row = next((r for r in pl["ponds"] if r["pond_id"] == pond.id), {})
            lease_pl = MONEY(row.get("lease_cost") or 0)
            annual = _pond_implied_annual_lease(pond)
            if annual and lease_pl > annual + Decimal("10000"):
                issues.append(
                    {
                        "type": "lease_over_annual",
                        "pond_id": pond.id,
                        "pond_code": pond.code,
                        "lease_pl": str(lease_pl),
                        "implied_annual": str(annual),
                        "excess": str(MONEY(lease_pl - annual)),
                    }
                )
            elif annual and lease_pl < annual - Decimal("50000") and lease_pl > 0:
                warnings.append(
                    {
                        "type": "lease_under_annual",
                        "pond_id": pond.id,
                        "pond_code": pond.code,
                        "lease_pl": str(lease_pl),
                        "implied_annual": str(annual),
                    }
                )

        # 4) Duplicate landlord payments (same pond, date, amount)
        pay_rows = AquacultureLandlordLedgerEntry.objects.filter(
            landlord__company_id=company_id,
            kind=AquacultureLandlordLedgerEntry.KIND_PAYMENT,
            pond_id__isnull=False,
            entry_date__gte=period_start,
            entry_date__lte=period_end,
        ).order_by("pond_id", "entry_date", "id")
        seen: dict[tuple, list[int]] = defaultdict(list)
        for ent in pay_rows:
            key = (
                ent.pond_id,
                ent.entry_date.isoformat(),
                str(MONEY(abs(ent.amount_signed or 0))),
            )
            seen[key].append(ent.id)
        for key, ids in seen.items():
            if len(ids) > 1:
                issues.append(
                    {
                        "type": "duplicate_lease_payment",
                        "pond_id": key[0],
                        "entry_date": key[1],
                        "amount": key[2],
                        "entry_ids": ids,
                    }
                )

        # 5) Transfer line cost vs GL
        fix_gl = options["fix_transfer_gl"]
        for tr in AquacultureFishPondTransfer.objects.filter(company_id=company_id).order_by("id"):
            line_total = MONEY(
                sum(MONEY(ln.cost_amount or 0) for ln in tr.lines.all())
            )
            gl_amt = _transfer_gl_amount(company_id, tr.id)
            if line_total > 0 and abs(line_total - gl_amt) > Decimal("0.05"):
                entry = {
                    "type": "transfer_gl_mismatch",
                    "transfer_id": tr.id,
                    "transfer_date": tr.transfer_date.isoformat(),
                    "line_total": str(line_total),
                    "gl_amount": str(gl_amt),
                }
                if gl_amt > 0 and gl_amt < line_total:
                    entry["note"] = "Likely 1581 bio-asset GL cap at source pond (management cost > book balance)"
                    warnings.append(entry)
                else:
                    issues.append(entry)
                if fix_gl:
                    r = sync_aquaculture_fish_pond_transfer_gl(company_id, tr)
                    if r.get("posted"):
                        warnings.append(
                            {
                                "type": "transfer_gl_fixed",
                                "transfer_id": tr.id,
                                "amount": str(r.get("total_gl_amount")),
                            }
                        )

        # 6) Grow-out transfer-in vs lines
        for pond in AquaculturePond.objects.filter(company_id=company_id, pond_role="grow_out"):
            row = next((r for r in pl["ponds"] if r["pond_id"] == pond.id), {})
            t_in = MONEY(row.get("fish_transfer_cost_in") or 0)
            line_sum = MONEY(
                sum(
                    MONEY(ln.cost_amount or 0)
                    for ln in AquacultureFishPondTransferLine.objects.filter(
                        to_pond_id=pond.id,
                        transfer__transfer_date__gte=period_start,
                        transfer__transfer_date__lte=period_end,
                    )
                )
            )
            if abs(t_in - line_sum) > Decimal("0.05"):
                issues.append(
                    {
                        "type": "transfer_in_mismatch",
                        "pond_id": pond.id,
                        "pond_code": pond.code,
                        "pl_transfer_in": str(t_in),
                        "line_sum": str(line_sum),
                    }
                )

        # 7) GL posting gaps
        gl_audit = audit_company_gl_gaps(company_id)
        for gt, rows in gl_audit.get("gaps_by_type", {}).items():
            for row in rows[:50]:
                issues.append(
                    {
                        "type": "gl_gap",
                        "gap_type": gt,
                        "record_id": row.get("record_id"),
                        "label": row.get("label"),
                        "expected": row.get("expected_entry_number"),
                        "amount": row.get("amount"),
                    }
                )

        # 8) Company totals vs pond sum
        gt = pl.get("totals") or {}
        sum_income = MONEY(sum(MONEY(r.get("income_total") or 0) for r in pl.get("ponds") or []))
        sum_exp = MONEY(sum(MONEY(r.get("expense_total") or 0) for r in pl.get("ponds") or []))
        co_income = MONEY(gt.get("total_income") or 0)
        co_exp = MONEY(gt.get("total_costs_and_expenses") or 0)
        if abs(sum_income - co_income) > Decimal("0.05"):
            issues.append(
                {
                    "type": "company_income_mismatch",
                    "pond_sum": str(sum_income),
                    "company_total": str(co_income),
                }
            )
        if abs(sum_exp - co_exp) > Decimal("0.05"):
            issues.append(
                {
                    "type": "company_expense_mismatch",
                    "pond_sum": str(sum_exp),
                    "company_total": str(co_exp),
                }
            )

        report = {
            "company_id": company_id,
            "company_name": company.name,
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "pond_pl": [
                {
                    "pond_id": r["pond_id"],
                    "pond_name": r.get("pond_name"),
                    "role": AquaculturePond.objects.filter(pk=r["pond_id"]).values_list("pond_role", flat=True).first(),
                    "income": r.get("income_total"),
                    "expense": r.get("expense_total"),
                    "net": r.get("net_profit"),
                }
                for r in pl.get("ponds") or []
            ],
            "issues": issues,
            "warnings": warnings,
            "issue_count": len(issues),
            "warning_count": len(warnings),
            "gl_gap_total": gl_audit.get("total_gaps", 0),
        }

        if options["json"]:
            self.stdout.write(json.dumps(report, indent=2))
            return

        self.stdout.write(
            f"Aquaculture audit — {company.name!r} (id={company_id}) "
            f"{period_start} .. {period_end}"
        )
        self.stdout.write("")
        self.stdout.write("=== Pond P&L ===")
        for p in report["pond_pl"]:
            self.stdout.write(
                f"  {p['pond_name']!r} ({p['role']}): income={p['income']} "
                f"expense={p['expense']} net={p['net']}"
            )
        self.stdout.write("")
        if issues:
            self.stdout.write(self.style.ERROR(f"ISSUES ({len(issues)}):"))
            for i in issues:
                self.stdout.write(f"  [{i['type']}] {i}")
        else:
            self.stdout.write(self.style.SUCCESS("No critical issues."))
        if warnings:
            self.stdout.write(self.style.WARNING(f"WARNINGS ({len(warnings)}):"))
            for w in warnings[:30]:
                self.stdout.write(f"  [{w['type']}] {w}")
        self.stdout.write("")
        self.stdout.write(f"GL posting gaps: {gl_audit.get('total_gaps', 0)}")
