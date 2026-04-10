"""Broadcasts API: list, create, get, update, delete, my, read, mark-applied, mark-active, mark-all-applied."""
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone

from api.utils.auth import auth_required, get_user_from_request, user_is_super_admin
from api.views.common import parse_json_body
from api.models import Broadcast, BroadcastRead, Company


def _broadcast_to_json(b):
    target_company_name = None
    if b.company_id:
        co = Company.objects.filter(id=b.company_id, is_deleted=False).only("name").first()
        if co:
            target_company_name = co.name
    return {
        "id": b.id,
        "company_id": b.company_id,
        "title": b.title,
        "message": b.message or "",
        "target": b.target or "all",
        "target_company_id": b.company_id,
        "target_company_name": target_company_name,
        "broadcast_type": getattr(b, "broadcast_type", "general") or "general",
        "priority": getattr(b, "priority", "medium") or "medium",
        "target_role": getattr(b, "target_role", "") or "",
        "scheduled_at": b.created_at.isoformat() if b.created_at else None,
        "expires_at": getattr(b, "expires_at", None).isoformat() if getattr(b, "expires_at", None) else None,
        "is_active": b.is_active,
        "applied_at": b.applied_at.isoformat() if b.applied_at else None,
        "created_at": b.created_at.isoformat() if b.created_at else None,
    }


@csrf_exempt
@auth_required
def broadcasts_list_or_create(request):
    user = getattr(request, "api_user", None) or get_user_from_request(request)
    if not user:
        return JsonResponse({"detail": "Authentication required"}, status=401)
    if not user_is_super_admin(user):
        return JsonResponse({"detail": "Super Admin access required"}, status=403)

    if request.method == "GET":
        qs = Broadcast.objects.all().order_by("-created_at")
        return JsonResponse([_broadcast_to_json(b) for b in qs], safe=False)

    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        title = (body.get("title") or "").strip()
        message = (body.get("message") or "").strip()
        if not title:
            return JsonResponse({"detail": "title is required"}, status=400)
        b = Broadcast(
            title=title,
            message=message,
            company_id=body.get("target_company_id") or None,
            target="specific" if body.get("target_company_id") else "all",
            is_active=True,
        )
        b.save()
        return JsonResponse(_broadcast_to_json(b), status=201)

    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
def broadcast_detail(request, broadcast_id: int):
    user = getattr(request, "api_user", None) or get_user_from_request(request)
    if not user or not user_is_super_admin(user):
        return JsonResponse({"detail": "Super Admin access required"}, status=403)
    b = Broadcast.objects.filter(id=broadcast_id).first()
    if not b:
        return JsonResponse({"detail": "Broadcast not found"}, status=404)

    if request.method == "GET":
        return JsonResponse(_broadcast_to_json(b))
    if request.method == "PUT":
        body, err = parse_json_body(request)
        if err:
            return err
        if body.get("title") is not None:
            b.title = (body.get("title") or "").strip() or b.title
        if "message" in body:
            b.message = (body.get("message") or "").strip()
        if "target_company_id" in body:
            b.company_id = body.get("target_company_id") or None
            b.target = "specific" if b.company_id else "all"
        b.save()
        return JsonResponse(_broadcast_to_json(b))
    if request.method == "DELETE":
        b.delete()
        return JsonResponse({"detail": "Deleted"}, status=200)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
def broadcasts_my(request):
    """Return broadcasts for current user (tenant); optional ?unread_only=true."""
    user = getattr(request, "api_user", None) or get_user_from_request(request)
    if not user:
        return JsonResponse({"detail": "Authentication required"}, status=401)
    user_id = user.id
    company_id = getattr(user, "company_id", None)
    unread_only = request.GET.get("unread_only", "").lower() in ("true", "1", "yes")
    qs = Broadcast.objects.filter(is_active=True, applied_at__isnull=True).order_by("-created_at")
    if company_id:
        from django.db.models import Q
        qs = qs.filter(Q(company_id__isnull=True) | Q(company_id=company_id))
    else:
        qs = qs.filter(company_id__isnull=True)
    out = []
    for b in qs:
        if unread_only and BroadcastRead.objects.filter(broadcast_id=b.id, user_id=user_id).exists():
            continue
        out.append(_broadcast_to_json(b))
    return JsonResponse(out, safe=False)


@csrf_exempt
@auth_required
def broadcast_read(request, broadcast_id: int):
    user = getattr(request, "api_user", None) or get_user_from_request(request)
    if not user:
        return JsonResponse({"detail": "Authentication required"}, status=401)
    b = Broadcast.objects.filter(id=broadcast_id).first()
    if not b:
        return JsonResponse({"detail": "Broadcast not found"}, status=404)
    BroadcastRead.objects.get_or_create(user_id=user.id, broadcast_id=b.id)
    return JsonResponse({"ok": True})


@csrf_exempt
@auth_required
def broadcast_mark_applied(request, broadcast_id: int):
    user = getattr(request, "api_user", None) or get_user_from_request(request)
    if not user or not user_is_super_admin(user):
        return JsonResponse({"detail": "Super Admin access required"}, status=403)
    b = Broadcast.objects.filter(id=broadcast_id).first()
    if not b:
        return JsonResponse({"detail": "Broadcast not found"}, status=404)
    b.applied_at = timezone.now()
    b.is_active = False
    b.save()
    return JsonResponse(_broadcast_to_json(b))


@csrf_exempt
@auth_required
def broadcast_mark_active(request, broadcast_id: int):
    user = getattr(request, "api_user", None) or get_user_from_request(request)
    if not user or not user_is_super_admin(user):
        return JsonResponse({"detail": "Super Admin access required"}, status=403)
    b = Broadcast.objects.filter(id=broadcast_id).first()
    if not b:
        return JsonResponse({"detail": "Broadcast not found"}, status=404)
    b.applied_at = None
    b.is_active = True
    b.save()
    return JsonResponse(_broadcast_to_json(b))


@csrf_exempt
@auth_required
def broadcast_mark_all_applied(request):
    user = getattr(request, "api_user", None) or get_user_from_request(request)
    if not user or not user_is_super_admin(user):
        return JsonResponse({"detail": "Super Admin access required"}, status=403)
    Broadcast.objects.filter(is_active=True, applied_at__isnull=True).update(applied_at=timezone.now(), is_active=False)
    return JsonResponse({"ok": True})
