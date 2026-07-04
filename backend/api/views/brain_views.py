"""Company Brain API — chat, conversations, usage status."""
from __future__ import annotations

import logging

from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from api.models import BrainConversation, BrainInsight, BrainMessage, BrainPrediction, BrainUsageLog, Company
from api.services.brain import chat as brain_chat
from api.services.brain import plans as brain_plans
from api.services.brain.forecasting import build_forecast_pack, persist_predictions
from api.services.brain.insights_engine import generate_insights, list_active_insights
from api.services.brain.security import (
    brain_disabled_response,
    brain_enabled_for_company,
    get_company_settings,
)
from api.services.brain import usage_logging as brain_usage
from api.services.permission_service import has_permission, resolve_user_permissions
from api.utils.auth import (
    auth_required,
    company_context_error_response,
    get_company_id,
    get_user_from_request,
    user_is_super_admin,
)
from api.views.common import parse_json_body

logger = logging.getLogger(__name__)


def _brain_access_denied(request):
    user = get_user_from_request(request) or getattr(request, "api_user", None)
    if user_is_super_admin(user):
        return None
    perms = resolve_user_permissions(user) if user else []
    if has_permission(perms, "app.brain"):
        return None
    return JsonResponse(
        {"detail": "Company Brain access required. Ask your admin to grant app.brain permission."},
        status=403,
    )


def _serialize_message(msg: BrainMessage) -> dict:
    return {
        "id": msg.id,
        "role": msg.role,
        "content": msg.content,
        "structured": msg.structured or {},
        "model_used": msg.model_used or "",
        "created_at": msg.created_at.isoformat() if msg.created_at else None,
    }


def _serialize_conversation(conv: BrainConversation, *, include_messages: bool = False) -> dict:
    row = {
        "id": conv.id,
        "title": conv.title or "",
        "context_entity_type": conv.context_entity_type or "",
        "context_entity_id": conv.context_entity_id,
        "created_at": conv.created_at.isoformat() if conv.created_at else None,
        "updated_at": conv.updated_at.isoformat() if conv.updated_at else None,
    }
    if include_messages:
        row["messages"] = [
            _serialize_message(m)
            for m in conv.messages.order_by("created_at")
        ]
    return row


def _require_brain_enabled(company_id: int):
    if not brain_enabled_for_company(company_id):
        return brain_disabled_response()
    return None


SUGGESTED_QUESTIONS = [
    {"q": "ajker sales koto?", "label_bn": "আজকের বিক্রি কত?", "label_en": "Today's sales?"},
    {"q": "profit trend kemon?", "label_bn": "লাভের ট্রেন্ড কেমন?", "label_en": "Profit trend?"},
    {"q": "ke ke taka debe?", "label_bn": "কার কাছে বকেয়া?", "label_en": "Who owes money?"},
    {"q": "slow moving product kon?", "label_bn": "ধীর চলমান পণ্য?", "label_en": "Slow moving products?"},
    {"q": "cash flow pressure ache?", "label_bn": "ক্যাশ-ফ্লো চাপ?", "label_en": "Cash flow pressure?"},
    {"q": "compare amader business industry standard", "label_bn": "Industry তুলনা", "label_en": "Compare with industry"},
    {"q": "amader business er gap ki — worldwide companies er sathe", "label_bn": "গ্যাপ বিশ্লেষণ", "label_en": "Gap vs global business"},
    {"q": "how will collection follow-up solve my cash problem?", "label_bn": "সমাধান ব্যাখ্যা", "label_en": "How will this solve it?"},
    {"q": "management ekhon ki korbe?", "label_bn": "ম্যানেজমেন্ট কী করবে?", "label_en": "What should management do?"},
    {"q": "purbabhash dio — business continue hole ki hobe", "label_bn": "পূর্বাভাস", "label_en": "Forecast if trend continues"},
]


@csrf_exempt
@auth_required
@require_GET
def brain_suggested_questions(request):
    denied = _brain_access_denied(request)
    if denied:
        return denied
    return JsonResponse({"questions": SUGGESTED_QUESTIONS})


@csrf_exempt
@auth_required
@require_GET
def brain_status(request):
    denied = _brain_access_denied(request)
    if denied:
        return denied
    cid = get_company_id(request)
    err = company_context_error_response(request)
    if err:
        return err
    company = _company_or_404(int(cid))
    if not company:
        return JsonResponse({"detail": "Company not found."}, status=404)
    disabled = _require_brain_enabled(int(company.id))
    if disabled:
        return disabled
    status = brain_plans.usage_status(company)
    settings = get_company_settings(int(company.id))
    status["brain_enabled"] = settings.brain_enabled
    status["default_advisor_mode"] = settings.default_advisor_mode
    status["usage_month"] = brain_usage.usage_summary_for_company(int(company.id))
    return JsonResponse(status)


