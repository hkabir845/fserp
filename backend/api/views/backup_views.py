"""Tenant backup (download) and restore (full replace)."""

import logging

from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from api.models import BackupRestoreAudit, Company
from api.services.tenant_backup import (
    BACKUP_EXCLUDED_MODELS,
    BACKUP_SCHEMA_VERSION,
    EXPECTED_BACKUP_MODELS,
    RESTORE_CONFIRM_PHRASE,
    backup_bundle_json_bytes,
    build_backup_bundle,
    record_backup_restore_audit,
    restore_bundle,
    _parse_bundle,
)

# Recent backup/restore audit rows surfaced in the UI; bounded to keep the payload small.
BACKUP_HISTORY_LIMIT = 50
from api.services.permission_service import has_permission, resolve_user_permissions
from api.utils.auth import auth_required, company_context_error_response, get_company_id, user_is_super_admin

logger = logging.getLogger(__name__)


def _actor_audit_fields(request):
    """(actor_user_id, actor_label, ip_address) for backup/restore audit rows."""
    user = getattr(request, "api_user", None)
    uid = getattr(user, "id", None)
    label = getattr(user, "username", "") or getattr(user, "email", "") or ""
    xff = request.META.get("HTTP_X_FORWARDED_FOR", "")
    ip = (xff.split(",")[0].strip() if xff else request.META.get("REMOTE_ADDR", "")) or ""
    return uid, label, ip


def _user_can_backup(user) -> bool:
    """Tenant backup/restore requires ``app.backup`` (Admin, Manager, or custom role)."""
    if user_is_super_admin(user):
        return True
    return has_permission(resolve_user_permissions(user), "app.backup")


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

    uid, label, ip = _actor_audit_fields(request)
    try:
        payload = backup_bundle_json_bytes(cid)
    except ValueError as e:
        record_backup_restore_audit(
            company_id=cid, action="backup_download", success=False, source="tenant",
            actor_user_id=uid, actor_label=label, ip_address=ip, error_message=str(e),
        )
        return JsonResponse({"detail": str(e)}, status=404)
    except Exception as e:
        logger.exception("company backup download failed company_id=%s", cid)
        record_backup_restore_audit(
            company_id=cid, action="backup_download", success=False, source="tenant",
            actor_user_id=uid, actor_label=label, ip_address=ip, error_message=str(e),
        )
        return JsonResponse({"detail": "Backup generation failed.", "error": str(e)}, status=500)

    record_backup_restore_audit(
        company_id=cid, action="backup_download", success=True, source="tenant",
        actor_user_id=uid, actor_label=label, ip_address=ip, bytes_size=len(payload),
    )
    name = f"fserp_company_{cid}_backup.json"
    resp = HttpResponse(payload, content_type="application/json; charset=utf-8")
    resp["Content-Disposition"] = f'attachment; filename="{name}"'
    resp["X-Backup-Company-Id"] = str(cid)
    resp["X-Backup-Schema-Version"] = str(BACKUP_SCHEMA_VERSION)
    resp["X-FSERP-Backup-Json"] = "sanitize-v1"
    resp["Cache-Control"] = "no-store"
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

    uid, label, ip = _actor_audit_fields(request)
    confirm = (request.POST.get("confirm_replace") or "").strip()
    try:
        raw = f.read()
        bundle = _parse_bundle(raw)
        result = restore_bundle(bundle, cid, confirm_replace=confirm)
        record_backup_restore_audit(
            company_id=cid, action="restore", success=True, source="tenant",
            actor_user_id=uid, actor_label=label, ip_address=ip,
            record_count=result.get("restored_objects"),
            safety_snapshot_path=result.get("safety_snapshot") or "",
            detail={"schema_version": result.get("schema_version")},
        )
        return JsonResponse(result)
    except ValueError as e:
        record_backup_restore_audit(
            company_id=cid, action="restore", success=False, source="tenant",
            actor_user_id=uid, actor_label=label, ip_address=ip, error_message=str(e),
        )
        return JsonResponse({"detail": str(e)}, status=400)
    except Exception as e:
        record_backup_restore_audit(
            company_id=cid, action="restore", success=False, source="tenant",
            actor_user_id=uid, actor_label=label, ip_address=ip, error_message=str(e),
        )
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
            "model_count": len(bundle.get("model_labels") or []),
            "model_labels": bundle.get("model_labels") or [],
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

    uid, label, ip = _actor_audit_fields(request)
    try:
        payload = backup_bundle_json_bytes(company_id)
    except ValueError as e:
        record_backup_restore_audit(
            company_id=company_id, action="backup_download", success=False, source="admin",
            actor_user_id=uid, actor_label=label, ip_address=ip, error_message=str(e),
        )
        return JsonResponse({"detail": str(e)}, status=404)
    except Exception as e:
        logger.exception("admin backup download failed company_id=%s", company_id)
        record_backup_restore_audit(
            company_id=company_id, action="backup_download", success=False, source="admin",
            actor_user_id=uid, actor_label=label, ip_address=ip, error_message=str(e),
        )
        return JsonResponse({"detail": "Backup generation failed.", "error": str(e)}, status=500)

    record_backup_restore_audit(
        company_id=company_id, action="backup_download", success=True, source="admin",
        actor_user_id=uid, actor_label=label, ip_address=ip, bytes_size=len(payload),
    )
    name = f"fserp_company_{company_id}_backup.json"
    resp = HttpResponse(payload, content_type="application/json; charset=utf-8")
    resp["Content-Disposition"] = f'attachment; filename="{name}"'
    resp["X-Backup-Company-Id"] = str(company_id)
    resp["X-Backup-Schema-Version"] = str(BACKUP_SCHEMA_VERSION)
    resp["X-FSERP-Backup-Json"] = "sanitize-v1"
    resp["Cache-Control"] = "no-store"
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

    uid, label, ip = _actor_audit_fields(request)
    confirm = (request.POST.get("confirm_replace") or "").strip()
    try:
        raw = f.read()
        bundle = _parse_bundle(raw)
        result = restore_bundle(bundle, company_id, confirm_replace=confirm)
        record_backup_restore_audit(
            company_id=company_id, action="restore", success=True, source="admin",
            actor_user_id=uid, actor_label=label, ip_address=ip,
            record_count=result.get("restored_objects"),
            safety_snapshot_path=result.get("safety_snapshot") or "",
            detail={"schema_version": result.get("schema_version")},
        )
        return JsonResponse(result)
    except ValueError as e:
        record_backup_restore_audit(
            company_id=company_id, action="restore", success=False, source="admin",
            actor_user_id=uid, actor_label=label, ip_address=ip, error_message=str(e),
        )
        return JsonResponse({"detail": str(e)}, status=400)
    except Exception as e:
        record_backup_restore_audit(
            company_id=company_id, action="restore", success=False, source="admin",
            actor_user_id=uid, actor_label=label, ip_address=ip, error_message=str(e),
        )
        return JsonResponse({"detail": "Restore failed.", "error": str(e)}, status=500)


