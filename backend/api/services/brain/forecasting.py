"""Practical forecasting engine using existing ERP data — simple reliable methods."""
from __future__ import annotations

from calendar import monthrange
from datetime import date
from decimal import Decimal
from typing import Any

from django.db.models import Count, Sum
from django.utils import timezone

from api.models import Bill, BrainPrediction, Invoice
from api.services.brain import analytics


def _dec(val) -> Decimal:
    try:
        return Decimal(str(val or 0))
    except Exception:
        return Decimal("0")


def _run_rate_projection(mtd_value: Decimal, today: date) -> dict[str, Any]:
    """Project month-end from month-to-date run rate."""
    day = max(1, today.day)
    days_in_month = monthrange(today.year, today.month)[1]
    daily = mtd_value / Decimal(day)
    projected = daily * Decimal(days_in_month)
    return {
        "mtd": str(mtd_value.quantize(Decimal("0.01"))),
        "daily_avg": str(daily.quantize(Decimal("0.01"))),
        "projected_month_end": str(projected.quantize(Decimal("0.01"))),
        "days_elapsed": day,
        "days_in_month": days_in_month,
        "method": "run_rate",
        "confidence": "medium" if day >= 7 else "low",
        "assumptions_bn": [
            "বর্তমান মাসের গড় দৈনিক হার একই থাকবে বলে ধরা হয়েছে।",
            "মৌসুমি/Upsell পরিবর্তন অনুমানে নেই।",
        ],
    }


def forecast_sales_trend(company_id: int) -> dict[str, Any]:
    today = timezone.localdate()
    month_start = today.replace(day=1)
    inv = Invoice.objects.filter(
        company_id=company_id,
        invoice_date__gte=month_start,
        invoice_date__lte=today,
    ).aggregate(total=Sum("total"), count=Count("id"))
    mtd = _dec(inv.get("total"))
    proj = _run_rate_projection(mtd, today)
    return {
        "prediction_type": "sales_trend",
        "title_bn": "বিক্রি ট্রেন্ড — মাস শেষে অনুমান",
        "summary_bn": (
            f"এই মাসে (১–{today.day} তারিখ) বিক্রি ৳{proj['mtd']}। "
            f"গড় দৈনিক ৳{proj['daily_avg']} ধরে মাস শেষে ~৳{proj['projected_month_end']} হতে পারে।"
        ),
        "forecast_data": proj,
        "confidence": proj["confidence"],
        "assumptions_bn": proj["assumptions_bn"],
        "horizon_days": monthrange(today.year, today.month)[1] - today.day,
    }


def forecast_cash_flow_pressure(company_id: int) -> dict[str, Any]:
    today = timezone.localdate()
    month_start = today.replace(day=1)
    snap = analytics.build_company_knowledge_snapshot(company_id)
    mods = (snap or {}).get("erp_modules") or {}
    ar = mods.get("sales_customers_ar") or {}
    ap = mods.get("purchases_vendors_ap") or {}
    pay = mods.get("payments_cash") or {}

    overdue_ar = _dec(ar.get("overdue_total"))
    open_ap = _dec(ap.get("open_bills_total"))
    cash_balance = _dec(pay.get("cash_bank_total") or pay.get("total_cash_bank"))

    inv_mtd = Invoice.objects.filter(
        company_id=company_id, invoice_date__gte=month_start, invoice_date__lte=today
    ).aggregate(t=Sum("total"))
    bill_mtd = Bill.objects.filter(
        company_id=company_id, bill_date__gte=month_start, bill_date__lte=today
    ).aggregate(t=Sum("total"))
    net_mtd = _dec(inv_mtd.get("t")) - _dec(bill_mtd.get("t"))

    pressure_score = 0
    if overdue_ar > net_mtd * Decimal("0.5") and overdue_ar > 0:
        pressure_score += 2
    if open_ap > cash_balance and cash_balance >= 0:
        pressure_score += 2
    if net_mtd < 0:
        pressure_score += 1

    level = "low" if pressure_score <= 1 else "medium" if pressure_score <= 3 else "high"
    return {
        "prediction_type": "cash_flow_pressure",
        "title_bn": "ক্যাশ-ফ্লো চাপ — ঝুঁকি সূচক",
        "summary_bn": (
            f"বকেয়া A/R ৳{overdue_ar}, খোলা A/P ৳{open_ap}, নগদ/ব্যাংক ~৳{cash_balance}। "
            f"চাপের স্তর: {level}।"
        ),
        "forecast_data": {
            "overdue_ar": str(overdue_ar),
            "open_ap": str(open_ap),
            "cash_bank": str(cash_balance),
            "net_mtd": str(net_mtd),
            "pressure_level": level,
            "pressure_score": pressure_score,
        },
        "confidence": "medium" if snap else "low",
        "assumptions_bn": [
            "A/R ও A/P ERP-এর বর্তমান ব্যালেন্স; প্রকৃত ব্যাংক ব্যালেন্স রিকনসিলিয়েশন লাগতে পারে।",
        ],
        "horizon_days": 30,
    }