@csrf_exempt
@auth_required
@require_http_methods(["GET", "POST"])
def brain_conversations(request):
    denied = _brain_access_denied(request)
    if denied:
        return denied
    cid = get_company_id(request)
    err = company_context_error_response(request)
    if err:
        return err
    company_id = int(cid)

    if request.method == "GET":
        rows = BrainConversation.objects.filter(company_id=company_id).order_by("-updated_at")[:50]
        return JsonResponse({"results": [_serialize_conversation(c) for c in rows]})

    body, err_resp = parse_json_body(request)
    if err_resp:
        return err_resp
    title = (body.get("title") or "").strip()
    context_entity_type = (body.get("context_entity_type") or "").strip().lower()
    context_entity_id = body.get("context_entity_id")
    user = get_user_from_request(request)
    conv = BrainConversation.objects.create(
        company_id=company_id,
        user_id=user.id if user else None,
        title=title,
        context_entity_type=context_entity_type,
        context_entity_id=int(context_entity_id) if context_entity_id not in (None, "") else None,
    )
    return JsonResponse(_serialize_conversation(conv), status=201)


@csrf_exempt
@auth_required
@require_GET
def brain_conversation_detail(request, conversation_id: int):
    denied = _brain_access_denied(request)
    if denied:
        return denied
    cid = get_company_id(request)
    err = company_context_error_response(request)
    if err:
        return err
    conv = BrainConversation.objects.filter(pk=conversation_id, company_id=int(cid)).first()
    if not conv:
        return JsonResponse({"detail": "Conversation not found."}, status=404)
    return JsonResponse(_serialize_conversation(conv, include_messages=True))


@csrf_exempt
@auth_required
@require_http_methods(["POST"])
def brain_conversation_message(request, conversation_id: int):
    denied = _brain_access_denied(request)
    if denied:
        return denied
    cid = get_company_id(request)
    err = company_context_error_response(request)
    if err:
        return err
    company = _company_or_404(int(cid))
    if not company:
        return JsonResponse({"detail": "Company not found."}, status=404)
    disabled = _require_brain_enabled(int(company.id))
    if disabled:
        return disabled

    conv = BrainConversation.objects.filter(pk=conversation_id, company_id=int(cid)).first()
    if not conv:
        return JsonResponse({"detail": "Conversation not found."}, status=404)

    body, err_resp = parse_json_body(request)
    if err_resp:
        return err_resp
    text = (body.get("message") or body.get("content") or "").strip()
    if not text:
        return JsonResponse({"detail": "message is required."}, status=400)

    ok, limit_msg = brain_plans.assert_can_send_message(company)
    if not ok:
        return JsonResponse({"detail": limit_msg, "usage": brain_plans.usage_status(company)}, status=429)

    budget_ok, budget_msg = brain_usage.assert_within_monthly_budget(int(company.id))
    if not budget_ok:
        return JsonResponse(
            {"detail": budget_msg, "usage": brain_plans.usage_status(company)},
            status=429,
        )

    with transaction.atomic():
        assistant = brain_chat.append_user_and_assistant_resilient(conv, text, company=company)

    user_msg = (
        BrainMessage.objects.filter(conversation=conv, role=BrainMessage.ROLE_USER)
        .order_by("-created_at")
        .first()
    )
    return JsonResponse(
        {
            "user_message": _serialize_message(user_msg) if user_msg else None,
            "assistant_message": _serialize_message(assistant),
            "usage": brain_plans.usage_status(company),
        }
    )


@csrf_exempt
@auth_required
@require_http_methods(["POST"])
def brain_transcribe(request):
    """Transcribe voice audio (Bangla/English) — fallback for devices without Web Speech API."""
    denied = _brain_access_denied(request)
    if denied:
        return denied
    cid = get_company_id(request)
    err = company_context_error_response(request)
    if err:
        return err
    company = _company_or_404(int(cid))
    if not company:
        return JsonResponse({"detail": "Company not found."}, status=404)
    disabled = _require_brain_enabled(int(company.id))
    if disabled:
        return disabled

    upload = request.FILES.get("audio")
    if not upload:
        return JsonResponse({"detail": "audio file is required."}, status=400)

    language = (request.POST.get("language") or "bn").strip().lower()
    if language not in ("bn", "en", "bn-bd", "bn-in"):
        language = "bn"

    audio_bytes = upload.read()
    mime = (upload.content_type or "audio/webm").strip()

    from api.services.brain import plans as brain_plans_module
    from api.services.brain.speech_transcription import transcribe_audio_bytes

    plan = brain_plans_module.brain_plan_for_company(company)
    if not brain_plans_module.usage_status(company).get("llm_enabled"):
        return JsonResponse(
            {"detail": "Brain API not configured — cannot transcribe voice on this device."},
            status=503,
        )

    text, error = transcribe_audio_bytes(
        audio_bytes,
        mime_type=mime,
        language=language,
        plan=plan,
    )
    if error and not text:
        return JsonResponse({"detail": error}, status=502)
    return JsonResponse({"transcript": text or "", "language": language})


def _company_or_404(company_id: int) -> Company | None:
    return Company.objects.filter(pk=company_id, is_deleted=False).first()


