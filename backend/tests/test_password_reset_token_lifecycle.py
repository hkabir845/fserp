"""Password reset token purge, tenant backup integration, and stale cleanup."""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.core.management import call_command
from django.utils import timezone

from api.models import PasswordResetToken, User
from api.services.tenant_backup import RESTORE_CONFIRM_PHRASE, backup_bundle_json_bytes, restore_bundle
from api.utils.password_reset_tokens import (
    delete_password_reset_tokens_for_user_ids,
    purge_password_reset_tokens_for_company,
    purge_stale_password_reset_tokens,
)

pytestmark = pytest.mark.django_db


def _make_token(user: User, *, used: bool = False, expired: bool = False) -> PasswordResetToken:
    now = timezone.now()
    expires = now - timedelta(minutes=5) if expired else now + timedelta(minutes=30)
    used_at = now if used else None
    return PasswordResetToken.objects.create(
        user=user,
        token_hash=f"hash-{user.id}-{secrets_token_suffix()}",
        expires_at=expires,
        used_at=used_at,
    )


def secrets_token_suffix() -> str:
    import secrets

    return secrets.token_hex(8)


def test_delete_tokens_for_user_ids(user_admin):
    _make_token(user_admin)
    assert PasswordResetToken.objects.filter(user=user_admin).count() == 1
    n = delete_password_reset_tokens_for_user_ids([user_admin.id])
    assert n == 1
    assert PasswordResetToken.objects.filter(user=user_admin).count() == 0


def test_purge_stale_removes_expired_and_old_used(user_admin):
    _make_token(user_admin, expired=True)
    _make_token(user_admin, used=True)
    old_used = _make_token(user_admin, used=True)
    PasswordResetToken.objects.filter(pk=old_used.pk).update(
        used_at=timezone.now() - timedelta(days=45)
    )
    _make_token(user_admin)  # active — must remain

    counts = purge_stale_password_reset_tokens(retention_days=30)
    assert counts["expired"] >= 1
    assert counts["used_old"] >= 1
    assert PasswordResetToken.objects.filter(user=user_admin, used_at__isnull=True).count() == 1


def test_purge_for_company(company_tenant, user_admin):
    _make_token(user_admin)
    n = purge_password_reset_tokens_for_company(company_tenant.id)
    assert n == 1
    assert PasswordResetToken.objects.filter(user=user_admin).count() == 0


def test_tenant_delete_removes_reset_tokens(company_tenant, user_admin):
    from api.services.tenant_backup import delete_tenant_company_data

    _make_token(user_admin)
    cid = company_tenant.id
    delete_tenant_company_data(cid)
    assert PasswordResetToken.objects.filter(user_id=user_admin.id).count() == 0


def test_restore_purges_pending_tokens(company_tenant, user_admin):
    _make_token(user_admin)
    raw = backup_bundle_json_bytes(company_tenant.id)
    import json

    bundle = json.loads(raw)
    restore_bundle(bundle, company_tenant.id, confirm_replace=RESTORE_CONFIRM_PHRASE)
    assert PasswordResetToken.objects.filter(user__company_id=company_tenant.id).count() == 0


def test_management_command_purge(capsys, user_admin):
    _make_token(user_admin, expired=True)
    call_command("purge_password_reset_tokens")
    captured = capsys.readouterr()
    assert "Purged" in captured.out
    assert PasswordResetToken.objects.filter(user=user_admin, used_at__isnull=True).count() == 0
