"""Company Brain chat orchestration — Bangla answers with reasoning and ERP references."""
from __future__ import annotations

import json
import logging
from typing import Any

from django.utils import timezone

from api.models import BrainConversation, BrainMessage, Company
from api.services.brain import config as brain_config
from api.services.brain import gateway, plans, tools
from api.services.brain.direct_answer import compose_direct_answer

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are the Company Brain (কোম্পানি ব্রেইন) — the owner's trusted COO advisor for a Bangladeshi multi-business ERP
(fuel stations, supershop, agro shop, restaurant, workshop, aquaculture ponds with tilapia and other species).

You speak like a sharp human colleague: warm, direct, no corporate fluff. The owner may ask ANYTHING about their business.

DATA SOURCES (use all of them):
1. business_snapshot — whole-application ERP state (sales, expenses, P&L, all ponds, roster, recent invoices/bills/payroll, medicine catalog).
2. Focused blocks (pond_analytics, employees, etc.) when present — deeper detail for the specific entity asked about.
3. WEB_RESEARCH_NOTE — when present, supplement with current aquaculture/disease/market knowledge; cite URLs in sources (kind=web).

CRITICAL RULES:
1. Answer DIRECTLY from ERP data. NEVER say "open Reports" or "run a report".
2. Reply in fluent Bangla unless the user writes only in English.
3. Quote exact numbers (৳, kg, FCR, fish count, salaries) from the JSON context — never invent figures or names.
4. For stocking: high load → partial harvest with kg/fish from stocking_recommendation; understocked → suggest increasing stocking.
5. For disease: draft prescription (ঔষধ, ডোজ, প্রয়োগ) from medicine_catalog + symptoms; requires_approval true.
6. For job cuts: release_candidates_advisory only — advisory, owner decides. Include disclaimer.
7. If data is missing, say what you know and ask one clear follow-up (missing_inputs).

Return ONLY a single JSON object (no markdown fences):
- answer_bn: string (conversational; lead with the direct answer, then context/recommendation)
- reasoning_steps_bn: array of strings (how you reasoned — ERP facts, comparisons, web if used)
- confidence: "high" | "medium" | "low"
- sources: array of {kind: "erp"|"inference"|"web", type, id, label, path, url}
- missing_inputs: array of {key, prompt_bn}
- suggested_actions: array of {action, label_bn, requires_approval}"""


def _merge_direct_with_llm(direct: dict[str, Any], llm: dict[str, Any]) -> dict[str, Any]:
    """Prefer LLM narrative but keep ERP numbers from direct when LLM is thin."""
    out = dict(llm)
    if not (out.get("answer_bn") or "").strip():
        out["answer_bn"] = direct.get("answer_bn", "")
    if len(out.get("reasoning_steps_bn") or []) < 2 and direct.get("reasoning_steps_bn"):
        out["reasoning_steps_bn"] = direct["reasoning_steps_bn"]
    for key in ("missing_inputs", "suggested_actions"):
        if not out.get(key) and direct.get(key):
            out[key] = direct[key]
    return out


def _offline_response(
    context: dict[str, Any], refs: list[dict[str, Any]], question: str, *, plan: str = "free"
) -> dict[str, Any]:
    direct = compose_direct_answer(context, lang=(context.get("company") or {}).get("language", "bn"))
    if direct:
        direct["sources"] = [{"kind": "erp", **{k: r[k] for k in r if k != "kind"}} for r in refs[:16]]
        direct.setdefault("missing_inputs", context.get("missing_inputs") or [])
        direct.setdefault("suggested_actions", context.get("suggested_actions") or [])
        if not gateway.openrouter_configured(plan=plan):
            direct["answer_bn"] += (
                "\n\n(সম্পূর্ণ AI বিশ্লেষণের জন্য SaaS Admin → Brain API-তে Free API Key দিন — "
                "অথবা সার্ভারে OPENROUTER_API_KEY সেট করুন।)"
            )
        return direct

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
            "sources": [{"kind": "erp", **{k: r[k] for k in r if k != "kind"}} for r in refs[:8]],
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
) -> list[dict[str, str]]:
    history: list[dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    if web_note:
        history[0]["content"] += f"\n\nWEB_RESEARCH_NOTE: {web_note}"

    prior = (
        BrainMessage.objects.filter(conversation_id=conversation.id)
        .order_by("-created_at")[:8]
    )
    for msg in reversed(list(prior)):
        role = "user" if msg.role == BrainMessage.ROLE_USER else "assistant"
        history.append({"role": role, "content": msg.content[:4000]})

    payload = {
        "ERP_CONTEXT": context,
        "USER_QUESTION": user_text,
        "TODAY": timezone.localdate().isoformat(),
        "INSTRUCTION": (
            "Answer like a human COO advisor. Use business_snapshot for any question. "
            "Do not redirect to reports."
        ),
    }
    history.append(
        {
            "role": "user",
            "content": json.dumps(payload, ensure_ascii=False, default=str),
        }
    )
    return history


def generate_assistant_reply(
    conversation: BrainConversation,
    user_text: str,
    *,
    company: Company,
) -> tuple[dict[str, Any], str]:
    plan = plans.brain_plan_for_company(company)
    context, refs = tools.gather_context(
        int(company.id),
        user_text,
        context_entity_type=conversation.context_entity_type or "",
        context_entity_id=conversation.context_entity_id,
    )

    direct = compose_direct_answer(context, lang=company.language or "bn")

    if not gateway.openrouter_configured(plan=plan):
        structured = _offline_response(context, refs, user_text, plan=plan)
        return structured, "erp-direct"

    use_web = tools.should_use_web_research(user_text, plan)
    model_role = "research" if use_web else "reasoning"
    model_id = gateway.model_for_role(model_role, plan=plan)
    api_key = brain_config.api_key_for_plan(plan)

    web_note = ""
    if use_web:
        web_note = (
            "Supplement ERP data with current web knowledge (aquaculture, disease, market prices, regulations). "
            "Cite web URLs in sources (kind=web). Combine with business_snapshot.medicine_catalog for prescriptions."
        )
    elif "disease" in (context.get("intents") or []):
        web_note = (
            "Disease question on free tier: use medicine_catalog + aquaculture knowledge from training; "
            "note that Growth plan enables live web research for better accuracy."
        )

    messages = _build_messages(conversation, user_text, context, web_note=web_note)
    max_tokens = 8192 if use_web else 6144
    raw, err = gateway.chat_completion(
        messages=messages, model=model_id, api_key=api_key, max_tokens=max_tokens
    )
    if err or not raw:
        logger.warning("Brain LLM failed: %s", err)
        structured = _offline_response(context, refs, user_text, plan=plan)
        if err:
            structured["answer_bn"] += f"\n\n(AI ত্রুটি: {err})"
        return structured, "erp-direct-fallback"

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
    return structured, model_id


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
