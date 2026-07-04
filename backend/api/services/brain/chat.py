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
from api.services.brain.intents import is_greeting_message

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are the Company Brain (কোম্পানি ব্রেইন) — the owner's trusted COO advisor and conversational AI
for a Bangladeshi multi-business ERP (fuel stations, supershop, agro shop, restaurant, workshop, aquaculture ponds).

PERSONALITY: ChatGPT-style — warm, natural, multi-turn. You are a smart colleague, not a report bot.

LANGUAGE (critical):
1. ALWAYS reply in fluent Bangla in answer_bn — even if the user writes English, Banglish, or romanized Bengali.
2. Understand Banglish freely (e.g. "ajker sales kemon", "profit koto", "pond er FCR bolo").
3. English business terms (sales, profit, FCR, invoice) in user text are normal — explain in Bangla.

MODES:
- Business questions: answer DIRECTLY from ERP data. NEVER say "open Reports" or "run a report".
- Casual chat (thanks, jokes, explanations, general knowledge): reply naturally in Bangla; tie back to the business gently when relevant.
- Quote exact numbers (৳, kg, FCR, fish count, salaries) from JSON — never invent figures or names.

BUSINESS RULES:
1. For stocking: high load → partial harvest with kg/fish from stocking_recommendation; understocked → suggest increasing stocking.
2. For disease: draft prescription (ঔষধ, ডোজ, প্রয়োগ) from medicine_catalog + symptoms; requires_approval true.
3. For job cuts: release_candidates_advisory only — advisory, owner decides. Include disclaimer.
4. If data is missing, say what you know and ask one clear follow-up (missing_inputs).

DATA SOURCES:
1. business_snapshot — whole ERP state when present (not in light chat mode).
2. Focused blocks (pond_analytics, employees, etc.) when present.
3. WEB_RESEARCH_NOTE — supplement with web knowledge when present; cite URLs (kind=web).

Return ONLY a single JSON object (no markdown fences):
- answer_bn: string (conversational Bangla; lead with the direct answer)
- reasoning_steps_bn: array of strings
- confidence: "high" | "medium" | "low"
- sources: array of {kind: "erp"|"inference"|"web", type, id, label, path, url}
- missing_inputs: array of {key, prompt_bn}
- suggested_actions: array of {action, label_bn, requires_approval}"""

CHAT_MODE_INSTRUCTION = (
    "Conversational turn — reply naturally in Bangla like ChatGPT. "
    "User may chat casually OR ask business questions; use ERP data only when the question needs it. "
    "Do not dump MTD numbers unless asked."
)


def _trim_snapshot_for_llm(snap: Any) -> Any:
    """Always send a compact snapshot to the LLM — avoids huge JSON / memory errors."""
    if not isinstance(snap, dict) or snap.get("light_mode") or snap.get("partial"):
        return snap
    ponds_block = snap.get("ponds_performance_30d") or {}
    return {
        "truncated": True,
        "financials_mtd": snap.get("financials_mtd") or {},
        "sales_mtd": snap.get("sales_mtd"),
        "expenses_mtd": snap.get("expenses_mtd"),
        "record_counts": snap.get("record_counts"),
        "workforce_roster": (snap.get("workforce_roster") or [])[:10],
        "ponds_performance_30d": {
            "ponds": (ponds_block.get("ponds") or [])[:8],
        },
        "recent_invoices": (snap.get("recent_invoices") or [])[:6],
        "note": "Trimmed ERP snapshot; quoted numbers are authoritative.",
    }


def _trim_context_for_llm(context: dict[str, Any]) -> dict[str, Any]:
    snap = context.get("business_snapshot")
    return {
        **context,
        "business_snapshot": _trim_snapshot_for_llm(snap),
    }


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
        direct["sources"] = _erp_refs_as_sources(refs, limit=16)
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
) -> list[dict[str, str]]:
    history: list[dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]
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
            "INSTRUCTION": CHAT_MODE_INSTRUCTION,
        }
    else:
        payload = {
            "ERP_CONTEXT": _trim_context_for_llm(context),
            "USER_QUESTION": user_text,
            "TODAY": timezone.localdate().isoformat(),
            "INSTRUCTION": (
                "Answer like a human COO advisor in Bangla. User may write Banglish — understand it. "
                "Use business_snapshot for business questions. Do not redirect to reports."
            ),
        }
    history.append(
        {
            "role": "user",
            "content": _safe_json_dumps(payload),
        }
    )
    return history


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
    context, refs = tools.gather_context(
        int(company.id),
        user_text,
        context_entity_type=conversation.context_entity_type or "",
        context_entity_id=conversation.context_entity_id,
    )
    context["user_question"] = user_text

    if "greeting" in (context.get("intents") or []):
        structured = compose_direct_answer(context, lang=company.language or "bn") or _emergency_response(
            company, user_text
        )
        structured["sources"] = _erp_refs_as_sources(refs, limit=8)
        return structured, "erp-greeting"

    intents_set = set(context.get("intents") or [])
    conversational = intents_set == {"chat"}

    direct = compose_direct_answer(context, lang=company.language or "bn")

    if conversational:
        if not gateway.openrouter_configured(plan=plan):
            structured = direct or _offline_response(context, refs, user_text, plan=plan)
            structured["sources"] = _erp_refs_as_sources(refs, limit=8)
            return structured, "erp-chat"

        messages = _build_messages(conversation, user_text, context, conversational=True)
        model_id = gateway.model_for_role("fast", plan=plan)
        api_key = brain_config.api_key_for_plan(plan)
        raw, err = gateway.chat_completion(
            messages=messages, model=model_id, api_key=api_key, max_tokens=4096, temperature=0.75
        )
        if err or not raw:
            logger.warning("Brain chat LLM failed: %s", err)
            structured = direct or _offline_response(context, refs, user_text, plan=plan)
            if err:
                structured["answer_bn"] += f"\n\n(AI ত্রুটি: {err})"
            structured["sources"] = _erp_refs_as_sources(refs, limit=8)
            return structured, "erp-chat-fallback"

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
        _merge_sources(structured, refs)
        structured.setdefault("reasoning_steps_bn", ["সাধারণ কথোপকথন — বাংলায় উত্তর।"])
        structured.setdefault("confidence", "medium")
        return structured, model_id

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
