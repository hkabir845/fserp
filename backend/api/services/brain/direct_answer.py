"""Compose direct Bangla answers from ERP analytics (works with or without LLM)."""
from __future__ import annotations

from typing import Any


def compose_direct_answer(context: dict[str, Any], *, lang: str = "bn") -> dict[str, Any] | None:
    """
    Build a structured answer when ERP data is sufficient.
    Returns None if LLM should synthesize instead.
    """
    intents = context.get("intents") or set()
    steps: list[str] = []
    parts: list[str] = []

    pond = context.get("pond_analytics")
    if pond and {"fcr", "density", "harvest", "feeding", "pond"} & intents:
        pname = pond.get("pond_name", "")
        fcr = pond.get("fcr") or {}
        density = pond.get("density") or {}
        rec = pond.get("stocking_recommendation") or {}
        feed = pond.get("feeding_today") or {}

        if "fcr" in intents or "pond" in intents:
            fb = fcr.get("fcr_biomass") or "তথ্য নেই"
            parts.append(f"**{pname}** — FCR (বায়োমাস): **{fb}** (ফিড {fcr.get('feed_kg', '0')} কেজি, বায়োমাস বৃদ্ধি {fcr.get('biomass_gain_kg', '0')} কেজি)।")
            steps.append(f"গত ৩০ দিনের FCR ও ফিড ডেটা ERP থেকে নেওয়া হয়েছে।")

        if "density" in intents or "harvest" in intents:
            kpd = density.get("kg_per_decimal") or "—"
            lvl = density.get("load_level_label") or density.get("load_level") or "—"
            parts.append(
                f"ঘনত্ব: **{kpd} কেজি/ডেসিমাল** ({lvl})। মাছ **{pond.get('fish_count', 0):,}** মাথা, বায়োমাস **{pond.get('biomass_kg', '0')}** কেজি।"
            )
            if rec.get("summary"):
                parts.append(f"সুপারিশ: {rec['summary']}")
            if rec.get("partial_harvest_suggested_kg"):
                parts.append(
                    f"আংশিক হারভেস্ট প্রস্তাব: **{rec['partial_harvest_suggested_kg']}** কেজি"
                    + (
                        f" (~{rec['partial_harvest_suggested_fish_count']} মাথা)"
                        if rec.get("partial_harvest_suggested_fish_count")
                        else ""
                    )
                )
            steps.append("লোড/ঘনত্ব = বায়োমাস ÷ জলের ক্ষেত্রফল (ডেসিমাল)।")

        if "feeding" in intents and feed:
            skg = feed.get("suggested_feed_kg_today") or "—"
            parts.append(f"আজকের প্রস্তাবিত ফিড: **{skg}** কেজি।")
            if feed.get("advice_text"):
                parts.append(feed["advice_text"][:600])
            steps.append("ফিডিং হিউরিস্টিক: WorldFish-স্টাইল + স্টক পজিশন।")

    all_ponds = context.get("all_ponds_summary")
    if all_ponds and ("fcr" in intents or "density" in intents) and not pond:
        lines = []
        for p in (all_ponds.get("ponds") or [])[:12]:
            lines.append(
                f"• {p.get('pond_name')}: FCR={p.get('fcr_biomass') or '—'}, "
                f"ঘনত্ব={p.get('kg_per_decimal') or '—'} কেজি/ডেসিমাল — {p.get('net_action_hint')}"
            )
        if lines:
            parts.append("**সব পোন্ড সারাংশ:**\n" + "\n".join(lines))
            steps.append("প্রতিটি সক্রিয় পোন্ডের পারফরম্যান্স রিপোর্ট থেকে।")

    sales = context.get("sales")
    if sales and ("sales" in intents or "sales_today" in intents):
        period = sales.get("period") or {}
        parts.append(
            f"**বিক্রি** ({period.get('start')} – {period.get('end')}): "
            f"**৳{sales.get('total_sales_bdt', '0')}** ({sales.get('invoice_count', 0)} ইনভয়েস)।"
        )
        for row in (sales.get("by_station") or [])[:6]:
            parts.append(f"  • {row.get('station_name')}: ৳{row.get('sales_bdt')}")
        steps.append("ইনভয়েস মোট (ড্রাফট/ভয়েড বাদ)।")

    fin = context.get("financials")
    if fin and ("profit" in intents or "expense" in intents or "general" in intents):
        ct = fin.get("company_total") or {}
        if "profit" in intents or "general" in intents:
            parts.append(
                f"**কোম্পানি নেট লাভ (MTD):** ৳{ct.get('net_income', '0')} "
                f"(আয় ৳{ct.get('income', '0')}, খরচ ৳{ct.get('expenses', '0')}, COGS ৳{ct.get('cost_of_goods_sold', '0')})।"
            )
        focused = fin.get("focused_station") or fin.get("focused_pond")
        if focused:
            parts.append(
                f"**{focused.get('entity_name')}** নেট লাভ: ৳{focused.get('net_income', '0')}।"
            )
        elif "profit" in intents:
            for row in (fin.get("stations") or [])[:5]:
                parts.append(f"  • স্টেশন {row.get('entity_name')}: নেট ৳{row.get('net_income', '0')}")
            for row in (fin.get("ponds") or [])[:5]:
                parts.append(f"  • পোন্ড {row.get('entity_name')}: নেট ৳{row.get('net_income', '0')}")
        steps.append("GL-ট্যাগ করা P&L — রিপোর্ট হাবের মতো একই উৎস।")

    exp = context.get("expenses")
    if exp and "expense" in intents:
        parts.append(
            f"**খরচ:** ভেন্ডর বিল ৳{exp.get('vendor_bills_bdt', '0')}, "
            f"পোন্ড সরাসরি খরচ ৳{exp.get('pond_direct_expenses_bdt', '0')}।"
        )
        for row in (exp.get("pond_expenses_by_category") or [])[:6]:
            parts.append(f"  • {row.get('category')}: ৳{row.get('amount_bdt')}")
        steps.append("বিল + AquacultureExpense সারাংশ।")

    employees = context.get("employees") or []
    if employees and "hr" in intents:
        for e in employees[:3]:
            parts.append(
                f"**{e.get('name')}** — বেতন ৳{e.get('monthly_salary_bdt')}/মাস, "
                f"পদ: {e.get('job_title') or '—'}, স্টেশন: {e.get('home_station') or '—'}, পোন্ড: {e.get('home_pond') or '—'}।"
            )
            if e.get("last_payroll_gross_bdt"):
                parts.append(f"  সর্বশেষ পে-রোল ({e.get('last_payroll_date')}): ৳{e.get('last_payroll_gross_bdt')}")
        steps.append("Employee + PayrollRunEmployeeAllocation।")

    hr = context.get("workforce_analysis")
    if hr and "job_cut" in intents:
        parts.append(
            f"**HR পরামর্শ (MTD):** কোম্পানি নেট ৳{hr.get('company_net_income_mtd')}, "
            f"মোট মাসিক বেতন ৳{hr.get('total_monthly_salary_bdt')} ({hr.get('active_employees')} জন)।"
        )
        parts.append(hr.get("disclaimer_bn", ""))
        rel = hr.get("release_candidates_advisory") or []
        if rel:
            parts.append("**বিবেচ্য ছাড়ার তালিকা (পরামর্শ মাত্র):**")
            for r in rel:
                parts.append(
                    f"  • {r.get('name')} (৳{r.get('monthly_salary_bdt')}) — {', '.join(r.get('advisory_reasons') or [])}"
                )
        else:
            parts.append("স্পষ্ট ছাড়ার প্রার্থী চিহ্নিত হয়নি — আরও তথ্য লাগতে পারে।")
        steps.append("বেতন বনাম পোন্ড/স্টেশন নেট লাভের তুলনা।")

    disease = context.get("disease_context")
    if disease and "disease" in intents:
        parts.append(
            "রোগ/চিকিৎসা: আপনার বর্ণনা অনুযায়ী নিচের ক্যাটালগ থেকে ঔষধ বেছে প্রেসক্রিপশন তৈরি করা হবে। "
            "ক্ষেতে DO/pH/লক্ষণ বিস্তারিত দিন।"
        )
        meds = disease.get("medicine_catalog") or []
        if meds:
            parts.append("**স্টকে থাকা ঔষধ/পন্ড কেয়ার:** " + ", ".join(m["name"] for m in meds[:8]))
        steps.append("AQ-MED ক্যাটালগ + (পেইড) ওয়েব গবেষণা।")

    if not parts:
        return None

    return {
        "answer_bn": "\n\n".join(parts),
        "reasoning_steps_bn": steps or ["ERP ডেটা থেকে সরাসরি উত্তর তৈরি।"],
        "confidence": "high" if len(steps) >= 2 else "medium",
        "sources": [],
        "missing_inputs": context.get("missing_inputs") or [],
        "suggested_actions": context.get("suggested_actions") or [],
    }
