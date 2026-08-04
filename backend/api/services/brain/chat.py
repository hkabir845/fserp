"""Company Brain chat orchestration — Bangla answers with reasoning and ERP references."""
from __future__ import annotations

import json
import logging
from typing import Any

from django.utils import timezone

from api.models import BrainConversation, BrainMessage, Company
from api.services.brain import config as brain_config
from api.services.brain import gateway, plans, tools
from api.services.brain.advisory_envelope import enrich_structured_reply
from api.services.brain.context_engine import build_company_context
from api.services.brain.direct_answer import compose_direct_answer
from api.services.brain.list_requests import detect_list_module
from api.services.brain.intents import (
    is_conversational_turn,
    is_greeting_message,
    wants_benchmark_or_decision_research,
    wants_fish_species_research,
)
from api.services.brain.question_resolver import is_help_or_howto_question
from api.services.brain.question_router import TYPE_ONBOARDING, route_question, route_to_dict
from api.services.brain import prompts as brain_prompts
from api.services.brain.prompts import get_risky_question_addon
from api.services.brain import forecasting as brain_forecasting
from api.services.brain.response_format import enrich_response_metadata
from api.services.brain import usage_logging as brain_usage

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are the Company Brain (কোম্পানি ব্রেইন) — the owner's virtual business manager (ব্যবস্থাপক)
and trusted COO for this Bangladeshi company (fuel stations, agro/shop, aquaculture ponds, and related ops).

PERSONALITY: Warm, natural, multi-turn — like a sharp on-site manager who also knows the wider market. Not a report bot.

ANSWER SCOPE (critical — highest priority):
1. Answer ANY business question the owner asks — lead with ### সারাংশ (1–3 sentences direct answer).
2. Company numbers come ONLY from ERP_CONTEXT (never invent ৳, kg, FCR, headcount, invoice totals).
3. Combine ERP + outside knowledge when it helps manage the business (market prices, industry norms, Bangladesh
   seasonality, fuel/fish/feed practice, regulations). Label clearly: **ERP** vs **বাইরের/বাজার রেফারেন্স**.
4. For pure "কত?" number questions: put exact ERP totals in ### মূল সংখ্যা first; then optional short manager note.
5. Full ### বিশ্ব/গ্লোবাল তুলনা, long roadmap, or heavy forecast sections when the owner asks for compare/advice/
   predict/roadmap/audit — OR when a clear decision is needed. Otherwise keep interpretation brief.
6. Follow question_focus in ERP_CONTEXT for which ERP data to use first; infer modules from Banglish/typos via
   question_focus.matched_modules and erp_modules.module_index.
7. How-to / regulation / market questions: use WEB_RESEARCH_NOTE + training knowledge; cite web sources (kind=web).
8. Fish/shrimp SPECIES questions (any species worldwide): use WorldFish + FAO + whole-web research
   (fish_species_research / EXTERNAL_KNOWLEDGE.worldfish_species_pack). Do not answer from ERP-only.
9. Do NOT dump unrelated module summaries — stay on the owner's topic, but you MAY connect 1–2 related ERP facts
   a real manager would mention (e.g. sales + AR, pond load + feed).

LANGUAGE (critical):
1. ALWAYS reply in fluent Bangla in answer_bn — even if the user writes English, Banglish, or romanized Bengali.
2. Understand Banglish freely (e.g. "ajker sales kemon", "profit koto", "pond er FCR bolo").
3. English business terms (sales, profit, FCR, invoice) in user text are normal — explain in Bangla.

FORMATTING (ChatGPT-quality — critical for answer_bn):
Write answer_bn as clean GitHub-style markdown so the UI renders like ChatGPT:
1. Lead with 1–2 short sentences — direct answer first, then details.
2. Use ### section headings for each topic (e.g. ### সারাংশ, ### পোন্ড ঘনত্ব, ### WorldFish গ্যাপ).
3. Use bullet lists (- item) for enumerations; **bold** all key numbers (৳, kg, FCR, counts, dates, pond names).
4. Put a blank line between sections (double newline); never one long wall of text.
5. For 3+ comparable rows (ponds, customers, gaps), use a markdown table:
   | পোন্ড | ঘনত্ব | বায়োমাস |
   | --- | --- | --- |
6. Keep 3–6 scannable sections max; conversational but structured — like ChatGPT, not a report dump.
7. answer_bn is markdown text inside JSON — do NOT wrap the whole answer in code fences.

OPTIONAL ADVISORY (compare / advice / warning / forecast / roadmap / decision — or when a clear decision is needed):
When relevant, add these markdown sections using decision_brief, worldfish_gap_audit, and global knowledge:
- ### বিশ্ব/গ্লোবাল তুলনা — compare ERP numbers to WorldFish/FAO/industry/global benchmarks
- ### সুপারিশ ও পরামর্শ — 2–5 prioritized actionable recommendations (decision_options + fixes)
- ### ⚠️ সতর্কতা — risk_flags and gaps (or state no urgent warning)
- ### পূর্বাভাস / রোডম্যাপ — outlook or next steps from projections; state assumptions
End with brief disclaimer when predicting or recommending strongly.
For simple number lookups, prefer ERP ### মূল সংখ্যা + a short manager note — do not force full advisory sections.

