"""Mandatory global compare, recommendations, warnings, and predictions for every Brain answer."""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from api.services.brain.decision_intelligence import INDUSTRY_BENCHMARKS


def _md_section(title: str, body: str) -> str:
    return f"### {title}\n\n{body.strip()}"


def _md_bullets(items: list[str]) -> str:
    return "\n".join(f"- {item}" for item in items if item)


def global_benchmark_notes(intents: set[str]) -> list[str]:
    """Static world/industry reference when ERP comparison rows are sparse."""
    notes: list[str] = []
    aq = {"fcr", "density", "biomass", "harvest", "feeding", "pond", "aquaculture_ops", "disease"}
    if intents & aq:
        fcr = INDUSTRY_BENCHMARKS["aquaculture_fcr_tilapia"]
        den = INDUSTRY_BENCHMARKS["pond_density_kg_per_decimal"]
        notes.append(
            f"**WorldFish/FAO টিলাপিয়া FCR:** {fcr['excellent_max']}–{fcr['good_max']} ভালো; "
            f"{fcr['poor_above']}+ দুর্বল — {fcr['note_bn']}"
        )
        notes.append(
            f"**ঘনত্ব (গ্লোবাল/আঞ্চলিক):** {den['optimal_min']}–{den['optimal_max']} কেজি/ডেসিমাল সুস্থ; "
            f"{den['critical_above']}+ ঝুঁকিপূর্ণ — {den['note_bn']}"
        )
    if intents & {"sales", "sales_today", "profit", "fuel", "general"}:
        m = INDUSTRY_BENCHMARKS["fuel_station_net_margin_pct"]
        notes.append(
            f"**ফুয়েল স্টেশন (বিশ্ব/আঞ্চলিক):** নেট মার্জিন সাধারণত {m['typical_min']}–{m['typical_max']}% — {m['note_bn']}"
        )
    if intents & {"profit", "expense", "hr", "job_cut", "general"}:
        p = INDUSTRY_BENCHMARKS["payroll_pct_of_revenue"]
        notes.append(
            f"**বেতন বনাম আয় (SME):** ≤{p['healthy_max']}% সুস্থ; ≥{p['critical_above']}% ঝুঁকিপূর্ণ — {p['note_bn']}"
        )
    if intents & {"customer_ar", "payments", "profit"}:
        ar = INDUSTRY_BENCHMARKS["ar_overdue_ratio_pct"]
        notes.append(
            f"**বকেয়া A/R (গ্লোবাল best practice):** ≤{ar['healthy_max']}% সুস্থ — {ar['note_bn']}"
        )
    if intents & {"inventory", "fuel"}:
        inv = INDUSTRY_BENCHMARKS["inventory_shrinkage_tolerance_pct"]
        notes.append(
            f"**ইনভেন্টরি শ্রিংকেজ (রিটেইল):** ≤{inv['acceptable_max']}% লক্ষ্য — {inv['note_bn']}"
        )
    if not notes:
        notes.append(
            "বিশ্ব/আঞ্চলিক SME ব্যবসায় **নিয়মিত KPI মনিটরিং** (বিক্রি, মার্জিন, স্টক, A/R) "
            "সাধারণ best practice — FAO/WorldFish (মৎস্য), NFDA (ফুয়েল), ICMA (হিসাব) গাইডলাইন অনুসরণ করুন।"
        )
    return notes


def _outlook_positive(projection_lines: list[str], snapshot: dict) -> bool:
    text = " ".join(projection_lines).lower()
    if "ক্ষতি" in text or "negative" in text or "ঋণাত্মক" in text:
        return False
    if "লাভ" in text or "ইতিবাচক" in text or "positive" in text:
        return True
    fin = (snapshot.get("financials_mtd") or {}).get("company_total") or {}
    try:
        net = Decimal(str(fin.get("net_income", "0")).replace(",", ""))
        return net >= 0
    except Exception:
        return True


