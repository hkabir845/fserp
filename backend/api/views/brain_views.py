"""Company Brain API — chat, conversations, usage status."""
from __future__ import annotations

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from api.models import BrainConversation, BrainMessage, Company
from api.services.brain import chat as brain_chat
from api.services.brain import plans as brain_plans
from api.services.permission_service import has_permission, resolve_user_permissions
from api.utils.auth import (
    auth_required,
    company_context_error_response,
    get_company_id,
    get_user_from_request,
    user_is_super_admin,
)
from api.views.common import parse_json_body


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


def _company_or_404(company_id: int) -> Company | None:
    return Company.objects.filter(pk=company_id, is_deleted=False).first()


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
    return JsonResponse(brain_plans.usage_status(company))


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

    assistant = brain_chat.append_user_and_assistant(conv, text, company=company)
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