MODES:
- Business manager mode (default for company questions): answer like you run this business day-to-day.
  Use ERP first; add outside/industry context when useful. NEVER say "open Reports" or "run a report".
- Mixed questions (company + outside): answer both in one Bangla reply — ERP facts + market/general knowledge.
- Casual / general chat: discuss ANY topic (world knowledge, tech, writing, life) in Bangla; do not force ERP
  when the question is not about this company.
- Company small-talk ("business kemon", "company er obostha"): manager-style health check from overview +
  key ERP pulse; offer deeper breakdown if needed.
- Advisory / decision: when owner asks compare/predict/decide/audit/advice OR a decision is clearly needed —
  use decision_brief, projections, and decision_options; state assumptions.
- Execution: suggested_actions need owner approval — never auto-execute. Populate suggested_actions when the
  owner wants recommendations, decisions, disease Rx, harvest, job cuts, or explicitly to act/approve.
- Predictions: use decision_brief projections as estimates; supplement with WEB_RESEARCH_NOTE (markets, disease,
  fuel/fish prices). State uncertainty.
- Quote exact numbers (৳, kg, FCR, fish count, salaries) from JSON — never invent figures or names.

BUSINESS RULES:
1. Pond density (ঘনত্ব) = live biomass kg ÷ water area in decimal; load level shows if the pond is understocked,
   comfortable, full, or high-risk. Always tie density to live fish count and average size (fish × avg weight = biomass).
2. For harvest/sale planning: use ADG (g/fish/day) from pond_analytics to project biomass in 30–60 days,
   projected density, and approximate sale value; combine with stocking_recommendation for partial harvest kg/heads.
3. High load → partial harvest with kg/fish from stocking_recommendation; understocked → suggest increasing stocking.
4. For disease: draft prescription (ঔষধ, ডোজ, প্রয়োগ) from medicine_catalog + symptoms; requires_approval true.
5. For job cuts: release_candidates_advisory only — advisory, owner decides. Include disclaimer.
6. worldfish_gap_audit — ERP data shortages + performance gaps vs WorldFish/FAO; fixes list erp_path modules to update.
7. If data is missing, say what you know and ask one clear follow-up (missing_inputs).
8. DATE PERIOD (critical): Use sales.period.start and sales.period.end EXACTLY — if they match, it is ONE day only.
   Never widen to month-to-date when the owner named a specific date (e.g. "4th July sale" = that day only).
   period_label in ERP_CONTEXT shows how the range was interpreted (specific_date, today, month_to_date, etc.).

DATA SOURCES:
1. business_snapshot — whole ERP state when present (not in light chat mode).
2. erp_modules inside business_snapshot — every sidebar module (station, sales, inventory, HR, aquaculture, GL…).
3. module_list — full record list when the owner asks "list all customers/ponds/tanks…".
4. Focused blocks (pond_analytics, employees, etc.) when present.
5. decision_brief — ERP vs industry benchmarks, risk_flags, projections, decision_options (always use for advisory).
6. WEB_RESEARCH_NOTE — supplement with current web knowledge (global standards, market prices, disease, regulations);
   cite URLs (kind=web). Compare web findings to decision_brief.comparisons.

ADVISORY OUTPUT (when owner asks compare/predict/decide/advise/roadmap, WorldFish audit, or advisory_mode):
- For WorldFish/gap/audit questions: use worldfish_gap_audit — list each gap, severity, and erp_path fix.
- reasoning_steps_bn: include benchmark/advice steps only when advisory was requested.
- suggested_actions: only when owner wants recommendations or execution; requires_approval true for operational changes.
- Include decision_brief.disclaimer_bn when giving predictions or strong recommendations.

SYNTHESIS: Act as the business manager — combine relevant ERP modules + outside context when it helps the decision.
Stay on-topic; do not volunteer long unrelated module dumps.

