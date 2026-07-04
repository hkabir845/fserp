"""Compose direct Bangla answers from ERP analytics (works with or without LLM)."""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from api.services.brain.list_requests import detect_list_module
from api.services.brain.module_lists import format_module_list_answer


def compose_direct_answer(context: dict[str, Any], *, lang: str = "bn") -> dict[str, Any] | None:
    """
    Build a structured answer when ERP data is sufficient.
    Returns None if LLM should synthesize instead.
    """
    raw_intents = context.get("intents") or []
    intents: set[str] = set(raw_intents) if not isinstance(raw_intents, set) else raw_intents
    steps: list[str] = []
    parts: list[str] = []

    if "greeting" in intents:
        company = context.get("company") or {}
        name = company.get("company_name") or "আপনার কোম্পানি"
        entities = company.get("entities") or {}
        stations = entities.get("stations_count", 0)
        ponds = entities.get("ponds_count", 0)
        staff = entities.get("employees_active", 0)
        answer = (
            f"নমস্কার! আমি **{name}**-এর কোম্পানি ব্রেইন। "
            f"স্টেশন {stations}, পোন্ড {ponds}, সক্রিয় কর্মচারী {staff} জন। "
            "বাংলা, বাংলিশ বা ইংরেজিতে যেকোনো প্রশ্ন করুন — আমি বাংলায় উত্তর দেব। "
            "বিক্রি, লাভ, পোন্ড, কর্মচারী, সাধারণ কথোপকথন — সবই চলবে।"
        )
        return {
            "answer_bn": answer,
            "reasoning_steps_bn": ["সাধারণ অভিবাদন — ERP ওভারভিউ দিয়ে সংক্ষিপ্ত পরিচয়।"],
            "confidence": "high",
            "sources": [],
            "missing_inputs": [],
            "suggested_actions": [],
        }

    if "chat" in intents:
        company = context.get("company") or {}
        name = company.get("company_name") or "আপনার কোম্পানি"
        q = (context.get("user_question") or "").lower()
        if any(k in q for k in ("thank", "thanks", "dhonnobad", "ধন্যবাদ", "thnx")):
            answer = "আপনাকে স্বাগতম! আর কিছু জানতে চাইলে বলুন — ব্যবসা বা সাধারণ যেকোনো বিষয়ে।"
        elif any(k in q for k in ("who are you", "tumi ke", "apni ke", "তুমি কে", "আপনি কে", "ki jinis")):
            answer = (
                f"আমি **{name}**-এর কোম্পানি ব্রেইন — আপনার ব্যবসার AI সহকারী। "
                "ERP ডেটা দিয়ে বিক্রি, লাভ, পোন্ড, কর্মী সম্পর্কে সরাসরি উত্তর দিতে পারি; "
                "পাশাপাশি ChatGPT-এর মতো সাধারণ কথোপকথনও করতে পারি। সব উত্তর বাংলায়।"
            )
        elif any(k in q for k in ("help", "ki korte paro", "korte paro", "কী করতে পার", "সাহায্য")):
            answer = (
                "আমি পারি:\n"
                "• ব্যবসার প্রশ্ন — বিক্রি, লাভ, খরচ, পোন্ড FCR, কর্মচারী\n"
                "• পরামর্শ — ঝুঁকি, উন্নতি, হারভেস্ট, ফিডিং\n"
                "• সাধারণ কথোপকথন — ব্যাখ্যা, আলোচনা, ধারণা\n\n"
                "বাংলিশে লিখলেও চলবে, যেমন: *ajker sales kemon* বা *profit koto*।"
            )
        else:
            answer = (
                f"বুঝেছি। আমি **{name}**-এর ব্রেইন — ব্যবসা বা যেকোনো বিষয়ে কথা বলতে পারি। "
                "নির্দিষ্ট সংখ্যা চাইলে বলুন কী দেখতে চান (যেমন আজকের বিক্রি, পোন্ড FCR, মাসের লাভ)।"
            )
        return {
            "answer_bn": answer,
            "reasoning_steps_bn": ["সাধারণ কথোপকথন — বাংলায় সহজ উত্তর।"],
            "confidence": "medium",
            "sources": [],
            "missing_inputs": [],
            "suggested_actions": [],
        }

    question = context.get("user_question") or ""
    list_module = context.get("list_module") or detect_list_module(question)
    if list_module:
        data = context.get("module_list") or {}
        if data.get("rows"):
            answer = format_module_list_answer(data)
            if list_module == "employees":
                hr_mod = (context.get("business_snapshot") or {}).get("erp_modules", {}).get("hr_payroll") or {}
                if hr_mod.get("monthly_payroll_commitment_bdt"):
                    answer += f"\n\nমোট মাসিক বেতন বিল **৳{hr_mod['monthly_payroll_commitment_bdt']}**।"
            return {
                "answer_bn": answer,
                "reasoning_steps_bn": [f"সাইডবার মডিউল `{list_module}` থেকে সম্পূর্ণ তালিকা।"],
                "confidence": "high",
                "sources": [],
                "missing_inputs": [],
                "suggested_actions": [],
            }
        return {
            "answer_bn": f"**{data.get('title_bn') or list_module}:** কোনো রেকর্ড পাওয়া যায়নি।",
            "reasoning_steps_bn": [f"{list_module} — সক্রিয় রেকর্ড নেই।"],
            "confidence": "high",
            "sources": [],
            "missing_inputs": [],
            "suggested_actions": [],
        }

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
        show_limit = 50 if context.get("employee_list_all") else 10
        for e in employees[:show_limit]:
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

    snapshot = context.get("business_snapshot")
    brief = context.get("decision_brief")
    if brief and ({"benchmark", "decision", "predict", "general"} & intents or context.get("advisory_mode")):
        comp_lines = [
            c.get("insight_bn") for c in (brief.get("comparisons") or [])[:6] if c.get("insight_bn")
        ]
        risk_lines = [r.get("message_bn") for r in (brief.get("risk_flags") or [])[:4] if r.get("message_bn")]
        proj_lines = [
            f"{p.get('label_bn')}: ৳{p.get('value_bdt')} ({p.get('method_bn', '')})"
            for p in (brief.get("projections") or [])[:3]
        ]
        dec_lines = [d.get("label_bn") for d in (brief.get("decision_options") or [])[:4] if d.get("label_bn")]
        if comp_lines or risk_lines or proj_lines:
            if comp_lines:
                parts.append("**বিশ্ব/ইন্ডাস্ট্রি তুলনা:**\n" + "\n".join(f"• {x}" for x in comp_lines))
            if proj_lines:
                parts.append("**পূর্বাভাস (অনুমান):**\n" + "\n".join(f"• {x}" for x in proj_lines))
            if risk_lines:
                parts.append("**ঝুঁকি সতর্কতা:**\n" + "\n".join(f"• {x}" for x in risk_lines))
            if dec_lines:
                parts.append("**সিদ্ধান্তে সহায়তা:**\n" + "\n".join(f"• {x}" for x in dec_lines))
            parts.append(brief.get("disclaimer_bn", ""))
            steps.append("decision_brief — ERP বনাম বেঞ্চমার্ক, পূর্বাভাস, সিদ্ধান্ত বিকল্প।")

    if snapshot and "general" in intents and not parts:
        fin = snapshot.get("financials_mtd") or {}
        ct = fin.get("company_total") or {}
        sales_mtd = snapshot.get("sales_mtd") or {}
        exp_mtd = snapshot.get("expenses_mtd") or {}
        counts = snapshot.get("record_counts") or {}
        ponds_block = snapshot.get("ponds_performance_30d") or {}
        roster = snapshot.get("workforce_roster") or []

        parts.append(
            f"**ব্যবসার পালস (MTD):** নেট লাভ **৳{ct.get('net_income', '0')}** "
            f"(আয় ৳{ct.get('income', '0')}, খরচ ৳{ct.get('expenses', '0')})। "
            f"বিক্রি **৳{sales_mtd.get('total_sales_bdt', '0')}** ({sales_mtd.get('invoice_count', 0)} ইনভয়েস)।"
        )
        parts.append(
            f"**সংস্থান:** স্টেশন {counts.get('active_stations', 0)}, "
            f"পোন্ড {counts.get('active_ponds', 0)}, কর্মচারী {counts.get('active_employees', 0)}।"
        )
        pond_rows = (ponds_block.get("ponds") or [])[:6]
        if pond_rows:
            lines = [
                f"• {p.get('pond_name')}: FCR={p.get('fcr_biomass') or '—'}, "
                f"ঘনত্ব={p.get('kg_per_decimal') or '—'} — {p.get('net_action_hint', '')}"
                for p in pond_rows
            ]
            parts.append("**পোন্ড (৩০ দিন):**\n" + "\n".join(lines))
        if roster:
            names = ", ".join(f"{e.get('name')} (৳{e.get('monthly_salary_bdt')})" for e in roster[:5])
            parts.append(f"**কর্মী (সারাংশ):** {names}" + ("…" if len(roster) > 5 else ""))
        recent_inv = snapshot.get("recent_invoices") or []
        if recent_inv:
            parts.append(
                "**সাম্প্রতিক বিক্রি:** "
                + "; ".join(
                    f"{r.get('number')} ৳{r.get('total_bdt')}" for r in recent_inv[:4]
                )
            )
        steps.append("সম্পূর্ণ ERP স্ন্যাপশট — GL P&L, বিক্রি, পোন্ড পারফরম্যান্স, রোস্টার, সাম্প্রতিক লেনদেন।")

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
