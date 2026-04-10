"""Tenant backup (download) and restore (full replace)."""

from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from api.models import Company
from api.services.tenant_backup import (
    RESTORE_CONFIRM_PHRASE,
    backup_bundle_json_bytes,
    build_backup_bundle,
    restore_bundle,
    _parse_bundle,
)
from api.utils.auth import auth_required, company_context_error_response, get_company_id, user_is_super_admin


def _user_can_backup(user) -> bool:
    r = (getattr(user, "role", None) or "").strip().lower().replace(" ", "_").replace("-", "_")
    return r in ("admin", "super_admin")


def _ensure_tenant_admin_company_access(request, company_id: int) -> bool:
    """Non-super users may only act on their own company_id."""
    user = request.api_user
    if user_is_super_admin(user):
        return True
    uid = getattr(user, "company_id", None)
    return uid is not None and int(uid) == int(company_id)


@csrf_exempt
@auth_required
@require_GET
def company_backup_download(request):
    """
    GET /api/company/backup/
    Exports current tenant (from get_company_id / X-Selected-Company-Id).
    """
    user = request.api_user
    if not _user_can_backup(user):
        return JsonResponse({"detail": "Only company administrators can export backups."}, status=403)

    cid = get_company_id(request)
    err = company_context_error_response(request)
    if err:
        return err
    if not cid:
        return JsonResponse({"detail": "Company context required."}, status=400)

    if not _ensure_tenant_admin_company_access(request, cid):
        return JsonResponse({"detail": "You can only back up your own company."}, status=403)

    try:
        payload = backup_bundle_json_bytes(cid)
    except ValueError as e:
        return JsonResponse({"detail": str(e)}, status=404)

    name = f"fserp_company_{cid}_backup.json"
    resp = HttpResponse(payload, content_type="application/json; charset=utf-8")
    resp["Content-Disposition"] = f'attachment; filename="{name}"'
    return resp


@csrf_exempt
@auth_required
@require_http_methods(["POST"])
def company_restore_upload(request):
    """
    POST /api/company/restore/ — multipart: file + confirm_replace=DELETE_ALL_TENANT_DATA
    Restores into current tenant company id (must match backup).
    """
    user = request.api_user
    if not _user_can_backup(user):
        return JsonResponse({"detail": "Only company administrators can restore backups."}, status=403)

    cid = get_company_id(request)
    err = company_context_error_response(request)
    if err:
        return err
    if not cid:
        return JsonResponse({"detail": "Company context required."}, status=400)

    if not _ensure_tenant_admin_company_access(request, cid):
        return JsonResponse({"detail": "You can only restore into your own company."}, status=403)

    f = request.FILES.get("file")
    if not f:
        return JsonResponse({"detail": "Missing backup file (field name: file)."}, status=400)

    confirm = (request.POST.get("confirm_replace") or "").strip()
    try:
        raw = f.read()
        bundle = _parse_bundle(raw)
        result = restore_bundle(bundle, cid, confirm_replace=confirm)
        return JsonResponse(result)
    except ValueError as e:
        return JsonResponse({"detail": str(e)}, status=400)
    except Exception as e:
        return JsonResponse({"detail": "Restore failed.", "error": str(e)}, status=500)


@csrf_exempt
@auth_required
@require_GET
def admin_company_backup_preview(request, company_id: int):
    """GET /api/admin/companies/<id>/backup/preview/ — JSON metadata (super admin only)."""
    user = request.api_user
    if not user_is_super_admin(user):
        return JsonResponse({"detail": "Super admin only."}, status=403)

    if not Company.objects.filter(pk=company_id, is_deleted=False).exists():
        return JsonResponse({"detail": "Company not found."}, status=404)

    try:
        bundle = build_backup_bundle(company_id)
    except ValueError as e:
        return JsonResponse({"detail": str(e)}, status=404)

    return JsonResponse(
        {
            "company_id": bundle["company_id"],
            "company_name": bundle["company_name"],
            "exported_at": bundle["exported_at"],
            "record_count": len(bundle["records"]),
            "schema_version": bundle["schema_version"],
        }
    )


@csrf_exempt
@auth_required
@require_GET
def admin_company_backup_download(request, company_id: int):
    """GET /api/admin/companies/<id>/backup/ — download JSON (super admin only)."""
    user = request.api_user
    if not user_is_super_admin(user):
        return JsonResponse({"detail": "Super admin only."}, status=403)

    if not Company.objects.filter(pk=company_id, is_deleted=False).exists():
        return JsonResponse({"detail": "Company not found."}, status=404)

    try:
        payload = backup_bundle_json_bytes(company_id)
    except ValueError as e:
        return JsonResponse({"detail": str(e)}, status=404)

    name = f"fserp_company_{company_id}_backup.json"
    resp = HttpResponse(payload, content_type="application/json; charset=utf-8")
    resp["Content-Disposition"] = f'attachment; filename="{name}"'
    return resp


@csrf_exempt
@auth_required
@require_http_methods(["POST"])
def admin_company_restore_upload(request, company_id: int):
    """
    POST /api/admin/companies/<id>/restore/
    multipart: file + confirm_replace=DELETE_ALL_TENANT_DATA
    """
    user = request.api_user
    if not user_is_super_admin(user):
        return JsonResponse({"detail": "Super admin only."}, status=403)

    if not Company.objects.filter(pk=company_id, is_deleted=False).exists():
        return JsonResponse({"detail": "Company not found."}, status=404)

    f = request.FILES.get("file")
    if not f:
        return JsonResponse({"detail": "Missing backup file (field name: file)."}, status=400)

    confirm = (request.POST.get("confirm_replace") or "").strip()
    try:
        raw = f.read()
        bundle = _parse_bundle(raw)
        result = restore_bundle(bundle, company_id, confirm_replace=confirm)
        return JsonResponse(result)
    except ValueError as e:
        return JsonResponse({"detail": str(e)}, status=400)
    except Exception as e:
        return JsonResponse({"detail": "Restore failed.", "error": str(e)}, status=500)


# Expose confirmation phrase for API docs / frontend constants
@csrf_exempt
@auth_required
@require_GET
def backup_restore_constants(request):
    """GET /api/backup/constants/ — restore confirmation phrase (auth required)."""
    return JsonResponse({"restore_confirm_phrase": RESTORE_CONFIRM_PHRASE})