Return ONLY a single JSON object (no markdown fences):
- answer_bn: string (conversational Bangla; lead with the direct answer)
- reasoning_steps_bn: array of strings
- confidence: "high" | "medium" | "low"
- sources: array of {kind: "erp"|"inference"|"web", type, id, label, path, url}
- missing_inputs: array of {key, prompt_bn}
- suggested_actions: array of {action, label_bn, requires_approval}"""

CHAT_MODE_INSTRUCTION = (
    "You are the owner's virtual business manager in Bangla. "
    "Answer the question first (### সারাংশ). "
    "Discuss anything — business, market, general knowledge — and combine company ERP with outside context when useful. "
    "Use COMPANY JSON when the question is about this company. "
    "If they mix general + company topics, answer both in one reply."
)


def _trim_module_block(block: Any, *, list_keys: dict[str, int] | None = None) -> Any:
    if not isinstance(block, dict):
        return block
    out = dict(block)
    for key, limit in (list_keys or {}).items():
        if isinstance(out.get(key), list):
            out[key] = out[key][:limit]
    return out


def _trim_snapshot_for_llm(snap: Any) -> Any:
    """Always send a compact snapshot to the LLM — avoids huge JSON / memory errors."""
    if not isinstance(snap, dict) or snap.get("light_mode") or snap.get("partial"):
        return snap
    ponds_block = snap.get("ponds_performance_30d") or {}
    mods = snap.get("erp_modules") or {}
    return {
        "truncated": True,
        "financials_mtd": snap.get("financials_mtd") or {},
        "sales_today": snap.get("sales_today"),
        "sales_mtd": snap.get("sales_mtd"),
        "expenses_mtd": snap.get("expenses_mtd"),
        "record_counts": snap.get("record_counts"),
        "workforce_roster": (snap.get("workforce_roster") or [])[:50],
        "ponds_performance_30d": {
            "ponds": (ponds_block.get("ponds") or [])[:8],
        },
        "recent_invoices": (snap.get("recent_invoices") or [])[:6],
        "erp_modules": {
            "module_index": mods.get("module_index"),
            "sales_customers_ar": _trim_module_block(
                mods.get("sales_customers_ar"),
                list_keys={"overdue_invoices": 6, "top_customers_mtd": 5},
            ),
            "purchases_vendors_ap": _trim_module_block(
                mods.get("purchases_vendors_ap"),
                list_keys={"open_bills": 6, "top_vendors_mtd": 5},
            ),
            "payments_cash": _trim_module_block(
                mods.get("payments_cash"),
                list_keys={"recent_payments": 6},
            ),
            "inventory_stock": _trim_module_block(
                mods.get("inventory_stock"),
                list_keys={"low_stock_items": 6, "top_station_stock": 5, "top_pond_stock": 5},
            ),
            "fuel_forecourt": _trim_module_block(
                mods.get("fuel_forecourt"),
                list_keys={"tanks_low_stock": 6, "recent_shift_sessions": 4, "recent_tank_dips": 4},
            ),
            "accounting_gl": _trim_module_block(
                mods.get("accounting_gl"),
                list_keys={"recent_journal_entries": 4, "recent_fund_transfers": 4},
            ),
            "loans_financing": _trim_module_block(
                mods.get("loans_financing"),
                list_keys={"active_loans": 5},
            ),
            "hr_payroll": _trim_module_block(
                mods.get("hr_payroll"),
                list_keys={"by_home_station": 6},
            ),
            "aquaculture_ops": _trim_module_block(
                mods.get("aquaculture_ops"),
                list_keys={"expenses_mtd_by_category": 6, "recent_feeding_advice": 4},
            ),
            "fixed_assets": _trim_module_block(
                mods.get("fixed_assets"),
                list_keys={"recent_assets": 4},
            ),
            "aquaculture_extended": _trim_module_block(
                mods.get("aquaculture_extended"),
                list_keys={"landlords": 8},
            ),
            "payroll_runs": _trim_module_block(
                mods.get("payroll_runs"),
                list_keys={"recent_runs": 6},
            ),
            "station_equipment": mods.get("station_equipment"),
            "operations_summary": mods.get("operations_summary"),
            "chart_of_accounts": mods.get("chart_of_accounts"),
            "management_settings": _trim_module_block(
                mods.get("management_settings"),
                list_keys={"taxes": 8},
            ),
            "stations_sites": _trim_module_block(
                mods.get("stations_sites"),
                list_keys={"stations": 8},
            ),
        },
        "note": "Trimmed ERP snapshot; quoted numbers are authoritative.",
    }


def _trim_context_for_llm(context: dict[str, Any]) -> dict[str, Any]:
    snap = context.get("business_snapshot")
    trimmed = {
        **context,
        "business_snapshot": _trim_snapshot_for_llm(snap),
    }
    brief = context.get("decision_brief")
    if isinstance(brief, dict):
        trimmed["decision_brief"] = {
            "comparisons": (brief.get("comparisons") or [])[:12],
            "risk_flags": (brief.get("risk_flags") or [])[:8],
            "projections": brief.get("projections") or [],
            "decision_options": (brief.get("decision_options") or [])[:6],
            "advisory_mode_bn": brief.get("advisory_mode_bn"),
            "disclaimer_bn": brief.get("disclaimer_bn"),
            "benchmarks_reference": {
                k: {"label_bn": v.get("label_bn"), "note_bn": v.get("note_bn")}
                for k, v in list((brief.get("benchmarks_reference") or {}).items())[:8]
            },
        }
    ml = context.get("module_list")
    if isinstance(ml, dict) and isinstance(ml.get("rows"), list) and len(ml["rows"]) > 80:
        trimmed["module_list"] = {**ml, "rows": ml["rows"][:80], "truncated_rows": True}
    wf = context.get("worldfish_gap_audit")
    if isinstance(wf, dict):
        trimmed["worldfish_gap_audit"] = {
            "summary_bn": wf.get("summary_bn"),
            "source_bn": wf.get("source_bn"),
            "gap_count": wf.get("gap_count"),
            "fix_count": wf.get("fix_count"),
            "gaps": (wf.get("gaps") or [])[:12],
            "fixes": (wf.get("fixes") or [])[:10],
        }
    fs = context.get("fish_species_research")
    if isinstance(fs, dict):
        trimmed["fish_species_research"] = fs
    gbg = context.get("global_business_gaps")
    if isinstance(gbg, dict):
        trimmed["global_business_gaps"] = {
            "summary_bn": gbg.get("summary_bn"),
            "gap_count": gbg.get("gap_count"),
            "instruction_bn": gbg.get("instruction_bn"),
            "gaps": (gbg.get("gaps") or [])[:12],
            "benchmark_notes_bn": (gbg.get("benchmark_notes_bn") or [])[:6],
        }
    return trimmed


def _safe_json_dumps(payload: dict[str, Any]) -> str:
    try:
        return json.dumps(payload, ensure_ascii=False, default=str)
    except Exception as exc:
        logger.warning("Brain JSON payload failed: %s", exc)
        minimal = {
            "COMPANY": (payload.get("ERP_CONTEXT") or payload).get("company")
            or payload.get("COMPANY"),
            "USER_QUESTION": payload.get("USER_QUESTION", ""),
            "TODAY": payload.get("TODAY", timezone.localdate().isoformat()),
            "INSTRUCTION": payload.get("INSTRUCTION", ""),
            "NOTE": "Full ERP context omitted due to serialization error.",
        }
        return json.dumps(minimal, ensure_ascii=False, default=str)


def _erp_refs_as_sources(refs: list[dict[str, Any]], *, limit: int = 16) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for r in refs[:limit]:
        try:
            out.append({"kind": "erp", **{k: r[k] for k in r if k != "kind"}})
        except Exception:
            continue
    return out


def _answer_has_money(text: str) -> bool:
    return "৳" in (text or "") or "BDT" in (text or "").upper()


def _merge_direct_with_llm(direct: dict[str, Any], llm: dict[str, Any]) -> dict[str, Any]:
    """Prefer LLM narrative but keep ERP numbers from direct when LLM is thin."""
    out = dict(llm)
    d_ans = (direct.get("answer_bn") or "").strip()
    l_ans = (out.get("answer_bn") or "").strip()
    if not l_ans:
        out["answer_bn"] = d_ans
    elif d_ans and _answer_has_money(d_ans) and not _answer_has_money(l_ans):
        # LLM omitted ERP totals (e.g. only offered a breakdown) — keep ERP numbers first.
        out["answer_bn"] = f"{d_ans}\n\n{l_ans}" if len(l_ans) < 500 else d_ans
        out["confidence"] = direct.get("confidence") or out.get("confidence") or "high"
    if len(out.get("reasoning_steps_bn") or []) < 2 and direct.get("reasoning_steps_bn"):
        out["reasoning_steps_bn"] = direct["reasoning_steps_bn"]
    for key in ("missing_inputs", "suggested_actions"):
        if not out.get(key) and direct.get(key):
            out[key] = direct[key]
    return out


def _is_sales_totals_question(intents: set[str], user_text: str = "") -> bool:
    """Pure 'কত?' sales totals — ERP-direct. Manager-style sales questions use LLM."""
    if not {"sales", "sales_today"} & intents:
        return False
    competing = {
        "profit",
        "expense",
        "hr",
        "disease",
        "job_cut",
        "inventory",
        "fuel",
        "loans",
        "accounting",
        "payments",
        "customer_ar",
        "vendor_ap",
        "fcr",
        "density",
        "biomass",
        "harvest",
        "feeding",
        "pond",
        "aquaculture_ops",
        "benchmark",
        "decision",
        "predict",
    }
    if intents & competing:
        return False
    if "fish_species" in intents:
        return False
    from api.services.brain.intents import wants_advisory_extras, wants_fish_species_research

    if wants_fish_species_research(user_text):
        return False
    if wants_advisory_extras(user_text, intents):
        return False
    if wants_benchmark_or_decision_research(user_text):
        return False
    if is_help_or_howto_question(user_text):
        return False
    lower = (user_text or "").lower()
    manager_kw = (
        "kemon",
        "কেমন",
        "analysis",
        "বিশ্লেষণ",
        "opinion",
        "মতামত",
        "advice",
        "পরামর্শ",
        "suggest",
        "recommend",
        "market",
        "বাজার",
        "industry",
        "compare",
        "তুলনা",
        "why",
        "কেন",
        "improve",
        "উন্নতি",
        "strategy",
        "plan",
        "কী করব",
        "ki korbo",
        "should",
        "vs ",
        "versus",
    )
    if any(k in lower for k in manager_kw):
        return False
    return True


def _offline_response(
    context: dict[str, Any], refs: list[dict[str, Any]], question: str, *, plan: str = "free"
) -> dict[str, Any]:
    direct = compose_direct_answer(context, lang=(context.get("company") or {}).get("language", "bn"))
    if direct:
        direct["sources"] = _erp_refs_as_sources(refs, limit=16)
        direct.setdefault("missing_inputs", context.get("missing_inputs") or [])
        direct.setdefault("suggested_actions", context.get("suggested_actions") or [])
        if not gateway.openrouter_configured(plan=plan):
            direct["answer_bn"] += (
                "\n\n(সম্পূর্ণ AI বিশ্লেষণের জন্য SaaS Admin → Brain API-তে Free API Key দিন — "
                "অথবা সার্ভারে OPENROUTER_API_KEY সেট করুন।)"
            )
        return enrich_structured_reply(direct, context)

    company = context.get("company") or {}
    entities = company.get("entities") or {}
    snapshot = context.get("business_snapshot") or {}
    ct = (snapshot.get("financials_mtd") or {}).get("company_total") or {}
    if ct:
        return {
            "answer_bn": (
                f"কোম্পানি '{company.get('company_name', '')}' — "
                f"স্টেশন {entities.get('stations_count', 0)}, পোন্ড {entities.get('ponds_count', 0)}, "
                f"কর্মচারী {entities.get('employees_active', 0)}। "
                f"এই মাসে নেট লাভ ৳{ct.get('net_income', '0')}। "
                "আরও নির্দিষ্ট প্রশ্ন করুন (পোন্ড, স্টেশন, কর্মচারী, বিক্রি, খরচ)।"
            ),
            "reasoning_steps_bn": ["ERP স্ন্যাপশট লোড হয়েছে; প্রশ্নটি আরও ফোকাস করা যায়।"],
            "confidence": "low",
            "sources": _erp_refs_as_sources(refs, limit=8),
            "missing_inputs": context.get("missing_inputs") or [],
            "suggested_actions": [],
        }
    return {
        "answer_bn": (
            f"কোম্পানি '{company.get('company_name', '')}' — "
            f"স্টেশন {entities.get('stations_count', 0)}, পোন্ড {entities.get('ponds_count', 0)}, "
            f"কর্মচারী {entities.get('employees_active', 0)}। "
            "প্রশ্নটি আরও নির্দিষ্ট করুন (যেমন পোন্ডের নাম, কর্মচারীর নাম, স্টেশন)।"
        ),
        "reasoning_steps_bn": ["ERP ওভারভিউ লোড হয়েছে; নির্দিষ্ট এন্টিটি চিহ্নিত হয়নি।"],
        "confidence": "low",
        "sources": [{"kind": "erp", **{k: r[k] for k in r if k != "kind"}} for r in refs[:8]],
        "missing_inputs": context.get("missing_inputs") or [],
        "suggested_actions": [],
    }


def _merge_sources(structured: dict[str, Any], erp_refs: list[dict[str, Any]]) -> None:
    existing = structured.get("sources") or []
    if not isinstance(existing, list):
        existing = []
    seen = {(str(s.get("type")), s.get("id")) for s in existing if isinstance(s, dict)}
    for r in erp_refs:
        key = (str(r.get("type")), r.get("id"))
        if key in seen:
            continue
        seen.add(key)
        existing.append({"kind": "erp", **r})
    structured["sources"] = existing


def _build_messages(
    conversation: BrainConversation,
    user_text: str,
    context: dict[str, Any],
    *,
    web_note: str = "",
    conversational: bool = False,
    advisor_mode: str = "manager",
    include_advisory: bool = False,
    onboarding: bool = False,
    risk_flag: bool = False,
) -> list[dict[str, str]]:
    system = brain_prompts.get_system_prompt(
        mode=advisor_mode, include_advisory=include_advisory, onboarding=onboarding
    )
    system += f"\n\n{SYSTEM_PROMPT}"
    if risk_flag:
        system += f"\n\n{brain_prompts.get_risky_question_addon()}"
    history: list[dict[str, str]] = [{"role": "system", "content": system}]
    if web_note:
        history[0]["content"] += f"\n\nWEB_RESEARCH_NOTE: {web_note}"

    prior_limit = 12 if conversational else 8
    prior = (
        BrainMessage.objects.filter(conversation_id=conversation.id)
        .order_by("-created_at")[:prior_limit]
    )
    for msg in reversed(list(prior)):
        role = "user" if msg.role == BrainMessage.ROLE_USER else "assistant"
        history.append({"role": role, "content": msg.content[:4000]})

    if conversational:
        payload = {
            "COMPANY": context.get("company"),
            "USER_QUESTION": user_text,
            "TODAY": timezone.localdate().isoformat(),
            "INTENTS": context.get("intents") or [],
            "INSTRUCTION": CHAT_MODE_INSTRUCTION,
        }
        if context.get("pond_analytics"):
            payload["pond_focus"] = context.get("pond_analytics")
        if context.get("employees"):
            payload["employees_focus"] = (context.get("employees") or [])[:5]
    else:
        payload = {
            "ERP_CONTEXT": _trim_context_for_llm(context),
            "CONTEXT_SUMMARY": context.get("context_summary") or {},
            "USER_QUESTION": user_text,
            "TODAY": timezone.localdate().isoformat(),
            "question_focus": context.get("question_focus") or {},
            "QUESTION_ROUTE": context.get("question_route") or {},
            "INSTRUCTION": (
                "Answer like the owner's virtual business manager in Bangla. User may write Banglish — understand it. "
                "Structure answer_bn: ### সারাংশ → direct answer; ### মূল সংখ্যা for ERP totals when relevant. "
                "Combine ERP + useful outside/industry context; label ERP vs বাইরের রেফারেন্স. "
                "Add full ### বিশ্ব/গ্লোবাল তুলনা, ### সুপারিশ, ### ⚠️ সতর্কতা, ### পূর্বাভাস/রোডম্যাপ "
                "when the owner asked for compare/advice/forecast/roadmap/decision OR a clear decision is needed. "
                "Use decision_brief, forecast_pack, and external_knowledge when present. "
                "suggested_actions: [] unless owner asked for recommendations or to act/approve."
            ),
        }
        if context.get("forecast_pack"):
            payload["forecast_pack"] = context["forecast_pack"]
        if context.get("external_knowledge"):
            payload["EXTERNAL_KNOWLEDGE"] = context["external_knowledge"]
        if context.get("global_business_gaps"):
            payload["GLOBAL_BUSINESS_GAPS"] = context["global_business_gaps"]
        if context.get("onboarding_pack"):
            payload["ONBOARDING_PACK"] = context["onboarding_pack"]
    history.append(
        {
            "role": "user",
            "content": _safe_json_dumps(payload),
        }
    )
    return history


def _log_llm_usage(
    *,
    company: Company,
    conversation: BrainConversation,
    result: gateway.CompletionResult,
    route: dict[str, Any],
    success: bool = True,
) -> None:
    try:
        brain_usage.log_usage(
            company_id=int(company.id),
            user_id=conversation.user_id,
            conversation_id=conversation.id,
            model=result.model,
            prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens,
            question_type=str(route.get("question_type") or ""),
            route=str(route.get("advisor_mode") or ""),
            success=success and bool(result.content),
            error_message=result.error or "",
            latency_ms=result.latency_ms,
        )
    except Exception:
        logger.warning("Brain usage log failed company=%s", company.id)


def _finalize_structured(
    structured: dict[str, Any],
    context: dict[str, Any],
    *,
    route: dict[str, Any],
    model_id: str,
) -> dict[str, Any]:
    enriched = enrich_structured_reply(structured, context)
    return enrich_response_metadata(enriched, context=context, route=route, model_used=model_id)


def _emergency_response(company: Company, user_text: str, *, error: Exception | None = None) -> dict[str, Any]:
    name = company.name or "আপনার কোম্পানি"
    if is_greeting_message(user_text):
        answer = (
            f"নমস্কার! আমি **{name}**-এর কোম্পানি ব্রেইন। "
            "বাংলা, বাংলিশ বা ইংরেজিতে জিজ্ঞেস করুন — উত্তর বাংলায় পাবেন।"
        )
    else:
        answer = "দুঃখিত, এই মুহূর্তে উত্তর তৈরি করা যায়নি। একটু পরে আবার চেষ্টা করুন।"
    reasoning = ["সিস্টেম ত্রুটির পর সংক্ষিপ্ত উত্তর।"]
    if error is not None:
        hint = f"{type(error).__name__}: {error}"
        reasoning.append(hint[:240])
        logger.warning("Brain emergency fallback: %s", hint)
    return {
        "answer_bn": answer,
        "reasoning_steps_bn": reasoning,
        "confidence": "low",
        "sources": [],
        "missing_inputs": [],
        "suggested_actions": [],
    }


def generate_assistant_reply(
    conversation: BrainConversation,
    user_text: str,
    *,
    company: Company,
) -> tuple[dict[str, Any], str]:
    try:
        return _generate_assistant_reply_inner(conversation, user_text, company=company)
    except Exception as exc:
        logger.exception("Brain generate_assistant_reply failed company=%s", company.id)
        try:
            plan = plans.brain_plan_for_company(company)
            context, refs = tools.gather_context(int(company.id), user_text)
            context["user_question"] = user_text
            structured = _offline_response(context, refs, user_text, plan=plan)
            structured["reasoning_steps_bn"] = [
                "সিস্টেম ত্রুটি — ERP ডেটা দিয়ে আংশিক উত্তর।",
                f"{type(exc).__name__}: {str(exc)[:200]}",
            ]
            structured.setdefault("confidence", "low")
            return structured, "erp-error-fallback"
        except Exception:
            return _emergency_response(company, user_text, error=exc), "erp-error-fallback"


def _generate_assistant_reply_inner(
    conversation: BrainConversation,
    user_text: str,
    *,
    company: Company,
) -> tuple[dict[str, Any], str]:
    plan = plans.brain_plan_for_company(company)
    qroute = route_question(user_text, plan=plan)
    include_onboarding = qroute.question_type == TYPE_ONBOARDING
    context, refs = build_company_context(
        int(company.id),
        user_text,
        context_entity_type=conversation.context_entity_type or "",
        context_entity_id=conversation.context_entity_id,
        include_forecast=qroute.include_forecast,
        include_external=qroute.include_external or include_onboarding,
        include_global_gaps=qroute.include_global_gaps,
        include_onboarding=include_onboarding,
        brain_user=conversation.user,
    )
    context["user_question"] = user_text
    context["question_route"] = route_to_dict(qroute)
    route_dict = context["question_route"]

    if "greeting" in (context.get("intents") or []):
        structured = compose_direct_answer(context, lang=company.language or "bn") or _emergency_response(
            company, user_text
        )
        structured["sources"] = _erp_refs_as_sources(refs, limit=8)
        return structured, "erp-greeting"

    if detect_list_module(user_text) or context.get("list_module"):
        structured = compose_direct_answer(context, lang=company.language or "bn") or _emergency_response(
            company, user_text
        )
        structured["sources"] = _erp_refs_as_sources(refs, limit=20)
        return enrich_structured_reply(structured, context), "erp-module-list"

    intents_set = set(context.get("intents") or [])
    conversational = is_conversational_turn(intents_set)

    direct = compose_direct_answer(context, lang=company.language or "bn")

    # Pure sales totals ("কত?"): ERP numbers are authoritative. Manager-style sales → LLM.
    if direct and context.get("sales") and _is_sales_totals_question(intents_set, user_text):
        structured = dict(direct)
        structured["sources"] = _erp_refs_as_sources(refs, limit=16)
        return enrich_structured_reply(structured, context), "erp-direct-sales"

    if conversational:
        if not gateway.openrouter_configured(plan=plan):
            structured = direct or _offline_response(context, refs, user_text, plan=plan)
            structured["sources"] = _erp_refs_as_sources(refs, limit=8)
            return enrich_structured_reply(structured, context), "erp-chat"

        messages = _build_messages(
            conversation,
            user_text,
            context,
            conversational=True,
            advisor_mode=qroute.advisor_mode,
        )
        model_id = gateway.model_for_role(qroute.model_role, plan=plan)
        api_key = brain_config.api_key_for_plan(plan)
        result = gateway.chat_completion_with_meta(
            messages=messages, model=model_id, api_key=api_key, max_tokens=4096, temperature=0.75
        )
        _log_llm_usage(company=company, conversation=conversation, result=result, route=route_dict)
        raw, err = result.content, result.error
        if result.used_fallback:
            model_id = result.model
        if err or not raw:
            logger.warning("Brain chat LLM failed: %s", err)
            structured = direct or _offline_response(context, refs, user_text, plan=plan)
            if err:
                structured["answer_bn"] += f"\n\n(AI ত্রুটি: {err})"
            structured["sources"] = _erp_refs_as_sources(refs, limit=8)
            return enrich_structured_reply(structured, context), "erp-chat-fallback"

        structured = gateway.parse_structured_json(raw)
        if not structured or not structured.get("answer_bn"):
            structured = direct or {
                "answer_bn": raw.strip()[:8000],
                "reasoning_steps_bn": ["কথোপকথন — মডেল কাঠামোবদ্ধ JSON দেয়নি।"],
                "confidence": "medium",
                "sources": [],
                "missing_inputs": [],
                "suggested_actions": [],
            }
        elif direct:
            structured = _merge_direct_with_llm(direct, structured)
        _merge_sources(structured, refs)
        structured.setdefault("reasoning_steps_bn", ["সাধারণ কথোপকথন — বাংলায় উত্তর।"])
        structured.setdefault("confidence", "medium")
        return _finalize_structured(structured, context, route=route_dict, model_id=model_id), model_id

    if not gateway.openrouter_configured(plan=plan):
        structured = _offline_response(context, refs, user_text, plan=plan)
        return enrich_structured_reply(structured, context), "erp-direct"

    use_web = tools.should_use_web_research(user_text, plan) or qroute.model_role == "research"
    model_role = "research" if use_web else qroute.model_role
    model_id = gateway.model_for_role(model_role, plan=plan)
    api_key = brain_config.api_key_for_plan(plan)

    web_note = ""
    if qroute.risk_flag:
        web_note = get_risky_question_addon()
    elif qroute.question_type in ("gap_analysis", "external_compare", "solution_explain"):
        web_note = (
            "GLOBAL GAP / COMPARISON / SOLUTION question. Use GLOBAL_BUSINESS_GAPS + EXTERNAL_KNOWLEDGE + "
            "decision_brief. Compare owner ERP data with worldwide industry/SME best practice (web + training). "
            "List gaps clearly. If owner asks how something solves their problem — explain step-by-step with "
            "reference/examples. Cite web URLs (kind=web). Never invent ERP numbers."
        )
    elif qroute.question_type == TYPE_ONBOARDING:
        web_note = (
            "ONBOARDING/HANDOVER: Use ONBOARDING_PACK (handover profiles + company SOP documents) "
            "and ERP_CONTEXT. Help the new/replacement employee catch up like a patient senior colleague. "
            "Week-one plan, open items, contacts. Ask clarifying questions in missing_inputs. "
            "Slack/WhatsApp/email are NOT live-connected — only handover contacts_and_channels."
        )
    elif use_web:
        web_note = (
            "Use live web knowledge to compare the owner's ERP metrics with CURRENT global/regional standards "
            "(aquaculture FCR, pond density, fuel retail margins, fish market prices, disease outbreaks, regulations). "
            "Reconcile with decision_brief.comparisons — cite web URLs in sources (kind=web). "
            "For predictions: combine decision_brief.projections with web trends; state uncertainty. "
            "For decisions: merge decision_options with web best practices; owner must approve operational changes."
        )
    elif wants_benchmark_or_decision_research(user_text) or context.get("advisory_mode"):
        web_note = (
            "Advisory question: use decision_brief benchmarks and projections. "
            "Growth/Enterprise plan enables live web research for fresher global comparisons."
        )
    elif "disease" in (context.get("intents") or []):
        web_note = (
            "Disease question on free tier: use medicine_catalog + aquaculture knowledge from training; "
            "note that Growth plan enables live web research for better accuracy."
        )
    elif "fish_species" in (context.get("intents") or []) or wants_fish_species_research(user_text):
        web_note = (
            "FISH / SPECIES question: Answer from WorldFish + FAO + live web research for ANY fish or shrimp species. "
            "Use fish_species_research / EXTERNAL_KNOWLEDGE.worldfish_species_pack primary_sources. "
            "Cover culture method, stocking, water quality, feed/FCR ranges, common diseases, Bangladesh relevance. "
            "Cite WorldFish/FAO/web URLs in sources (kind=web). "
            "If the company has that species in ERP ponds, mention ERP numbers separately and label them."
        )
    elif is_help_or_howto_question(user_text):
        web_note = (
            "Help/how-to question: provide a clear, professional step-by-step answer in Bangla. "
            "Use WEB_RESEARCH_NOTE for current regulations, best practices, and industry standards; "
            "cite web URLs in sources (kind=web). Stay focused on what the user asked."
        )
    else:
        web_note = (
            "Answer as the owner's virtual business manager. Use ERP data for company numbers. "
            "You may add a short business interpretation and useful outside/industry context "
            "(label ERP vs বাইরের রেফারেন্স). Keep full compare/forecast/roadmap sections concise "
            "unless the owner clearly wants a decision or asked for them."
        )

    messages = _build_messages(
        conversation,
        user_text,
        context,
        web_note=web_note,
        advisor_mode=qroute.advisor_mode,
        include_advisory=qroute.include_advisory or qroute.include_global_gaps or include_onboarding,
        onboarding=include_onboarding,
        risk_flag=qroute.risk_flag,
    )
    max_tokens = 8192 if use_web else 6144
    result = gateway.chat_completion_with_meta(
        messages=messages, model=model_id, api_key=api_key, max_tokens=max_tokens
    )
    _log_llm_usage(company=company, conversation=conversation, result=result, route=route_dict)
    raw, err = result.content, result.error
    if result.used_fallback:
        model_id = result.model
    if err or not raw:
        logger.warning("Brain LLM failed: %s", err)
        structured = _offline_response(context, refs, user_text, plan=plan)
        if err:
            structured["answer_bn"] += f"\n\n(AI ত্রুটি: {err})"
        return enrich_structured_reply(structured, context), "erp-direct-fallback"

    structured = gateway.parse_structured_json(raw)
    if not structured or not structured.get("answer_bn"):
        structured = direct or {
            "answer_bn": raw.strip()[:8000],
            "reasoning_steps_bn": ["মডেল কাঠামোবদ্ধ JSON দেয়নি।"],
            "confidence": "low",
            "sources": [],
            "missing_inputs": context.get("missing_inputs") or [],
            "suggested_actions": context.get("suggested_actions") or [],
        }
    elif direct:
        structured = _merge_direct_with_llm(direct, structured)

    _merge_sources(structured, refs)
    if "reasoning_steps_bn" not in structured or not structured["reasoning_steps_bn"]:
        structured["reasoning_steps_bn"] = ["ERP প্রসঙ্গ থেকে উত্তর তৈরি করা হয়েছে।"]
    structured.setdefault("confidence", "medium")
    structured.setdefault("missing_inputs", context.get("missing_inputs") or [])
    structured.setdefault("suggested_actions", context.get("suggested_actions") or [])
    return _finalize_structured(structured, context, route=route_dict, model_id=model_id), model_id


def append_user_and_assistant(
    conversation: BrainConversation,
    user_text: str,
    *,
    company: Company,
) -> BrainMessage:
    BrainMessage.objects.create(
        conversation=conversation,
        role=BrainMessage.ROLE_USER,
        content=user_text.strip(),
        structured={},
    )
    structured, model_id = generate_assistant_reply(conversation, user_text, company=company)
    assistant = BrainMessage.objects.create(
        conversation=conversation,
        role=BrainMessage.ROLE_ASSISTANT,
        content=(structured.get("answer_bn") or "").strip(),
        structured=structured,
        model_used=model_id,
    )
    if not conversation.title:
        conversation.title = user_text.strip()[:120]
        conversation.save(update_fields=["title", "updated_at"])
    else:
        conversation.save(update_fields=["updated_at"])
    return assistant


def append_user_and_assistant_resilient(
    conversation: BrainConversation,
    user_text: str,
    *,
    company: Company,
) -> BrainMessage:
    """Never raise — always returns an assistant message row."""
    try:
        return append_user_and_assistant(conversation, user_text, company=company)
    except Exception:
        logger.exception("Brain append failed company=%s conv=%s", company.id, conversation.id)
        structured, model_id = _emergency_response(company, user_text)
        try:
            if not BrainMessage.objects.filter(
                conversation=conversation,
                role=BrainMessage.ROLE_USER,
                content=user_text.strip(),
            ).exists():
                BrainMessage.objects.create(
                    conversation=conversation,
                    role=BrainMessage.ROLE_USER,
                    content=user_text.strip(),
                    structured={},
                )
        except Exception:
            pass
        assistant = BrainMessage.objects.create(
            conversation=conversation,
            role=BrainMessage.ROLE_ASSISTANT,
            content=(structured.get("answer_bn") or "").strip(),
            structured=structured,
            model_used=model_id,
        )
        if not conversation.title:
            conversation.title = user_text.strip()[:120]
            conversation.save(update_fields=["title", "updated_at"])
        else:
            conversation.save(update_fields=["updated_at"])
        return assistant
