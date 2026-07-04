"""Compose direct Bangla answers from ERP analytics (works with or without LLM)."""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from api.services.brain.list_requests import detect_list_module
from api.services.brain.module_lists import format_module_list_answer
from api.services.brain.question_resolver import wants_breakdown
from api.services.brain.advisory_envelope import build_advisory_appendix, should_attach_advisory


def _md_section(title: str, body: str) -> str:
    return f"### {title}\n\n{body.strip()}"


def _md_bullets(items: list[str]) -> str:
    return "\n".join(f"- {item}" for item in items if item)


def _format_direct_answer(parts: list[str], *, lead: str | None = None) -> str:
    """Assemble ChatGPT-style markdown: optional lead line, then sections."""
    blocks: list[str] = []
    if lead:
        blocks.append(lead.strip())
    for p in parts:
        p = (p or "").strip()
        if p:
            blocks.append(p)
    return "\n\n".join(blocks)


def _erp_modules(context: dict[str, Any]) -> dict[str, Any]:
    snap = context.get("business_snapshot") or {}
    mods = snap.get("erp_modules")
    return mods if isinstance(mods, dict) else {}


def _market_value_basis_label(basis: str | None) -> str:
    if basis == "last_pond_sale":
        return "সর্বশেষ পোন্ড বিক্রয় দর"
    if basis == "company_average_sale":
        return "কোম্পানির গড় বিক্রয় দর (গত ১২ মাস)"
    return "বিক্রয় দর"


def _format_all_ponds_portfolio_header(all_ponds: dict[str, Any]) -> str | None:
    totals = all_ponds.get("totals") or {}
    biomass = totals.get("total_biomass_kg")
    market = totals.get("total_implied_market_value_bdt")
    if not biomass:
        return None
    avg = all_ponds.get("company_average_sale_price_per_kg")
    header = (
        f"**সব পোন্ড মিলিয়ে:** বায়োমাস **{biomass}** কেজি, "
        f"মাছ **{totals.get('total_fish_count', 0):,}** মাথা"
    )
    if market:
        header += f", আনুমানিক বাজার মূল্য **৳{market}**"
    if avg:
        header += f" (গড় বিক্রয় দর ৳{avg}/কেজি)"
    return header + "।"


def _format_density_planning_block(pname: str, pond: dict[str, Any]) -> str:
    """
    Explain density = kg biomass per decimal, which fish make it, and growth-based harvest outlook.
    """
    bullets: list[str] = []
    density = pond.get("density") or {}
    profile = pond.get("stock_profile") or {}
    growth = pond.get("growth_projection") or {}
    rec = pond.get("stocking_recommendation") or {}

    kpd = density.get("kg_per_decimal") or profile.get("density_kg_per_decimal") or "—"
    lvl = density.get("load_level_label") or density.get("load_level") or "—"
    biomass = profile.get("biomass_kg") or pond.get("biomass_kg") or "0"
    fish = profile.get("fish_count") or pond.get("fish_count") or 0
    water = profile.get("water_area_decimal") or pond.get("water_area_decimal") or "—"
    avg_g = profile.get("avg_weight_g")

    bullets.append(
        f"ঘনত্ব **{kpd}** কেজি/ডেসিমাল ({lvl}) — **{biomass}** কেজি ÷ **{water}** ডেসিমাল"
    )
    if fish:
        size_part = f", গড় ~**{avg_g}** গ্রাম/মাথা" if avg_g else ""
        bullets.append(f"**{fish:,}** মাথা জীব মাছ{size_part}")

    if growth.get("available"):
        bullets.append(
            f"ADG **{growth.get('adg_g_per_fish_per_day')}** গ্রাম/মাছ/দিন → দৈনিক ~**{growth.get('daily_biomass_gain_kg')}** কেজি বায়োমাস"
        )
        bullets.append(
            f"৩০ দিনে ~**{growth.get('projected_biomass_kg_30d')}** কেজি"
            + (
                f", ঘনত্ব ~**{growth.get('projected_density_kg_per_decimal_30d')}**"
                if growth.get("projected_density_kg_per_decimal_30d")
                else ""
            )
        )
        if growth.get("projected_market_value_bdt_30d"):
            bullets.append(
                f"৩০ দিন পর আনুমানিক মূল্য ~**৳{growth.get('projected_market_value_bdt_30d')}**"
            )

    if rec.get("partial_harvest_suggested_kg"):
        heads = rec.get("partial_harvest_suggested_fish_count")
        head_txt = f" (~{heads:,} মাথা)" if heads else ""
        bullets.append(f"হারভেস্ট: **{rec['partial_harvest_suggested_kg']}** কেজি{head_txt} তুলুন")
    elif rec.get("summary"):
        bullets.append(rec["summary"])

    return _md_section(f"{pname}", _md_bullets(bullets))


