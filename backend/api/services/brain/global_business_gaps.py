"""Global business gap analysis — compare tenant ERP vs worldwide SME / industry best practice."""
from __future__ import annotations

from typing import Any

from api.services.brain.decision_intelligence import INDUSTRY_BENCHMARKS, build_decision_brief
from api.services.brain.advisory_envelope import global_benchmark_notes


def wants_global_gap_analysis(message: str) -> bool:
    lower = (message or "").lower()
    keys = (
        "gap",
        "gaps",
        "shortage",
        "weakness",
        "weak",
        "behind",
        "lagging",
        "worldwide",
        "world wide",
        "global business",
        "other companies",
        "other company",
        "how they do",
        "how businesses",
        "best practice",
        "industry standard",
        "audit",
        "ঘাটতি",
        "গ্যাপ",
        "দুর্বল",
        "বিশ্বব্যাপী",
        "অন্য কোম্পানি",
        "ইন্ডাস্ট্রি",
        "তুলনা",
    )
    return any(k in lower for k in keys)


def wants_solution_explanation(message: str) -> bool:
    """Owner asks how a recommendation/reference will solve their problem."""
    lower = (message or "").lower()
    keys = (
        "how will",
        "how would",
        "how does",
        "how do",
        "how can",
        "will this solve",
        "solve my problem",
        "solve the problem",
        "why will",
        "why should",
        "explain",
        "reference",
        "example",
        "কিভাবে সমাধান",
        "কীভাবে সমাধান",
        "সমাধান হবে",
        "ব্যাখ্যা",
        "কেন",
        "উদাহরণ",
        "reference",
    )
    return any(k in lower for k in keys)


def _gap_row(
    *,
    code: str,
    title_bn: str,
    your_status_bn: str,
    global_standard_bn: str,
    gap_bn: str,
    how_to_close_bn: str,
    severity: str = "medium",
    erp_path: str = "",
) -> dict[str, Any]:
    return {
        "code": code,
        "title_bn": title_bn,
        "your_status_bn": your_status_bn,
        "global_standard_bn": global_standard_bn,
        "gap_bn": gap_bn,
        "how_to_close_bn": how_to_close_bn,
        "severity": severity,
        "erp_path": erp_path,
    }


def build_global_business_gap_analysis(context: dict[str, Any]) -> dict[str, Any]:
    """
    Cross-industry gap pack from decision_brief + ERP summary.
    Separates internal ERP facts from external/global reference text.
    """
    snap = context.get("business_snapshot") or {}
    brief = context.get("decision_brief") or build_decision_brief(snap, message="")
    summary = context.get("context_summary") or {}
    intents = set(context.get("intents") or [])

    gaps: list[dict[str, Any]] = []

    for comp in brief.get("comparisons") or []:
        status = comp.get("status") or "review"
        if status in ("good", "excellent", "healthy"):
            continue
        gaps.append(
            _gap_row(
                code=comp.get("metric", "metric"),
                title_bn=comp.get("label_bn", "মেট্রিক"),
                your_status_bn=comp.get("insight_bn") or f"আপনার মান: {comp.get('your_value')}",
                global_standard_bn=f"ইন্ডাস্ট্রি/ref: {comp.get('benchmark_range', '—')}",
                gap_bn=f"স্ট্যাটাস: {status} — global SME norm থেকে পিছিয়ে বা ঝুঁকিতে।",
                how_to_close_bn=(
                    "ERP-এ সংশ্লিষ্ট মডিউলে ডেটা আপডেট করুন, KPI সap্তাহিক মনিটর করুন, "
                    "decision_brief.decision_options অনুযায়ী পদক্ষেপ নিন।"
                ),
                severity="high" if status in ("critical", "high_risk", "poor") else "medium",
                erp_path="/reports",
            )
        )

    for flag in brief.get("risk_flags") or []:
        if not isinstance(flag, dict):
            continue
        gaps.append(
            _gap_row(
                code=flag.get("code", "risk"),
                title_bn="ঝুঁকি সতর্কতা",
                your_status_bn=flag.get("message_bn", ""),
                global_standard_bn="SME best practice: early cash/AR/inventory/margin monitoring",
                gap_bn="বিশ্ব-wide SMEs একই ঝুঁকিতে দ্রুত action নিলে বেঁচে থাকে — আপনার ERP ইতিমধ্যে signal দিচ্ছে।",
                how_to_close_bn=flag.get("message_bn", "") + " — suggested_actions ও ERP path অনুসরণ করুন।",
                severity=flag.get("severity", "medium"),
            )
        )

    fin = summary.get("financials_mtd") or {}
    ar = summary.get("receivables") or {}
    inv = summary.get("inventory") or {}

    if int(ar.get("overdue_count") or 0) > 0:
        gaps.append(
            _gap_row(
                code="ar_overdue",
                title_bn="বকেয়া A/R",
                your_status_bn=f"Overdue ৳{ar.get('overdue_total', '0')} ({ar.get('overdue_count')} invoice)",
                global_standard_bn=INDUSTRY_BENCHMARKS["ar_overdue_ratio_pct"]["note_bn"],
                gap_bn="Global working-capital norm: overdue A/R ≤15–30% — collection process দুর্বল হলে cash choke।",
                how_to_close_bn="Top overdue customers-এ follow-up, credit limit review, partial payment plan — Sales → Customers।",
                severity="medium",
                erp_path="/sales/customers",
            )
        )

    if int(inv.get("low_stock_count") or 0) > 3:
        gaps.append(
            _gap_row(
                code="inventory_low",
                title_bn="ইনভেন্টরি / স্টক",
                your_status_bn=f"{inv.get('low_stock_count')} items low/reorder",
                global_standard_bn=INDUSTRY_BENCHMARKS["inventory_shrinkage_tolerance_pct"]["note_bn"],
                gap_bn="Worldwide retail/SME: stock-out = lost sales; overstock = cash tied up — balance reorder discipline।",
                how_to_close_bn="Reorder low items, review slow movers, set par levels — Inventory module।",
                severity="medium",
                erp_path="/inventory",
            )
        )

    benchmark_notes = global_benchmark_notes(intents)
    return {
        "summary_bn": (
            f"**{len(gaps)}**টি গ্যাপ/ঝুঁকি ERP vs global SME/industry reference থেকে চিহ্নিত। "
            "ERP সংখ্যা authoritative; বাইরের তুলনা general best practice।"
        ),
        "gaps": gaps[:16],
        "gap_count": len(gaps),
        "benchmark_notes_bn": benchmark_notes,
        "instruction_bn": (
            "মালিক 'কিভাবে সমাধান হবে' জিজ্ঞেস করলে প্রতিটি গ্যাপের জন্য "
            "### কীভাবে সমাধান হবে — step-by-step ব্যাখ্যা দিন (ERP + global practice)।"
        ),
        "disclaimer_bn": (
            "Global comparison = industry heuristics + web/training knowledge, not your competitors' private data."
        ),
    }
