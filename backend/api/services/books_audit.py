"""
Tenant books health checks: unbalanced journals, missing postings, subledger vs GL.

Complements ``gl_posting_audit`` (missing AUTO journals) with control-account
and integrity checks recommended in ACCOUNTING_AUDIT_BACKLOG.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from django.db.models import Count, Sum
from django.db.models.functions import Coalesce

from api.models import ChartOfAccount, JournalEntry, JournalEntryLine
from api.services.gl_posting_audit import audit_company_gl_gaps
from api.services.reporting import (
    report_ap_aging,
    report_ar_aging,
    report_inventory_sku_valuation,
)


def _d(v) -> Decimal:
    if v is None:
        return Decimal("0")
    return Decimal(str(v))


def find_unbalanced_journals(company_id: int, *, limit: int = 200) -> list[dict[str, Any]]:
    rows = (
        JournalEntryLine.objects.filter(journal_entry__company_id=company_id)
        .values("journal_entry_id", "journal_entry__entry_number", "journal_entry__is_posted")
        .annotate(
            debit=Coalesce(Sum("debit"), Decimal("0")),
            credit=Coalesce(Sum("credit"), Decimal("0")),
            line_count=Count("id"),
        )
        .order_by("journal_entry_id")
    )
    out: list[dict[str, Any]] = []
    for r in rows:
        diff = _d(r["debit"]) - _d(r["credit"])
        if abs(diff) <= Decimal("0.02"):
            continue
        out.append(
            {
                "journal_entry_id": r["journal_entry_id"],
                "entry_number": r["journal_entry__entry_number"],
                "is_posted": bool(r["journal_entry__is_posted"]),
                "debit": str(_d(r["debit"]).quantize(Decimal("0.01"))),
                "credit": str(_d(r["credit"]).quantize(Decimal("0.01"))),
                "difference": str(diff.quantize(Decimal("0.01"))),
                "line_count": r["line_count"],
            }
        )
        if len(out) >= limit:
            break
    return out


def find_duplicate_entry_numbers(company_id: int) -> list[dict[str, Any]]:
    dupes = (
        JournalEntry.objects.filter(company_id=company_id)
        .values("entry_number")
        .annotate(c=Count("id"))
        .filter(c__gt=1)
        .order_by("-c")
    )
    return [{"entry_number": d["entry_number"], "count": d["c"]} for d in dupes]


def find_orphan_journal_lines(company_id: int, *, limit: int = 100) -> list[dict[str, Any]]:
    """Lines whose account no longer belongs to the same company (should be rare with PROTECT)."""
    qs = (
        JournalEntryLine.objects.filter(journal_entry__company_id=company_id)
        .exclude(account__company_id=company_id)
        .select_related("journal_entry", "account")[:limit]
    )
    return [
        {
            "line_id": ln.id,
            "journal_entry_id": ln.journal_entry_id,
            "entry_number": ln.journal_entry.entry_number if ln.journal_entry_id else None,
            "account_id": ln.account_id,
            "account_company_id": getattr(ln.account, "company_id", None),
        }
        for ln in qs
    ]


def _control_account_balance(company_id: int, code: str, as_of=None) -> Decimal | None:
    from datetime import date
    from api.services.reporting import _chart_opening_as_of
    from api.services.coa_constants import is_debit_normal_chart_type

    as_of = as_of or date.today()
    acc = ChartOfAccount.objects.filter(
        company_id=company_id, account_code=code, is_active=True
    ).first()
    if not acc:
        return None
    agg = JournalEntryLine.objects.filter(
        journal_entry__company_id=company_id,
        journal_entry__is_posted=True,
        journal_entry__entry_date__lte=as_of,
        account_id=acc.id,
    ).aggregate(
        debit=Coalesce(Sum("debit"), Decimal("0")),
        credit=Coalesce(Sum("credit"), Decimal("0")),
    )
    opening = _chart_opening_as_of(acc, as_of)
    if not is_debit_normal_chart_type(acc.account_type):
        opening = -opening
    return opening + _d(agg["debit"]) - _d(agg["credit"])


def subledger_control_checks(company_id: int) -> list[dict[str, Any]]:
    """Compare AR/AP/inventory report totals to control accounts when present."""
    from datetime import date

    today = date.today()
    start = date(today.year, 1, 1)
    findings: list[dict[str, Any]] = []

    try:
        ar = report_ar_aging(company_id, start, today)
        ar_sub = _d((ar.get("totals") or {}).get("total"))
        ar_gl = _control_account_balance(company_id, "1100")
        if ar_gl is not None:
            diff = ar_sub - ar_gl
            findings.append(
                {
                    "check": "ar_vs_1100",
                    "subledger_total": str(ar_sub.quantize(Decimal("0.01"))),
                    "gl_balance": str(ar_gl.quantize(Decimal("0.01"))),
                    "difference": str(diff.quantize(Decimal("0.01"))),
                    "ok": abs(diff) <= Decimal("1.00"),
                }
            )
    except Exception as exc:
        findings.append({"check": "ar_vs_1100", "ok": False, "error": str(exc)})

    try:
        ap = report_ap_aging(company_id, start, today)
        ap_sub = _d((ap.get("totals") or {}).get("total"))
        ap_gl = _control_account_balance(company_id, "2000")
        if ap_gl is not None:
            # AP control is credit-normal; report total is positive payable.
            ap_gl_payable = -ap_gl if ap_gl < 0 else ap_gl
            # Prefer credit balance magnitude for liability.
            credit_bal = -ap_gl
            diff = ap_sub - credit_bal
            findings.append(
                {
                    "check": "ap_vs_2000",
                    "subledger_total": str(ap_sub.quantize(Decimal("0.01"))),
                    "gl_balance_credit": str(credit_bal.quantize(Decimal("0.01"))),
                    "difference": str(diff.quantize(Decimal("0.01"))),
                    "ok": abs(diff) <= Decimal("1.00"),
                    "note": f"raw_gl_debit_minus_credit={ap_gl}",
                }
            )
    except Exception as exc:
        findings.append({"check": "ap_vs_2000", "ok": False, "error": str(exc)})

    try:
        inv = report_inventory_sku_valuation(company_id, start, today)
        inv_sub = _d(
            (inv.get("totals") or {}).get("extended_cost_value")
            or (inv.get("summary") or {}).get("total_cost_value")
            or (inv.get("stats") or {}).get("on_hand", {}).get("total_cost_value")
            or 0
        )
        # Prefer embedded GL reconciliation when the report already computed it.
        recon = inv.get("gl_reconciliation") or inv.get("_inventory_gl_reconciliation") or inv.get("inventory_gl_reconciliation")
        if isinstance(recon, dict) and recon.get("difference") is not None:
            diff = _d(recon.get("difference"))
            findings.append(
                {
                    "check": "inventory_vs_control",
                    "subledger_total": str(_d(recon.get("valuation_total", recon.get("subledger_total", inv_sub))).quantize(Decimal("0.01"))),
                    "gl_balance": str(_d(recon.get("gl_stock_inventory", recon.get("gl_balance", 0))).quantize(Decimal("0.01"))),
                    "difference": str(diff.quantize(Decimal("0.01"))),
                    "ok": abs(diff) <= Decimal("5.00"),
                }
            )
        else:
            inv_gl = _control_account_balance(company_id, "1200")
            if inv_gl is None:
                inv_gl = _control_account_balance(company_id, "1300")
            if inv_gl is not None:
                diff = inv_sub - inv_gl
                findings.append(
                    {
                        "check": "inventory_vs_control",
                        "subledger_total": str(inv_sub.quantize(Decimal("0.01"))),
                        "gl_balance": str(inv_gl.quantize(Decimal("0.01"))),
                        "difference": str(diff.quantize(Decimal("0.01"))),
                        "ok": abs(diff) <= Decimal("5.00"),
                    }
                )
    except Exception as exc:
        findings.append({"check": "inventory_vs_control", "ok": False, "error": str(exc)})

    return findings


def audit_company_books(company_id: int) -> dict[str, Any]:
    gaps = audit_company_gl_gaps(company_id)
    unbalanced = find_unbalanced_journals(company_id)
    dupes = find_duplicate_entry_numbers(company_id)
    orphans = find_orphan_journal_lines(company_id)
    controls = subledger_control_checks(company_id)
    control_fails = [c for c in controls if not c.get("ok")]
    return {
        "company_id": company_id,
        "gl_posting_gaps": gaps,
        "unbalanced_journals": unbalanced,
        "duplicate_entry_numbers": dupes,
        "orphan_journal_lines": orphans,
        "subledger_control_checks": controls,
        "summary": {
            "gl_posting_gap_count": gaps.get("total_gaps", 0),
            "unbalanced_journal_count": len(unbalanced),
            "duplicate_entry_number_count": len(dupes),
            "orphan_journal_line_count": len(orphans),
            "subledger_control_fail_count": len(control_fails),
            "healthy": (
                gaps.get("total_gaps", 0) == 0
                and not unbalanced
                and not dupes
                and not orphans
                and not control_fails
            ),
        },
    }