@csrf_exempt
@auth_required
@require_GET
def brain_insights(request):
    """GET /api/brain/insights/ — AI-generated business insights for dashboard."""
    denied = _brain_access_denied(request)
    if denied:
        return denied
    cid = get_company_id(request)
    err = company_context_error_response(request)
    if err:
        return err
    company_id = int(cid)
    disabled = _require_brain_enabled(company_id)
    if disabled:
        return disabled

    refresh = request.GET.get("refresh") == "1"
    if refresh or not BrainInsight.objects.filter(company_id=company_id, is_dismissed=False).exists():
        generate_insights(company_id, persist=True)
    return JsonResponse({"results": list_active_insights(company_id)})


@csrf_exempt
@auth_required
@require_GET
def brain_predictions(request):
    """GET /api/brain/predictions/ — forecasts from ERP data."""
    denied = _brain_access_denied(request)
    if denied:
        return denied
    cid = get_company_id(request)
    err = company_context_error_response(request)
    if err:
        return err
    company_id = int(cid)
    disabled = _require_brain_enabled(company_id)
    if disabled:
        return disabled

    live = request.GET.get("live") == "1"
    if live:
        pack = build_forecast_pack(company_id, question_type="forecasting")
        forecasts = pack.get("forecasts") or []
        if forecasts:
            persist_predictions(company_id, forecasts)
        return JsonResponse(pack)

    rows = BrainPrediction.objects.filter(company_id=company_id).order_by("-created_at")[:20]
    return JsonResponse(
        {
            "results": [
                {
                    "id": r.id,
                    "prediction_type": r.prediction_type,
                    "title_bn": r.title_bn,
                    "summary_bn": r.summary_bn,
                    "forecast_data": r.forecast_data,
                    "confidence": r.confidence,
                    "assumptions_bn": r.assumptions_bn,
                    "horizon_days": r.horizon_days,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                }
                for r in rows
            ]
        }
    )


@csrf_exempt
@auth_required
@require_http_methods(["GET", "PUT"])
def brain_company_settings(request):
    """GET/PUT /api/brain/settings/ — company-level AI settings (admin/owner)."""
    denied = _brain_access_denied(request)
    if denied:
        return denied
    cid = get_company_id(request)
    err = company_context_error_response(request)
    if err:
        return err
    company_id = int(cid)
    settings = get_company_settings(company_id)

    if request.method == "GET":
        return JsonResponse(
            {
                "brain_enabled": settings.brain_enabled,
                "default_advisor_mode": settings.default_advisor_mode,
                "monthly_token_budget": settings.monthly_token_budget,
                "monthly_cost_budget_usd": str(settings.monthly_cost_budget_usd or ""),
                "allowed_models": settings.allowed_models or [],
                "usage_month": brain_usage.usage_summary_for_company(company_id),
            }
        )

    user = get_user_from_request(request)
    if not user_is_super_admin(user):
        perms = resolve_user_permissions(user) if user else []
        if not has_permission(perms, "app.company_settings"):
            return JsonResponse({"detail": "Company settings permission required."}, status=403)

    body, err_resp = parse_json_body(request)
    if err_resp:
        return err_resp
    if "brain_enabled" in body:
        settings.brain_enabled = bool(body.get("brain_enabled"))
    if "default_advisor_mode" in body:
        mode = (body.get("default_advisor_mode") or "manager").strip()[:32]
        if mode in ("manager", "accountant", "inventory", "sales", "hr", "ceo", "risk"):
            settings.default_advisor_mode = mode
    if "monthly_token_budget" in body:
        val = body.get("monthly_token_budget")
        settings.monthly_token_budget = int(val) if val not in (None, "") else None
    settings.save()
    return JsonResponse({"ok": True})


@csrf_exempt
@auth_required
@require_http_methods(["POST"])
def brain_insight_dismiss(request, insight_id: int):
    """POST /api/brain/insights/<id>/dismiss/ — hide an insight from the dashboard."""
    denied = _brain_access_denied(request)
    if denied:
        return denied
    cid = get_company_id(request)
    err = company_context_error_response(request)
    if err:
        return err
    company_id = int(cid)
    row = BrainInsight.objects.filter(pk=insight_id, company_id=company_id).first()
    if not row:
        return JsonResponse({"detail": "Insight not found."}, status=404)
    row.is_dismissed = True
    row.save(update_fields=["is_dismissed"])
    return JsonResponse({"ok": True})


@csrf_exempt
@auth_required
@require_GET
def brain_usage_logs(request):
    """GET /api/brain/usage/ — token/cost usage for current company."""
    denied = _brain_access_denied(request)
    if denied:
        return denied
    cid = get_company_id(request)
    err = company_context_error_response(request)
    if err:
        return err
    company_id = int(cid)
    rows = BrainUsageLog.objects.filter(company_id=company_id).order_by("-created_at")[:50]
    return JsonResponse(
        {
            "summary": brain_usage.usage_summary_for_company(company_id),
            "results": [
                {
                    "id": r.id,
                    "model": r.model,
                    "total_tokens": r.total_tokens,
                    "estimated_cost_usd": str(r.estimated_cost_usd),
                    "question_type": r.question_type,
                    "success": r.success,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                }
                for r in rows
            ],
        }
    )
