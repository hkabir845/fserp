"""
Thorough aquaculture + GL audit for VPS/live data.

Checks accounting rules (locked policy: docs/AQUACULTURE_ACCOUNTING_POLICY.md):
  - Net profit = income − expenses (per pond and company)
  - Nursing ponds: deficit is an issue; IPT surplus is accepted (Model A profit centre)
  - Grow-out: transfer-in matches sale/mirror amounts (same basis as P&L fish_transfer_cost_in)
  - Lease payments vs implied annual (area × rate) — cash-basis shortfall is accepted
  - Duplicate landlord payments (same pond/date/amount)
  - Missing auto-posted GL journals (gl_posting_audit)
  - Transfer priced lines must have AUTO-IPT invoice/bill journals (legacy XFER fallback)
  - Stale Cr 1581 > line cost is an issue (fix with --fix-transfer-gl); bio-asset cap is accepted
  - Bio-cap unrelieved share > 5% → ops warning (still accepted; investigate capitalization)
  - Book vs sample biomass bands (≤15% normal / 15–25% review / >25% investigate)

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

from api.models import (
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquacultureFishSale,
    AquacultureLandlordLedgerEntry,
    AquaculturePond,
    Company,
)
from api.services.aquaculture_accounting_policy import (
    BIO_CAP_POLICY,
    BIOMASS_DUAL_TRUTH_POLICY,
    NURSING_SURPLUS_POLICY,
    bio_cap_needs_ops_warning,
    biomass_divergence_ratio,
    classify_biomass_band,
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
    """
    Book cost relieved on the seller (Cr 1581) for this trade.

    Prefer AUTO-IPT invoice/bill journals; fall back to legacy AUTO-AQ-FISH-XFER until converted.
    """
    from api.services.aquaculture_fish_transfer_gl_service import transfer_gl_status

    status = transfer_gl_status(company_id, transfer_id)
    if status.get("gl_posted") and status.get("gl_total_amount") is not None:
        return MONEY(status["gl_total_amount"])
    return Decimal("0")


def _transfer_sale_posted(company_id: int, transfer_id: int) -> bool:
    """True when every priced line has both AUTO-IPT journals (or legacy transfer JE exists)."""
    from api.services.aquaculture_fish_transfer_gl_service import transfer_gl_status
    from api.services.aquaculture_internal_trade_posting import internal_trade_documents_posted

    lines = list(
        AquacultureFishPondTransferLine.objects.filter(transfer_id=transfer_id).only(
            "id", "sale_amount"
        )
    )
    priced = [ln for ln in lines if MONEY(ln.sale_amount or 0) > 0]
    if not priced:
        return False
    if all(internal_trade_documents_posted(company_id, transfer_id, ln.id) for ln in priced):
        return True
    return bool(transfer_gl_status(company_id, transfer_id).get("gl_posted"))


def _transfer_line_pl_amount(line: AquacultureFishPondTransferLine, mirror_amt: Decimal | None) -> Decimal:
    """
    Same amount basis as aquaculture_pl_service transfer-in: mirror total when present,
    else sale_amount, else cost_amount.
    """
    sale = MONEY(line.sale_amount or 0)
    cost = MONEY(line.cost_amount or 0)
    amount = sale if sale > 0 else cost
    if mirror_amt is not None and mirror_amt > 0:
        amount = mirror_amt
    return amount


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
        accepted: list[dict] = []

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
                # Model A: nursing ponds are profit centres; IPT surplus is accepted.
                entry["type"] = "nursing_profit_centre_surplus"
                entry["note"] = NURSING_SURPLUS_POLICY
                accepted.append(entry)

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
                accepted.append(
                    {
                        "type": "lease_under_annual",
                        "pond_id": pond.id,
                        "pond_code": pond.code,
                        "lease_pl": str(lease_pl),
                        "implied_annual": str(annual),
                        "shortfall": str(MONEY(annual - lease_pl)),
                        "note": (
                            "Accepted: P&L lease is cash-basis (landlord payments). "
                            "Shortfall vs area×rate is unpaid/installment timing, not a GL gap."
                        ),
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

        # 5) Transfer line cost vs GL + priced lines must have IPT journals
        fix_gl = options["fix_transfer_gl"]
        for tr in AquacultureFishPondTransfer.objects.filter(company_id=company_id).order_by("id"):
            line_total = MONEY(
                sum(MONEY(ln.cost_amount or 0) for ln in tr.lines.all())
            )
            sale_total = MONEY(
                sum(MONEY(ln.sale_amount or 0) for ln in tr.lines.all())
            )
            gl_amt = _transfer_gl_amount(company_id, tr.id)
            if sale_total > 0 and not _transfer_sale_posted(company_id, tr.id):
                entry = {
                    "type": "transfer_gl_missing",
                    "transfer_id": tr.id,
                    "transfer_date": tr.transfer_date.isoformat(),
                    "sale_total": str(sale_total),
                    "line_cost_total": str(line_total),
                    "note": "Priced inter-pond trade missing AUTO-IPT invoice/bill journals",
                }
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
            elif line_total > 0 and abs(line_total - gl_amt) > Decimal("0.05"):
                entry = {
                    "type": "transfer_gl_mismatch",
                    "transfer_id": tr.id,
                    "transfer_date": tr.transfer_date.isoformat(),
                    "line_total": str(line_total),
                    "gl_amount": str(gl_amt),
                }
                if gl_amt > 0 and gl_amt < line_total:
                    entry["type"] = "transfer_gl_bio_cap"
                    entry["note"] = BIO_CAP_POLICY
                    warn, share = bio_cap_needs_ops_warning(line_total, gl_amt)
                    if share is not None:
                        entry["unrelieved_share"] = str(share)
                        entry["unrelieved_amount"] = str(MONEY(line_total - gl_amt))
                    accepted.append(entry)
                    if warn:
                        warnings.append(
                            {
                                "type": "transfer_gl_bio_cap_ops",
                                "transfer_id": tr.id,
                                "transfer_date": tr.transfer_date.isoformat(),
                                "line_total": str(line_total),
                                "gl_amount": str(gl_amt),
                                "unrelieved_share": entry.get("unrelieved_share"),
                                "note": (
                                    "Ops: bio-cap unrelieved share > 5% of line cost — "
                                    "review inventoriable capitalization at source pond "
                                    "(cap itself remains correct policy)."
                                ),
                            }
                        )
                elif gl_amt > line_total:
                    entry["note"] = (
                        "Cr 1581 on IPT/legacy journals exceeds current line cost_amount — "
                        "stale GL after cost edit; review then --fix-transfer-gl"
                    )
                    issues.append(entry)
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

        # 6) Grow-out transfer-in vs lines (sale/mirror basis — matches P&L, not book cost)
        in_lines = list(
            AquacultureFishPondTransferLine.objects.filter(
                transfer__company_id=company_id,
                to_pond__pond_role="grow_out",
                transfer__transfer_date__gte=period_start,
                transfer__transfer_date__lte=period_end,
            ).select_related("to_pond")
        )
        mirror_amt_by_line = {
            int(row["source_fish_pond_transfer_line_id"]): MONEY(row["total_amount"] or 0)
            for row in AquacultureFishSale.objects.filter(
                company_id=company_id,
                source_fish_pond_transfer_line_id__in=[ln.id for ln in in_lines],
            ).values("source_fish_pond_transfer_line_id", "total_amount")
            if row["source_fish_pond_transfer_line_id"] is not None
        }
        line_sum_by_pond: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
        for ln in in_lines:
            line_sum_by_pond[int(ln.to_pond_id)] += _transfer_line_pl_amount(
                ln, mirror_amt_by_line.get(int(ln.id))
            )
        for pond in AquaculturePond.objects.filter(company_id=company_id, pond_role="grow_out"):
            row = next((r for r in pl["ponds"] if r["pond_id"] == pond.id), {})
            t_in = MONEY(row.get("fish_transfer_cost_in") or 0)
            line_sum = MONEY(line_sum_by_pond.get(pond.id, Decimal("0")))
            if abs(t_in - line_sum) > Decimal("0.05"):
                issues.append(
                    {
                        "type": "transfer_in_mismatch",
                        "pond_id": pond.id,
                        "pond_code": pond.code,
                        "pl_transfer_in": str(t_in),
                        "line_sum": str(line_sum),
                        "note": "Compared on sale/mirror amounts (P&L basis), not cost_amount",
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

        # 8) Company grand totals must match category columns (after IPT elimination).
        # Pond-row sums intentionally include inter-pond sales; do not equate them to company NI.
        gt = pl.get("pl_grand_totals") or pl.get("totals") or {}
        co_income = MONEY(gt.get("total_income") or 0)
        co_exp = MONEY(gt.get("total_costs_and_expenses") or 0)
        co_net = MONEY(gt.get("net_profit") or 0)
        if abs(MONEY(co_income - co_exp) - co_net) > Decimal("0.05"):
            issues.append(
                {
                    "type": "company_pl_formula",
                    "income": str(co_income),
                    "expense": str(co_exp),
                    "net": str(co_net),
                }
            )
        cat_income = MONEY(
            sum(
                MONEY(c.get("amount") or 0)
                for c in (pl.get("income_by_category") or [])
            )
        )
        cat_exp = MONEY(
            sum(
                MONEY(c.get("amount") or 0)
                for c in (pl.get("expenses_by_category") or [])
            )
        )
        if abs(cat_income - co_income) > Decimal("0.05"):
            issues.append(
                {
                    "type": "company_income_vs_categories",
                    "category_sum": str(cat_income),
                    "grand_total": str(co_income),
                }
            )
        if abs(cat_exp - co_exp) > Decimal("0.05"):
            issues.append(
                {
                    "type": "company_expense_vs_categories",
                    "category_sum": str(cat_exp),
                    "grand_total": str(co_exp),
                }
            )

        # 9) Biological sales missing production_cycle (null-cycle debt)
        from api.services.tenant_reporting_categories import (
            income_type_is_non_biological_for_company,
        )

        null_cycle = 0
        null_cycle_heads = 0
        for sale in AquacultureFishSale.objects.filter(
            company_id=company_id,
            production_cycle_id__isnull=True,
            sale_date__gte=period_start,
            sale_date__lte=period_end,
        ).only("id", "income_type", "fish_count", "pond_id"):
            if income_type_is_non_biological_for_company(company_id, sale.income_type):
                continue
            null_cycle += 1
            null_cycle_heads += int(sale.fish_count or 0)
        if null_cycle:
            issues.append(
                {
                    "type": "null_cycle_biological_sales",
                    "count": null_cycle,
                    "fish_count_sum": null_cycle_heads,
                    "detail": (
                        "Biological sales in period with no production_cycle_id — "
                        "retag before relying on cycle-scoped P&L / FCR."
                    ),
                }
            )

        # 10) Leftover AUTO-AQ-SALE-*-BIO on IPT mirrors (double Cr 1581)
        from api.services.aquaculture_ipt_bio_relief_cleanup_service import (
            find_ipt_double_bio_relief_journals,
        )

        ipt_bio = find_ipt_double_bio_relief_journals(company_id)
        if ipt_bio.get("count"):
            issues.append(
                {
                    "type": "ipt_double_bio_relief_journals",
                    "count": ipt_bio["count"],
                    "detail": (
                        "AUTO-AQ-SALE-*-BIO journals exist for IPT-mirrored sales; "
                        "run repair_aquaculture_ipt_double_bio --dry-run then apply."
                    ),
                    "sample_entry_numbers": [
                        j["entry_number"] for j in (ipt_bio.get("journals") or [])[:10]
                    ],
                }
            )

        # 11) Book vs sample biomass bands (dual-truth policy — not a GL defect)
        from api.services.aquaculture_partial_harvest import effective_biomass_kg_from_position_row
        from api.services.aquaculture_stock_service import compute_fish_stock_position_rows

        for pond in AquaculturePond.objects.filter(
            company_id=company_id, is_active=True
        ).only("id", "code", "name", "pond_role"):
            rows = compute_fish_stock_position_rows(company_id, pond_id=pond.id)
            if not rows:
                continue
            book = sum(
                (Decimal(str(r.get("implied_net_weight_kg") or 0)) for r in rows),
                Decimal("0"),
            )
            eff = sum(
                (effective_biomass_kg_from_position_row(r) for r in rows),
                Decimal("0"),
            )
            band = classify_biomass_band(book, eff)
            if band in ("skip", "normal"):
                continue
            ratio = biomass_divergence_ratio(book, eff)
            entry = {
                "type": "biomass_book_vs_sample",
                "pond_id": pond.id,
                "pond_code": pond.code,
                "pond_name": pond.name,
                "book_kg": str(book.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)),
                "effective_kg": str(eff.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)),
                "divergence_ratio": str(ratio) if ratio is not None else None,
                "band": band,
                "note": BIOMASS_DUAL_TRUTH_POLICY,
            }
            if band == "investigate":
                warnings.append(entry)
            else:
                # review band — still a warning for ops visibility
                warnings.append(entry)

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
            "accepted": accepted,
            "issue_count": len(issues),
            "warning_count": len(warnings),
            "accepted_count": len(accepted),
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
        if accepted:
            self.stdout.write(f"ACCEPTED ({len(accepted)}):")
            for a in accepted[:30]:
                self.stdout.write(f"  [{a['type']}] {a}")
        self.stdout.write("")
        self.stdout.write(f"GL posting gaps: {gl_audit.get('total_gaps', 0)}")