def _serialize_audit(row: BackupRestoreAudit) -> dict:
    return {
        "id": row.id,
        "company_id": row.company_id,
        "action": row.action,
        "success": row.success,
        "actor_label": row.actor_label,
        "source": row.source,
        "ip_address": row.ip_address,
        "record_count": row.record_count,
        "bytes_size": row.bytes_size,
        "safety_snapshot_path": row.safety_snapshot_path,
        "error_message": row.error_message,
        "detail": row.detail,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _audit_history_payload(company_id: int) -> dict:
    rows = list(
        BackupRestoreAudit.objects.filter(company_id=company_id).order_by("-created_at")[
            :BACKUP_HISTORY_LIMIT
        ]
    )
    return {"results": [_serialize_audit(r) for r in rows], "limit": BACKUP_HISTORY_LIMIT}


@csrf_exempt
@auth_required
@require_GET
def company_backup_restore_history(request):
    """GET /api/company/backup/history/ — recent backup/restore audit rows for the current tenant."""
    user = request.api_user
    if not _user_can_backup(user):
        return JsonResponse({"detail": "Only company administrators can view backup history."}, status=403)

    cid = get_company_id(request)
    err = company_context_error_response(request)
    if err:
        return err
    if not cid:
        return JsonResponse({"detail": "Company context required."}, status=400)

    if not _ensure_tenant_admin_company_access(request, cid):
        return JsonResponse({"detail": "You can only view your own company's history."}, status=403)

    return JsonResponse(_audit_history_payload(cid))


@csrf_exempt
@auth_required
@require_GET
def admin_company_backup_restore_history(request, company_id: int):
    """GET /api/admin/companies/<id>/backup/history/ — audit rows for any tenant (super admin only)."""
    user = request.api_user
    if not user_is_super_admin(user):
        return JsonResponse({"detail": "Super admin only."}, status=403)

    if not Company.objects.filter(pk=company_id, is_deleted=False).exists():
        return JsonResponse({"detail": "Company not found."}, status=404)

    return JsonResponse(_audit_history_payload(company_id))


# Expose confirmation phrase for API docs / frontend constants
@csrf_exempt
@auth_required
@require_GET
def backup_restore_constants(request):
    """GET /api/backup/constants/ — restore confirmation phrase (auth required)."""
    return JsonResponse(
        {
            "restore_confirm_phrase": RESTORE_CONFIRM_PHRASE,
            "schema_version": BACKUP_SCHEMA_VERSION,
            "expected_model_count": len(EXPECTED_BACKUP_MODELS),
            "excluded_models": sorted(BACKUP_EXCLUDED_MODELS),
            "excluded_reason": (
                "Password reset tokens are single-use secrets. "
                "Backup/restore audit rows are never exported so restore cannot rewrite compliance history."
            ),
        }
    )