def forecast_stock_shortage(company_id: int) -> dict[str, Any]:
    snap = analytics.build_company_knowledge_snapshot(company_id)
    mods = (snap or {}).get("erp_modules") or {}
    inv = mods.get("inventory_stock") or {}
    low = inv.get("low_stock_items") or []
    items = [
        {
            "name": r.get("item_name") or r.get("name"),
            "qty": r.get("qty_on_hand") or r.get("quantity"),
            "reorder": r.get("reorder_level"),
        }
        for r in low[:10]
    ]
    return {
        "prediction_type": "stock_shortage",
        "title_bn": "স্টক ঘাটতি — নিম্ন স্তরের আইটেম",
        "summary_bn": f"{len(low)}টি আইটেম reorder স্তরের নিচে বা কাছাকাছি।",
        "forecast_data": {"low_stock_count": len(low), "items": items},
        "confidence": "high" if low else "medium",
        "assumptions_bn": ["Reorder level ERP-এ সেট থাকলে সঠিক; না থাকলে ম্যানুয়াল যাচাই লাগবে।"],
        "horizon_days": 14,
    }


def forecast_slow_moving_inventory(company_id: int) -> dict[str, Any]:
    snap = analytics.build_company_knowledge_snapshot(company_id)
    mods = (snap or {}).get("erp_modules") or {}
    inv = mods.get("inventory_stock") or {}
    slow = inv.get("slow_moving_items") or inv.get("low_stock_items") or []
    return {
        "prediction_type": "slow_moving",
        "title_bn": "ধীর গতির / স্থবির স্টক",
        "summary_bn": f"{len(slow)}টি আইটেমে সাম্প্রতিক movement কম বা সতর্কতা প্রয়োজন।",
        "forecast_data": {"items": slow[:10], "count": len(slow)},
        "confidence": "medium",
        "assumptions_bn": ["৩০–৯০ দিনের movement ERP movement history থেকে; incomplete history হলে confidence কম।"],
        "horizon_days": 60,
    }


def forecast_customer_payment_risk(company_id: int) -> dict[str, Any]:
    snap = analytics.build_company_knowledge_snapshot(company_id)
    mods = (snap or {}).get("erp_modules") or {}
    ar = mods.get("sales_customers_ar") or {}
    overdue = ar.get("overdue_invoices") or []
    top_risk = [
        {
            "customer": row.get("customer_name") or row.get("label"),
            "amount": row.get("balance") or row.get("total"),
            "days_overdue": row.get("days_overdue"),
        }
        for row in overdue[:8]
    ]
    total_overdue = _dec(ar.get("overdue_total"))
    return {
        "prediction_type": "customer_payment_risk",
        "title_bn": "গ্রাহক পেমেন্ট ঝুঁকি",
        "summary_bn": f"বকেয়া ৳{total_overdue} — {len(overdue)}টি overdue ইনভয়েস।",
        "forecast_data": {"overdue_total": str(total_overdue), "top_risk": top_risk},
        "confidence": "high" if overdue else "low",
        "assumptions_bn": [
            "Overdue = due date পেরিয়ে unpaid balance; dispute/adjustment ERP-এ reflect না হলে ভিন্ন হতে পারে।"
        ],
        "horizon_days": 30,
    }