def build_advisory_appendix(context: dict[str, Any]) -> str:
    """
    Mandatory advisory footer: global compare, recommendations, warnings, predictions.
    Appended to every non-greeting Brain answer.
    """
    intents: set[str] = set(context.get("intents") or [])
    brief = context.get("decision_brief") or {}
    wf = context.get("worldfish_gap_audit") or {}
    snapshot = context.get("business_snapshot") or {}

    comp_lines = [c.get("insight_bn") for c in (brief.get("comparisons") or []) if c.get("insight_bn")]
    if wf.get("summary_bn"):
        comp_lines.insert(0, wf["summary_bn"])
    for g in (wf.get("gaps") or [])[:4]:
        msg = g.get("message_bn")
        if msg and msg not in comp_lines:
            comp_lines.append(msg)
    if not comp_lines:
        comp_lines = global_benchmark_notes(intents)

    rec_lines = [d.get("label_bn") for d in (brief.get("decision_options") or []) if d.get("label_bn")]
    for f in (wf.get("fixes") or [])[:5]:
        lbl = f.get("label_bn")
        if lbl and lbl not in rec_lines:
            rec_lines.append(lbl)
    pond = context.get("pond_analytics") or {}
    rec = pond.get("stocking_recommendation") or {}
    if rec.get("summary") and rec["summary"] not in rec_lines:
        rec_lines.append(rec["summary"])
    growth = pond.get("growth_projection") or {}
    if growth.get("planning_note_bn"):
        rec_lines.append(growth["planning_note_bn"])
    if not rec_lines:
        rec_lines = [
            "ERP-তে পোন্ড/বিক্রি/খরচ ডেটা **নিয়মিত আপডেট** রাখুন",
            "**সাপ্তাহিক** বিক্রি, FCR, ঘনত্ব, বকেয়া A/R মনিটর করুন",
            "WorldFish/FAO গাইড অনুযায়ী **ফিডিং ও স্যাম্পলিং** ধারাবাহিক রাখুন",
        ]

    warn_lines = [r.get("message_bn") for r in (brief.get("risk_flags") or []) if r.get("message_bn")]
    for g in (wf.get("gaps") or []):
        if g.get("severity") in ("critical", "high") and g.get("message_bn"):
            line = f"**[{g.get('severity')}]** {g['message_bn']}"
            if line not in warn_lines:
                warn_lines.append(line)
    if not warn_lines:
        warn_lines = [
            "বর্তমান ERP তথ্যে **জরুরি সতর্কতা** চিহ্নিত হয়নি — তবে সাপ্তাহিক রিভিউ চালিয়ে যান।"
        ]

    proj_lines = [
        f"{p.get('label_bn')}: **৳{p.get('value_bdt')}** — {p.get('method_bn', '')}"
        for p in (brief.get("projections") or [])
        if p.get("label_bn")
    ]
    if not proj_lines:
        fin = (snapshot.get("financials_mtd") or {}).get("company_total") or {}
        net_raw = fin.get("net_income", "0")
        try:
            net = Decimal(str(net_raw).replace(",", ""))
            if net > 0:
                proj_lines = [
                    f"MTD নেট লাভ **৳{net_raw}** — বর্তমান গতিতে মাস শেষে **ইতিবাচক (positive)** প্রবণতা সম্ভব"
                ]
            elif net < 0:
                proj_lines = [
                    f"MTD নেট **৳{net_raw}** (ক্ষতি) — একই গতিতে মাস শেষ **ঋণাত্মক (negative)** হতে পারে; "
                    "খরচ/বকেয়া ত্বরান্বিত করুন"
                ]
            else:
                proj_lines = ["MTD নেট শূন্য — আরও লেনদেন হলে পূর্বাভাস স্পষ্ট হবে"]
        except Exception:
            proj_lines = ["পূর্বাভাস: MTD বিক্রি/খরচ রান-রেট থেকে অনুমান (ঋণ/ঋণাত্মক ঝুঁকি seasonality-তে বদলাতে পারে)"]

    positive = _outlook_positive(proj_lines, snapshot)
    outlook_title = "পূর্বাভাস — ইতিবাচক" if positive else "পূর্বাভাস — সতর্ক (ঋণাত্মক ঝুঁকি)"

    sections = [
        _md_section("বিশ্ব/গ্লোবাল তুলনা", _md_bullets(comp_lines[:8])),
        _md_section("সুপারিশ ও পরামর্শ", _md_bullets(rec_lines[:8])),
        _md_section("⚠️ সতর্কতা", _md_bullets(warn_lines[:6])),
        _md_section(outlook_title, _md_bullets(proj_lines[:4])),
    ]
    disclaimer = brief.get("disclaimer_bn") or (
        "পূর্বাভাস ও বেঞ্চমার্ক **নির্দেশনামূলক** — চূড়ান্ত সিদ্ধান্ত মালিকের; "
        "আর্থিক/আইনি সিদ্ধান্তে বিশেষজ্ঞের পরামর্শ নিন।"
    )
    sections.append(disclaimer)
    return "\n\n".join(sections)


_ADVISORY_MARKERS = (
    "### বিশ্ব",
    "### গ্লোবাল",
    "### সুপারিশ",
    "### সতর্কতা",
    "### পূর্বাভাস",
)


def merge_advisory_into_answer(answer: str, appendix: str) -> str:
    """Append advisory sections missing from the LLM answer."""
    answer = (answer or "").strip()
    appendix = (appendix or "").strip()
    if not appendix:
        return answer
    if not answer:
        return appendix
    if any(m in answer for m in _ADVISORY_MARKERS):
        missing_blocks: list[str] = []
        for block in appendix.split("\n\n### "):
            if not block.strip():
                continue
            full = block if block.startswith("### ") else f"### {block}"
            title_line = full.split("\n", 1)[0]
            if title_line not in answer and not any(title_line.replace("### ", "") in answer for _ in [0]):
                missing_blocks.append(full)
        if missing_blocks:
            return answer + "\n\n" + "\n\n".join(missing_blocks)
        return answer
    return f"{answer}\n\n{appendix}"


def should_attach_advisory(context: dict[str, Any]) -> bool:
    intents = set(context.get("intents") or [])
    return "greeting" not in intents


def enrich_structured_reply(structured: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """Ensure every reply includes global compare, advice, warnings, and outlook."""
    if not should_attach_advisory(context):
        return structured
    appendix = build_advisory_appendix(context)
    if appendix:
        structured["answer_bn"] = merge_advisory_into_answer(
            structured.get("answer_bn") or "",
            appendix,
        )
    steps = list(structured.get("reasoning_steps_bn") or [])
    if "বিশ্ব/গ্লোবাল তুলনা" not in " ".join(steps):
        steps.extend(
            [
                "ERP তথ্য সংগ্রহ",
                "বিশ্ব/ইন্ডাস্ট্রি বেঞ্চমার্ক তুলনা",
                "সুপারিশ, সতর্কতা ও পূর্বাভাস যোগ",
            ]
        )
    structured["reasoning_steps_bn"] = steps[:8]
    return structured