def _md_pond_portfolio_table(rows: list[dict[str, Any]], *, include_fcr: bool = False) -> str:
    if not rows:
        return ""
    headers = ["পোন্ড", "বায়োমাস", "ঘনত্ব", "মাছ"]
    if include_fcr:
        headers.append("FCR")
    headers.append("মূল্য")
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
    ]
    for p in rows:
        cells = [
            str(p.get("pond_name") or "—"),
            f"{p.get('biomass_kg') or '—'} কেজি",
            f"{p.get('kg_per_decimal') or '—'}",
            f"{p.get('fish_count') or '—'}",
        ]
        if include_fcr:
            cells.append(str(p.get("fcr_biomass") or "—"))
        mv = p.get("implied_market_value_bdt")
        cells.append(f"৳{mv}" if mv else "—")
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def _append_erp_module_answers(
    *,
    intents: set[str],
    mods: dict[str, Any],
    parts: list[str],
    steps: list[str],
    question: str,
) -> None:
    """Direct Bangla answers from erp_modules snapshot blocks (offline-capable)."""
    if "customer_ar" in intents:
        ar = mods.get("sales_customers_ar") or {}
        if ar and not ar.get("unavailable"):
            parts.append(
                f"**গ্রাহক/বকেয়া:** সক্রিয় গ্রাহক **{ar.get('active_customers', 0)}**, "
                f"মোট A/R **৳{ar.get('ar_balance_total_bdt', '0')}**, "
                f"খোলা ইনভয়েস **{ar.get('open_invoices_count', 0)}**।"
            )
            overdue = ar.get("overdue_invoices") or []
            if overdue:
                lines = [
                    f"• {r.get('customer') or '—'} — {r.get('number')}, ৳{r.get('total_bdt')}, "
                    f"ডিউ {r.get('due_date') or '—'}"
                    for r in overdue[:8]
                ]
                parts.append("**বকেয়া ইনভয়েস:**\n" + "\n".join(lines))
            top = ar.get("top_customers_mtd") or []
            if top and wants_breakdown(question):
                parts.append(
                    "**MTD শীর্ষ গ্রাহক:** "
                    + "; ".join(f"{r.get('name')} ৳{r.get('mtd_sales_bdt')}" for r in top[:5])
                )
            steps.append("sales_customers_ar — গ্রাহক ব্যালেন্স ও বকেয়া।")

    if "vendor_ap" in intents:
        ap = mods.get("purchases_vendors_ap") or {}
        if ap and not ap.get("unavailable"):
            parts.append(
                f"**সরবরাহকারী/বিল:** সক্রিয় ভেন্ডর **{ap.get('active_vendors', 0)}**, "
                f"মোট A/P **৳{ap.get('ap_balance_total_bdt', '0')}**, "
                f"খোলা বিল **{ap.get('open_bills_count', 0)}**।"
            )
            open_bills = ap.get("open_bills") or []
            if open_bills:
                lines = [
                    f"• {r.get('vendor') or '—'} — {r.get('number')}, ৳{r.get('total_bdt')}, "
                    f"ডিউ {r.get('due_date') or '—'}"
                    for r in open_bills[:8]
                ]
                parts.append("**খোলা বিল:**\n" + "\n".join(lines))
            steps.append("purchases_vendors_ap — ভেন্ডর ব্যালেন্স ও বিল।")

    if "payments" in intents:
        pay = mods.get("payments_cash") or {}
        if pay and not pay.get("unavailable"):
            parts.append(
                f"**পেমেন্ট (MTD):** প্রাপ্ত **৳{pay.get('mtd_received_bdt', '0')}** "
                f"({pay.get('mtd_received_count', 0)}টি), "
                f"পরিশোধ **৳{pay.get('mtd_paid_out_bdt', '0')}**, "
                f"ডিপোজিট **৳{pay.get('mtd_deposits_bdt', '0')}**।"
            )
            recent = pay.get("recent_payments") or []
            if recent:
                lines = [
                    f"• {r.get('type')} — {r.get('party') or '—'}, ৳{r.get('amount_bdt')}, {r.get('date')}"
                    for r in recent[:6]
                ]
                parts.append("**সাম্প্রতিক পেমেন্ট:**\n" + "\n".join(lines))
            steps.append("payments_cash — MTD ক্যাশ ফ্লো।")

    if "inventory" in intents:
        inv = mods.get("inventory_stock") or {}
        if inv and not inv.get("unavailable"):
            parts.append(f"**ইনভেন্টরি:** সক্রিয় পণ্য **{inv.get('active_items', 0)}**।")
            low = inv.get("low_stock_items") or []
            if low:
                lines = [
                    f"• {r.get('name')} ({r.get('item_number')}): স্টক {r.get('quantity_on_hand')} "
                    f"{r.get('unit')}"
                    for r in low[:8]
                ]
                parts.append("**কম স্টক / সর্বনিম্ন স্তর:**\n" + "\n".join(lines))
            else:
                parts.append("সক্রিয় ইনভেন্টরি পণ্যের স্টক স্বাভাবিক দেখাচ্ছে।")
            steps.append("inventory_stock — স্টক ও রিঅর্ডার স্তর।")

    if "fuel" in intents:
        fuel = mods.get("fuel_forecourt") or {}
        if fuel and not fuel.get("unavailable"):
            parts.append(
                f"**ফুয়েল ফোরকোর্ট:** সক্রিয় ট্যাংক **{fuel.get('active_tanks', 0)}**, "
                f"নজল **{fuel.get('active_nozzles', 0)}**।"
            )
            low_tanks = fuel.get("tanks_low_stock") or []
            if low_tanks:
                lines = [
                    f"• {r.get('name')} @ {r.get('station')}: {r.get('product')} "
                    f"{r.get('current_stock')}/{r.get('capacity')} {r.get('unit')}"
                    for r in low_tanks[:6]
                ]
                parts.append("**কম স্টক ট্যাংক:**\n" + "\n".join(lines))
            shifts = fuel.get("recent_shift_sessions") or []
            if shifts and wants_breakdown(question):
                lines = [
                    f"• {r.get('station')}: বিক্রি ৳{r.get('total_sales_bdt')}, "
                    f"ভেরিয়েন্স ৳{r.get('cash_variance_bdt')}"
                    for r in shifts[:4]
                ]
                parts.append("**সাম্প্রতিক শিফট:**\n" + "\n".join(lines))
            steps.append("fuel_forecourt — ট্যাংক, শিফট, ডিপ।")

    if "accounting" in intents:
        gl = mods.get("accounting_gl") or {}
        coa = mods.get("chart_of_accounts") or {}
        if gl and not gl.get("unavailable"):
            parts.append(
                f"**হিসাব (MTD):** জার্নাল **{gl.get('journal_entries_mtd', 0)}**, "
                f"ফান্ড ট্রান্সফার **{gl.get('fund_transfers_mtd', 0)}**।"
            )
            recent_je = gl.get("recent_journal_entries") or []
            if recent_je:
                lines = [
                    f"• {r.get('number')} — {r.get('date')}, {(r.get('description') or '')[:60]}"
                    for r in recent_je[:5]
                ]
                parts.append("**সাম্প্রতিক জার্নাল:**\n" + "\n".join(lines))
        if coa and not coa.get("unavailable") and coa.get("active_accounts"):
            parts.append(f"**চার্ট অফ অ্যাকাউন্ট:** সক্রিয় **{coa.get('active_accounts')}**।")
        if gl or coa:
            steps.append("accounting_gl — GL কার্যকলাপ।")

    if "loans" in intents:
        loans = mods.get("loans_financing") or {}
        if loans and not loans.get("unavailable"):
            parts.append(
                f"**ঋণ:** সক্রিয় **{loans.get('active_loans_count', 0)}**, "
                f"ঋণী বকেয়া **৳{loans.get('outstanding_borrowed_bdt', '0')}**, "
                f"ঋণদাতা **৳{loans.get('outstanding_lent_bdt', '0')}**।"
            )
            active = loans.get("active_loans") or []
            if active:
                lines = [
                    f"• {r.get('loan_no')} — {r.get('counterparty') or r.get('title')}, "
                    f"বকেয়া ৳{r.get('outstanding_principal_bdt')}"
                    for r in active[:6]
                ]
                parts.append("**সক্রিয় ঋণ:**\n" + "\n".join(lines))
            steps.append("loans_financing — ঋণ পোর্টফোলিও।")

    if "fixed_assets" in intents:
        assets = mods.get("fixed_assets") or {}
        if assets and not assets.get("unavailable"):
            parts.append(
                f"**স্থায়ী সম্পদ:** মোট **{assets.get('total_assets', 0)}**, "
                f"সক্রিয় **{assets.get('active_assets', 0)}**, "
                f"অধিগ্রহণ মূল্য **৳{assets.get('active_acquisition_cost_bdt', '0')}**।"
            )
            recent = assets.get("recent_assets") or []
            if recent:
                lines = [
                    f"• {r.get('name')} ({r.get('asset_number')}): ৳{r.get('acquisition_cost_bdt')}, {r.get('status')}"
                    for r in recent[:5]
                ]
                parts.append("**সাম্প্রতিক সম্পদ:**\n" + "\n".join(lines))
            steps.append("fixed_assets — সম্পদ রেজিস্টার।")

    if "station" in intents and not {"sales", "sales_today", "profit"} & intents:
        sites = mods.get("stations_sites") or {}
        if sites and not sites.get("unavailable"):
            stations = sites.get("stations") or []
            parts.append(f"**স্টেশন:** সক্রিয় **{sites.get('active_stations', len(stations))}**।")
            if stations:
                lines = [
                    f"• {r.get('name')} ({r.get('number')}) — {r.get('city') or '—'}"
                    for r in stations[:10]
                ]
                parts.append("\n".join(lines))
            steps.append("stations_sites — স্টেশন তালিকা।")

    if "aquaculture_ops" in intents and not {"fcr", "density", "biomass", "harvest", "feeding", "pond"} & intents:
        aq = mods.get("aquaculture_ops") or {}
        ext = mods.get("aquaculture_extended") or {}
        if aq and not aq.get("unavailable"):
            parts.append(
                f"**মৎস্য অপারেশন:** পোন্ড **{aq.get('active_ponds', 0)}**, "
                f"সক্রিয় ব্যাচ **{aq.get('active_cycles', 0)}**, "
                f"জমিদার **{aq.get('landlords', 0)}**।"
            )
            fish_sales = aq.get("fish_sales_mtd") or {}
            if fish_sales:
                parts.append(
                    f"**পোন্ড মাছ বিক্রি (MTD):** {fish_sales.get('count', 0)}টি, "
                    f"**৳{fish_sales.get('total_bdt', '0')}**, {fish_sales.get('weight_kg', '0')} কেজি।"
                )
            exp_cats = aq.get("expenses_mtd_by_category") or []
            if exp_cats:
                lines = [f"• {r.get('category')}: ৳{r.get('total_bdt')}" for r in exp_cats[:6]]
                parts.append("**পোন্ড খরচ (MTD):**\n" + "\n".join(lines))
        if ext and not ext.get("unavailable") and ext.get("biomass_samples_mtd") is not None:
            parts.append(
                f"**স্যাম্পল/স্থানান্তর (MTD):** বায়োমাস স্যাম্পল **{ext.get('biomass_samples_mtd', 0)}**, "
                f"মাছ স্থানান্তর **{ext.get('fish_transfers_mtd', 0)}**।"
            )
        if aq or ext:
            steps.append("aquaculture_ops — মৎস্য সারাংশ।")


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
                "• যেকোনো বিষয় — ChatGPT-এর মতো ব্যাখ্যা, পরামর্শ, লেখা, ধারণা (বাংলায়)\n"
                "• ব্যবসার প্রশ্ন — বিক্রি, লাভ, খরচ, পোন্ড FCR, কর্মচারী\n"
                "• পরামর্শ — ঝুঁকি, উন্নতি, হারভেস্ট, ফিডিং\n\n"
                "বাংলিশে লিখলেও চলবে, যেমন: *ajker sales kemon* বা *profit koto*।"
            )
        else:
            answer = (
                f"বুঝেছি। আমি **{name}**-এর ব্রেইন — ব্যবসা, কোম্পানি, বা যেকোনো বিষয়ে ChatGPT-এর মতো কথা বলতে পারি। "
                "নির্দিষ্ট সংখ্যা চাইলে বলুন (যেমন আজকের বিক্রি, পোন্ড FCR, মাসের লাভ); "
                "সাধারণ প্রশ্ন, পরামর্শ, ব্যাখ্যা — সবই বাংলায়।"
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
    pond_intents = {"fcr", "density", "biomass", "harvest", "feeding", "pond"} & intents
    if pond and pond_intents:
        pname = pond.get("pond_name", "")
        fcr = pond.get("fcr") or {}
        density = pond.get("density") or {}
        rec = pond.get("stocking_recommendation") or {}
        feed = pond.get("feeding_today") or {}
        market = pond.get("market_value") or {}

        if "fcr" in intents:
            fb = fcr.get("fcr_biomass") or "তথ্য নেই"
            parts.append(f"**{pname}** — FCR (বায়োমাস): **{fb}** (ফিড {fcr.get('feed_kg', '0')} কেজি, বায়োমাস বৃদ্ধি {fcr.get('biomass_gain_kg', '0')} কেজি)।")
            steps.append("গত ৩০ দিনের FCR ও ফিড ডেটা ERP থেকে নেওয়া হয়েছে।")

        if "density" in intents:
            parts.append(_format_density_planning_block(pname, pond))
            steps.append(
                "ঘনত্ব = বায়োমাস ÷ ডেসিমাল; মাছের সংখ্যা ও ADG দিয়ে হারভেস্ট/বিক্রয় পরিকল্পনা।"
            )

        if "biomass" in intents:
            parts.append(_format_density_planning_block(pname, pond))
            parts.append(_md_section("বাজার মূল্য", _format_pond_market_value_line(pname, pond, market)))
            if pond.get("bioasset_value_bdt"):
                parts.append(_md_bullets([f"বই মূল্য (বায়ো-অ্যাসেট): **৳{pond.get('bioasset_value_bdt')}**"]))
            steps.append("বায়োমাস + ঘনত্ব + ADG + বিক্রয় দর = হারভেস্ট ও বিক্রয় পরিকল্পনা।")

        if "harvest" in intents:
            if not ({"density", "biomass"} & intents):
                parts.append(_format_density_planning_block(pname, pond))
            parts.append(_md_section("বিক্রয় মূল্য", _format_pond_market_value_line(pname, pond, market)))
            steps.append("হারভেস্ট পরিকল্পনা = ঘনত্ব/লোড + জীব মাছ + ADG + আনুমানিক বিক্রয় মূল্য।")

        if "feeding" in intents and feed:
            skg = feed.get("suggested_feed_kg_today") or "—"
            parts.append(f"**{pname}** — আজকের প্রস্তাবিত ফিড: **{skg}** কেজি।")
            if feed.get("advice_text"):
                parts.append(feed["advice_text"][:600])
            steps.append("ফিডিং হিউরিস্টিক: WorldFish-স্টাইল + স্টক পজিশন।")

        if "pond" in intents and not ({"fcr", "density", "biomass", "harvest", "feeding"} & intents):
            fb = fcr.get("fcr_biomass") or "—"
            kpd = density.get("kg_per_decimal") or "—"
            parts.append(
                f"**{pname}** — FCR **{fb}**, ঘনত্ব **{kpd}** কেজি/ডেসিমাল, মাছ **{pond.get('fish_count', 0):,}** মাথা।"
            )
            steps.append("পোন্ড সারাংশ ERP থেকে।")

    all_ponds = context.get("all_ponds_summary")
    if all_ponds and ({"fcr", "density", "biomass"} & intents) and not pond:
        header = _format_all_ponds_portfolio_header(all_ponds)
        pond_rows = (all_ponds.get("ponds") or [])[:12]
        section_parts: list[str] = []
        if header:
            section_parts.append(header)
        if pond_rows:
            table = _md_pond_portfolio_table(pond_rows, include_fcr="fcr" in intents)
            if table:
                section_parts.append(table)
        if section_parts:
            parts.append(_md_section("সব পোন্ড", "\n\n".join(section_parts)))
            steps.append("প্রতিটি সক্রিয় পোন্ড — স্টক, ঘনত্ব/লোড, আনুমানিক মূল্য।")

    sales = context.get("sales")
    if sales and ("sales" in intents or "sales_today" in intents):
        period = sales.get("period") or {}
        parts.append(
            f"**বিক্রি** ({period.get('start')} – {period.get('end')}): "
            f"**৳{sales.get('total_sales_bdt', '0')}** ({sales.get('invoice_count', 0)} ইনভয়েস)।"
        )
        if wants_breakdown(question):
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
        elif "profit" in intents and wants_breakdown(question):
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

    mods = _erp_modules(context)
    if mods:
        _append_erp_module_answers(
            intents=intents,
            mods=mods,
            parts=parts,
            steps=steps,
            question=question,
        )

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
    if snapshot and "general" in intents and not parts:
        fin = snapshot.get("financials_mtd") or {}
        ct = fin.get("company_total") or {}
        sales_mtd = snapshot.get("sales_mtd") or {}
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
        totals = ponds_block.get("totals") or {}
        if totals.get("total_biomass_kg"):
            parts.append(
                f"**মৎস্য পোর্টফোলিও:** বায়োমাস **{totals.get('total_biomass_kg')}** কেজি"
                + (
                    f", আনুমানিক বাজার মূল্য **৳{totals.get('total_implied_market_value_bdt')}**"
                    if totals.get("total_implied_market_value_bdt")
                    else ""
                )
                + "।"
            )
        if pond_rows:
            lines = [
                f"• {p.get('pond_name')}: বায়োমাস={p.get('biomass_kg') or '—'} কেজি, "
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

    if should_attach_advisory(context):
        appendix = build_advisory_appendix(context)
        if appendix:
            parts.append(appendix)
            steps.append("বাধ্যতামূলক: বিশ্ব তুলনা, সুপারিশ, সতর্কতা, পূর্বাভাস।")

    return {
        "answer_bn": _format_direct_answer(parts),
        "reasoning_steps_bn": steps or ["ERP ডেটা থেকে সরাসরি উত্তর তৈরি।"],
        "confidence": "high" if len(steps) >= 2 else "medium",
        "sources": [],
        "missing_inputs": context.get("missing_inputs") or [],
        "suggested_actions": context.get("suggested_actions") or [],
    }