def forecast_branch_performance(company_id: int) -> dict[str, Any]:
    snap = analytics.build_company_knowledge_snapshot(company_id)
    stations = (snap or {}).get("erp_modules", {}).get("stations_sites", {}).get("stations") or []
    ranked = sorted(
        stations,
        key=lambda s: _dec(s.get("sales_mtd") or s.get("revenue_mtd") or 0),
        reverse=True,
    )
    return {
        "prediction_type": "branch_performance",
        "title_bn": "শাখা/স্টেশন পারফরম্যান্স",
        "summary_bn": (
            f"শীর্ষ: {ranked[0].get('name', '—') if ranked else '—'}; "
            f"মোট {len(stations)}টি সক্রিয় সাইট।"
        ),
        "forecast_data": {"stations": ranked[:8]},
        "confidence": "medium",
        "assumptions_bn": ["MTD sales/station ERP invoice allocation অনুযায়ী।"],
        "horizon_days": 30,
    }


def forecast_profit_direction(company_id: int) -> dict[str, Any]:
    today = timezone.localdate()
    snap = analytics.build_company_knowledge_snapshot(company_id)
    fin = (snap or {}).get("financials_mtd") or {}
    ct = fin.get("company_total") or fin
    net = _dec(ct.get("net_income"))
    proj = _run_rate_projection(net, today)
    direction = "positive" if _dec(proj["projected_month_end"]) >= 0 else "negative"
    return {
        "prediction_type": "profit_direction",
        "title_bn": "লাভ/ক্ষতির দিক",
        "summary_bn": (
            f"MTD নেট ৳{proj['mtd']}; run-rate অনুযায়ী মাস শেষ ~৳{proj['projected_month_end']} "
            f"({direction})।"
        ),
        "forecast_data": {**proj, "direction": direction},
        "confidence": proj["confidence"],
        "assumptions_bn": proj["assumptions_bn"],
        "horizon_days": monthrange(today.year, today.month)[1] - today.day,
    }


FORECAST_BUILDERS = {
    "sales_trend": forecast_sales_trend,
    "cash_flow_pressure": forecast_cash_flow_pressure,
    "stock_shortage": forecast_stock_shortage,
    "slow_moving": forecast_slow_moving_inventory,
    "customer_payment_risk": forecast_customer_payment_risk,
    "branch_performance": forecast_branch_performance,
    "profit_direction": forecast_profit_direction,
}


def build_all_forecasts(company_id: int) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for builder in FORECAST_BUILDERS.values():
        try:
            out.append(builder(company_id))
        except Exception:
            continue
    return out


def build_forecast_pack(company_id: int, *, question_type: str = "") -> dict[str, Any]:
    """Return relevant forecasts for a question."""
    if question_type == "forecasting":
        keys = list(FORECAST_BUILDERS.keys())
    elif question_type in FORECAST_BUILDERS:
        keys = [question_type]
    else:
        keys = ["sales_trend", "cash_flow_pressure", "profit_direction"]
    forecasts = []
    for k in keys:
        try:
            forecasts.append(FORECAST_BUILDERS[k](company_id))
        except Exception:
            pass
    return {"forecasts": forecasts, "generated_at": timezone.now().isoformat()}


def persist_predictions(company_id: int, forecasts: list[dict[str, Any]]) -> list[BrainPrediction]:
    types = [f.get("prediction_type") for f in forecasts if f.get("prediction_type")]
    if types:
        BrainPrediction.objects.filter(company_id=company_id, prediction_type__in=types).delete()
    rows: list[BrainPrediction] = []
    for f in forecasts:
        rows.append(
            BrainPrediction.objects.create(
                company_id=company_id,
                prediction_type=f.get("prediction_type", "unknown"),
                title_bn=f.get("title_bn", "")[:300],
                summary_bn=f.get("summary_bn", ""),
                forecast_data=f.get("forecast_data") or {},
                confidence=f.get("confidence", "medium"),
                assumptions_bn=f.get("assumptions_bn") or [],
                horizon_days=int(f.get("horizon_days") or 30),
            )
        )
    return rows
