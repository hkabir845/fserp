"""Industry benchmarks, ERP comparisons, projections, and decision support for Company Brain."""
from __future__ import annotations

from calendar import monthrange
from datetime import date
from decimal import Decimal
from typing import Any

from django.utils import timezone

# Curated reference ranges — Bangladesh / South Asia SMEs + global aquaculture norms.
# Sources: FAO tilapia manuals, WorldFish feeding guides, fuel retail industry norms, SME finance heuristics.
INDUSTRY_BENCHMARKS: dict[str, dict[str, Any]] = {
    "aquaculture_fcr_tilapia": {
        "label_bn": "টিলাপিয়া FCR (বায়োমাস)",
        "unit": "ratio",
        "excellent_max": 1.4,
        "good_max": 1.7,
        "acceptable_max": 2.0,
        "poor_above": 2.2,
        "note_bn": "FAO/WorldFish: ভালো ম্যানেজমেন্টে ১.৩–১.৬; ২.০+ হলে ফিড দক্ষতা দুর্বল।",
        "source": "FAO/WorldFish tilapia culture",
    },
    "pond_density_kg_per_decimal": {
        "label_bn": "পোন্ড ঘনত্ব (কেজি/ডেসিমাল)",
        "unit": "kg/decimal",
        "low_below": 400,
        "optimal_min": 600,
        "optimal_max": 1400,
        "high_above": 1800,
        "critical_above": 2200,
        "note_bn": "বাংলাদেশে সেমি-ইনটেনসিভ সাধারণত ৮০০–১৫০০; অতিরিক্ত লোডে DO/রোগ ঝুঁকি।",
        "source": "Regional semi-intensive aquaculture practice",
    },
    "fuel_station_net_margin_pct": {
        "label_bn": "ফুয়েল স্টেশন নেট মার্জিন",
        "unit": "% of revenue",
        "typical_min": 1.5,
        "typical_max": 4.0,
        "strong_above": 5.0,
        "note_bn": "বাংলাদেশে পাম্প P&L নেট মার্জিন প্রায় ২–৪% (ভলিউম ও কমিশন অনুযায়ী)।",
        "source": "Fuel retail SME benchmarks",
    },
    "retail_shop_gross_margin_pct": {
        "label_bn": "শপ/সুপারশপ গ্রস মার্জিন",
        "unit": "% of revenue",
        "typical_min": 12.0,
        "typical_max": 28.0,
        "note_bn": "কনভিনিয়েন্স/এগ্রো শপে ১৫–২৫% সাধারণ।",
        "source": "Retail convenience benchmarks",
    },
    "payroll_pct_of_revenue": {
        "label_bn": "বেতন বনাম আয়",
        "unit": "% of revenue",
        "healthy_max": 12.0,
        "caution_max": 18.0,
        "critical_above": 25.0,
        "note_bn": "ছোট মাল্টি-বিজনেসে ৮–১৫% সুস্থ; ২০%+ হলে মার্জিন চাপ।",
        "source": "SME operating ratio heuristics",
    },
    "ar_overdue_ratio_pct": {
        "label_bn": "বকেয়া ইনভয়েস অনুপাত",
        "unit": "% of open AR",
        "healthy_max": 15.0,
        "caution_max": 30.0,
        "critical_above": 45.0,
        "note_bn": "৩০%+ বকেয়া হলে ক্যাশ-ফ্লো ঝুঁকি বাড়ে।",
        "source": "Working capital best practice",
    },
    "inventory_shrinkage_tolerance_pct": {
        "label_bn": "ইনভেন্টরি শ্রিংকেজ",
        "unit": "% of COGS",
        "acceptable_max": 2.0,
        "caution_above": 4.0,
        "note_bn": "রিটেইলে ১–২% লক্ষ্য; ট্যাংক ভ্যারিয়েন্স আলাদা ট্র্যাক।",
        "source": "Retail loss prevention norms",
    },
}


def _d(val) -> Decimal:
    try:
        return Decimal(str(val or 0))
    except Exception:
        return Decimal("0")


def _money(val) -> str:
    try:
        return f"{Decimal(str(val or 0)):,.2f}"
    except Exception:
        return "0.00"


def _pct(numerator: Decimal, denominator: Decimal) -> float | None:
    if denominator <= 0:
        return None
    return float((numerator / denominator) * 100)


