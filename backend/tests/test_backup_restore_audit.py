"""Audit trail + pre-restore safety snapshot for tenant backup/restore (IT governance)."""

from __future__ import annotations

import json
import os

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from api.models import BackupRestoreAudit, Customer
from api.services.tenant_backup import (
    RESTORE_CONFIRM_PHRASE,
    backup_bundle_json_bytes,
    restore_bundle,
)

pytestmark = pytest.mark.django_db


def test_backup_download_records_audit(api_client, auth_admin_headers, company_tenant):
    dl = api_client.get("/api/company/backup/", **auth_admin_headers)
    assert dl.status_code == 200

    row = (
        BackupRestoreAudit.objects.filter(company_id=company_tenant.id, action="backup_download")
        .latest("created_at")
    )
    assert row.success is True
    assert row.source == "tenant"
    assert (row.bytes_size or 0) > 0
    assert row.actor_user_id is not None


def test_restore_records_success_audit(api_client, auth_admin_headers, company_tenant):
    Customer.objects.create(
        company_id=company_tenant.id, display_name="Audit RTC", customer_number="AUD-1"
    )
    blob = api_client.get("/api/company/backup/", **auth_admin_headers).content

    up = api_client.post(
        "/api/company/restore/",
        data={
            "confirm_replace": RESTORE_CONFIRM_PHRASE,
            "file": SimpleUploadedFile("backup.json", blob, content_type="application/json"),
        },
        **auth_admin_headers,
    )
    assert up.status_code == 200, up.content.decode()

    row = (
        BackupRestoreAudit.objects.filter(company_id=company_tenant.id, action="restore")
        .latest("created_at")
    )
    assert row.success is True
    assert row.source == "tenant"
    assert (row.record_count or 0) > 0
    assert row.actor_user_id is not None


def test_restore_bad_confirm_records_failure_audit(api_client, auth_admin_headers, company_tenant):
    blob = api_client.get("/api/company/backup/", **auth_admin_headers).content

    up = api_client.post(
        "/api/company/restore/",
        data={
            "confirm_replace": "WRONG_PHRASE",
            "file": SimpleUploadedFile("backup.json", blob, content_type="application/json"),
        },
        **auth_admin_headers,
    )
    assert up.status_code == 400

    row = (
        BackupRestoreAudit.objects.filter(company_id=company_tenant.id, action="restore")
        .latest("created_at")
    )
    assert row.success is False
    assert row.error_message


def test_pre_restore_safety_snapshot_written_when_dir_set(tmp_path, company_tenant):
    bundle = json.loads(backup_bundle_json_bytes(company_tenant.id).decode("utf-8"))
    with override_settings(TENANT_SAFETY_BACKUP_DIR=str(tmp_path)):
        result = restore_bundle(bundle, company_tenant.id, confirm_replace=RESTORE_CONFIRM_PHRASE)

    snap = result.get("safety_snapshot")
    assert snap and os.path.exists(snap)
    assert len(list(tmp_path.glob("company_*_pre_restore_*.json"))) == 1


def test_no_snapshot_when_dir_unset(company_tenant):
    bundle = json.loads(backup_bundle_json_bytes(company_tenant.id).decode("utf-8"))
    with override_settings(TENANT_SAFETY_BACKUP_DIR=None):
        result = restore_bundle(bundle, company_tenant.id, confirm_replace=RESTORE_CONFIRM_PHRASE)
    assert result.get("safety_snapshot") is None