def _status_vs_range(
    value: float | None,
    *,
    low_below: float | None = None,
    optimal_min: float | None = None,
    optimal_max: float | None = None,
    good_max: float | None = None,
    excellent_max: float | None = None,
    poor_above: float | None = None,
    high_above: float | None = None,
    critical_above: float | None = None,
    healthy_max: float | None = None,
    caution_max: float | None = None,
) -> str:
    if value is None:
        return "unknown"
    if low_below is not None and value < low_below:
        return "below_standard"
    if excellent_max is not None and value <= excellent_max:
        return "excellent"
    if good_max is not None and value <= good_max:
        return "good"
    if optimal_min is not None and optimal_max is not None and optimal_min <= value <= optimal_max:
        return "optimal"
    if healthy_max is not None and value <= healthy_max:
        return "healthy"
    if caution_max is not None and value <= caution_max:
        return "caution"
    if poor_above is not None and value > poor_above:
        return "poor"
    if critical_above is not None and value > critical_above:
        return "critical"
    if high_above is not None and value > high_above:
        return "high_risk"
    return "review"


def build_decision_brief(
    snapshot: dict[str, Any],
    *,
    message: str = "",
    today: date | None = None,
) -> dict[str, Any]:
    """
    Compare ERP facts to world/industry benchmarks; flag risks; project month-end; suggest decisions.
    Works offline — LLM/web layer adds deeper global research on top.
    """
    today = today or timezone.localdate()
    month_start = today.replace(day=1)
    days_elapsed = max(1, (today - month_start).days + 1)
    days_in_month = monthrange(today.year, today.month)[1]

    fin = (snapshot.get("financials_mtd") or {}).get("company_total") or {}
    income = _d(fin.get("income"))
    expenses = _d(fin.get("expenses"))
    net = _d(fin.get("net_income"))
    cogs = _d(fin.get("cost_of_goods_sold"))
    revenue = income  # P&L income as revenue proxy

    sales_mtd = snapshot.get("sales_mtd") or {}
    sales_total = _d(str(sales_mtd.get("total_sales_bdt", "0")).replace(",", ""))

    mods = snapshot.get("erp_modules") or {}
    hr = mods.get("hr_payroll") or {}
    ar_block = mods.get("sales_customers_ar") or {}
    payroll_commitment = _d(str(hr.get("monthly_payroll_commitment_bdt", "0")).replace(",", ""))

    comparisons: list[dict[str, Any]] = []
    risk_flags: list[dict[str, Any]] = []
    projections: list[dict[str, Any]] = []
    decision_options: list[dict[str, Any]] = []

    net_margin_pct = _pct(net, revenue)
    if net_margin_pct is not None:
        bench = INDUSTRY_BENCHMARKS["fuel_station_net_margin_pct"]
        status = _status_vs_range(
            net_margin_pct,
            healthy_max=bench["typical_max"],
            caution_max=bench["strong_above"],
        )
        comparisons.append(
            {
                "metric": "company_net_margin_pct",
                "label_bn": "কোম্পানি নেট মার্জিন (MTD)",
                "your_value": round(net_margin_pct, 2),
                "benchmark_range": f"{bench['typical_min']}–{bench['typical_max']}%",
                "status": status,
                "insight_bn": (
                    f"আপনার নেট মার্জিন {net_margin_pct:.1f}% — ইন্ডাস্ট্রি সাধারণত {bench['typical_min']}–{bench['typical_max']}%।"
                ),
            }
        )
        if status in ("caution", "critical", "poor", "high_risk") or net < 0:
            risk_flags.append(
                {
                    "code": "low_net_margin",
                    "severity": "high" if net < 0 else "medium",
                    "message_bn": "নেট মার্জিন দুর্বল — খরচ/বেতন/বকেয়া ত্বরান্বিত করুন।",
                }
            )

    payroll_pct = _pct(payroll_commitment, revenue if revenue > 0 else sales_total)
    if payroll_pct is not None:
        bench = INDUSTRY_BENCHMARKS["payroll_pct_of_revenue"]
        status = _status_vs_range(
            payroll_pct,
            healthy_max=bench["healthy_max"],
            caution_max=bench["caution_max"],
            critical_above=bench["critical_above"],
        )
        comparisons.append(
            {
                "metric": "payroll_pct_of_revenue",
                "label_bn": "বেতন বনাম আয়",
                "your_value": round(payroll_pct, 2),
                "benchmark_range": f"≤{bench['healthy_max']}% সুস্থ, ≤{bench['caution_max']}% সতর্ক",
                "status": status,
                "insight_bn": f"মাসিক বেতন বিল revenue-এর {payroll_pct:.1f}% — সুস্থ সীমা সাধারণত ≤{bench['healthy_max']}%.",
            }
        )
        if status in ("caution", "critical", "high_risk"):
            risk_flags.append(
                {
                    "code": "high_payroll_ratio",
                    "severity": "medium",
                    "message_bn": "বেতন অনুপাত উচ্চ — প্রোডাক্টিভিটি বা হেডকাউন্ট পুনর্মূল্যায়ন করুন।",
                }
            )
            decision_options.append(
                {
                    "priority": 2,
                    "action": "review_payroll",
                    "label_bn": "বেতন বনাম পোন্ড/স্টেশন লাভ তুলনা করে কর্মী পরিকল্পনা করুন",
                    "requires_approval": True,
                }
            )

    open_inv = int(ar_block.get("open_invoices_count") or 0)
    overdue_list = ar_block.get("overdue_invoices") or []
    overdue_count = len(overdue_list)
    if open_inv > 0:
        overdue_ratio = overdue_count / open_inv * 100
        bench = INDUSTRY_BENCHMARKS["ar_overdue_ratio_pct"]
        status = _status_vs_range(
            overdue_ratio,
            healthy_max=bench["healthy_max"],
            caution_max=bench["caution_max"],
            critical_above=bench["critical_above"],
        )
        comparisons.append(
            {
                "metric": "ar_overdue_ratio_pct",
                "label_bn": "বকেয়া ইনভয়েস অনুপাত",
                "your_value": round(overdue_ratio, 1),
                "benchmark_range": f"≤{bench['healthy_max']}% সুস্থ",
                "status": status,
                "insight_bn": f"খোলা ইনভয়েসের {overdue_ratio:.0f}% বকেয়া/অতিদেয় ({overdue_count}/{open_inv})।",
            }
        )
        if status in ("caution", "critical", "high_risk"):
            risk_flags.append(
                {
                    "code": "ar_overdue",
                    "severity": "high" if status == "critical" else "medium",
                    "message_bn": "বকেয়া A/R বেশি — ক্যাশ ফ্লো ২–৪ সপ্তাহে চাপ পড়তে পারে।",
                }
            )
            decision_options.append(
                {
                    "priority": 1,
                    "action": "collect_ar",
                    "label_bn": "শীর্ষ বকেয়া গ্রাহক থেকে আদায় অভিযান শুরু করুন",
                    "requires_approval": False,
                }
            )

    ponds_block = snapshot.get("ponds_performance_30d") or {}
    fcr_bench = INDUSTRY_BENCHMARKS["aquaculture_fcr_tilapia"]
    density_bench = INDUSTRY_BENCHMARKS["pond_density_kg_per_decimal"]
    for pond in (ponds_block.get("ponds") or [])[:12]:
        fcr_raw = pond.get("fcr_biomass")
        try:
            fcr_val = float(fcr_raw) if fcr_raw not in (None, "", "—") else None
        except (TypeError, ValueError):
            fcr_val = None
        if fcr_val is not None:
            status = _status_vs_range(
                fcr_val,
                excellent_max=fcr_bench["excellent_max"],
                good_max=fcr_bench["good_max"],
                poor_above=fcr_bench["poor_above"],
            )
            comparisons.append(
                {
                    "metric": "pond_fcr",
                    "pond": pond.get("pond_name"),
                    "label_bn": f"FCR — {pond.get('pond_name')}",
                    "your_value": fcr_val,
                    "benchmark_range": f"{fcr_bench['excellent_max']}–{fcr_bench['good_max']} ভালো",
                    "status": status,
                    "insight_bn": (
                        f"{pond.get('pond_name')}: FCR {fcr_val} — "
                        f"বিশ্ব মান {fcr_bench['excellent_max']}–{fcr_bench['good_max']} (টিলাপিয়া)।"
                    ),
                }
            )
            if status in ("poor", "critical", "high_risk", "review"):
                risk_flags.append(
                    {
                        "code": "high_fcr",
                        "severity": "medium",
                        "pond": pond.get("pond_name"),
                        "message_bn": f"{pond.get('pond_name')} FCR দুর্বল — ফিড খরচ বাড়বে, মার্জিন কমবে।",
                    }
                )
                decision_options.append(
                    {
                        "priority": 2,
                        "action": "improve_fcr",
                        "label_bn": f"{pond.get('pond_name')}: ফিডিং/জলমান/ঘনত্ব পর্যালোচনা করুন",
                        "requires_approval": True,
                    }
                )

        density_raw = pond.get("kg_per_decimal")
        try:
            density_val = float(str(density_raw).replace(",", "")) if density_raw not in (None, "", "—") else None
        except (TypeError, ValueError):
            density_val = None
        if density_val is not None:
            status = _status_vs_range(
                density_val,
                low_below=density_bench["low_below"],
                optimal_min=density_bench["optimal_min"],
                optimal_max=density_bench["optimal_max"],
                high_above=density_bench["high_above"],
                critical_above=density_bench["critical_above"],
            )
            comparisons.append(
                {
                    "metric": "pond_density",
                    "pond": pond.get("pond_name"),
                    "label_bn": f"ঘনত্ব — {pond.get('pond_name')}",
                    "your_value": density_val,
                    "benchmark_range": f"{density_bench['optimal_min']}–{density_bench['optimal_max']} কেজি/ডেসিমাল",
                    "status": status,
                    "insight_bn": (
                        f"{pond.get('pond_name')}: {density_val} কেজি/ডেসিমাল — "
                        f"সুস্থ সীমা {density_bench['optimal_min']}–{density_bench['optimal_max']}।"
                    ),
                }
            )
            if status in ("high_risk", "critical"):
                risk_flags.append(
                    {
                        "code": "pond_overload",
                        "severity": "high",
                        "pond": pond.get("pond_name"),
                        "message_bn": f"{pond.get('pond_name')} অতিরিক্ত লোড — মৃত্যু/রোগ/খরচ বাড়ার ঝুঁকি।",
                    }
                )

    fuel = mods.get("fuel_forecourt") or {}
    low_tanks = fuel.get("tanks_low_stock") or []
    if low_tanks:
        risk_flags.append(
            {
                "code": "fuel_low_stock",
                "severity": "high",
                "message_bn": f"{len(low_tanks)} ট্যাংক রিঅর্ডার লেভেলের নিচে — স্টকআউটে বিক্রি বন্ধ হতে পারে।",
            }
        )
        decision_options.append(
            {
                "priority": 1,
                "action": "reorder_fuel",
                "label_bn": "নিম্ন স্টক ট্যাংকে জ্বালানি অর্ডার করুন",
                "requires_approval": True,
            }
        )

    inv = mods.get("inventory_stock") or {}
    low_items = inv.get("low_stock_items") or []
    if low_items:
        risk_flags.append(
            {
                "code": "shop_low_stock",
                "severity": "medium",
                "message_bn": f"{len(low_items)} আইটেম রিঅর্ডার লেভেলের নিচে — শপ বিক্রি হারাতে পারেন।",
            }
        )

    # Month-end run-rate projections (simple linear extrapolation — label as estimate)
    if sales_total > 0:
        projected_sales = sales_total * Decimal(days_in_month) / Decimal(days_elapsed)
        projections.append(
            {
                "metric": "projected_month_sales",
                "label_bn": "অনুমানিত মাস শেষ বিক্রি",
                "value_bdt": _money(projected_sales),
                "method_bn": f"MTD ৳{_money(sales_total)} × {days_in_month}/{days_elapsed} দিন (রান-রেট)",
                "confidence": "medium",
            }
        )
    if net != 0 or expenses > 0:
        projected_net = net * Decimal(days_in_month) / Decimal(days_elapsed)
        projections.append(
            {
                "metric": "projected_month_net",
                "label_bn": "অনুমানিত মাস শেষ নেট লাভ/ক্ষতি",
                "value_bdt": _money(projected_net),
                "method_bn": "MTD নেট লাভ × মাস দিন/অতিবাহিত দিন",
                "confidence": "medium",
            }
        )
        if projected_net < 0:
            risk_flags.append(
                {
                    "code": "projected_month_loss",
                    "severity": "high",
                    "message_bn": f"বর্তমান গতিতে মাস শেষে অনুমানিত ক্ষতি ৳{_money(abs(projected_net))}।",
                }
            )
            decision_options.append(
                {
                    "priority": 1,
                    "action": "cost_review",
                    "label_bn": "খরচ/বেতন/বকেয়া ত্বরান্বিত করে মাস শেষের ক্ষতি রোধ করুন",
                    "requires_approval": True,
                }
            )

    if not decision_options and net > 0:
        decision_options.append(
            {
                "priority": 3,
                "action": "maintain_course",
                "label_bn": "বর্তমান ট্র্যাক ধরে রাখুন; সাপ্তাহিক বিক্রি ও পোন্ড FCR মনিটর করুন",
                "requires_approval": False,
            }
        )

    decision_options.sort(key=lambda d: int(d.get("priority", 9)))

    return {
        "generated_at": timezone.now().isoformat(),
        "benchmarks_reference": INDUSTRY_BENCHMARKS,
        "comparisons": comparisons[:20],
        "risk_flags": risk_flags[:12],
        "projections": projections,
        "decision_options": decision_options[:8],
        "advisory_mode_bn": (
            "ERP তথ্য + বিশ্ব/ইন্ডাস্ট্রি বেঞ্চমার্ক তুলনা + সরল পূর্বাভাস। "
            "ওয়েব গবেষণা (Growth প্ল্যান) দিয়ে আরও হালনাগাদ বাজার/রোগ/দর তুলনা করুন।"
        ),
        "disclaimer_bn": (
            "পূর্বাভাস ও বেঞ্চমার্ক তথ্য নির্দেশনামূলক — চূড়ান্ত সিদ্ধান্ত মালিকের; "
            "আর্থিক/আইনি সিদ্ধান্তে প্রয়োজনে বিশেষজ্ঞের পরামর্শ নিন।"
        ),
    }
