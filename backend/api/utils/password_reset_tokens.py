"""Password reset token lifecycle: invalidate, purge, and retention cleanup."""

from __future__ import annotations

from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone

from api.models import PasswordResetToken, User

# Used rows older than this are deleted by the purge management command (audit retention).
STALE_USED_RETENTION_DAYS = 30


def invalidate_password_reset_tokens_for_user(user: User) -> int:
    """Mark all unused reset tokens (link or OTP) for this user as consumed."""
    return PasswordResetToken.objects.filter(user=user, used_at__isnull=True).update(
        used_at=timezone.now()
    )


def delete_password_reset_tokens_for_user_ids(user_ids: list[int] | tuple[int, ...]) -> int:
    """Remove all reset token rows for the given users (tenant purge / security wipe)."""
    if not user_ids:
        return 0
    deleted, _ = PasswordResetToken.objects.filter(user_id__in=user_ids).delete()
    return int(deleted)


def purge_password_reset_tokens_for_company(company_id: int) -> int:
    """Delete every password reset token for users belonging to a tenant."""
    user_ids = list(User.objects.filter(company_id=company_id).values_list("id", flat=True))
    return delete_password_reset_tokens_for_user_ids(user_ids)


def purge_stale_password_reset_tokens(
    *,
    retention_days: int = STALE_USED_RETENTION_DAYS,
    now=None,
) -> dict[str, int]:
    """
    Remove expired unused tokens and long-retained used tokens (DB hygiene).

    Returns counts keyed by ``expired`` and ``used_old``.
    """
    if retention_days < 1:
        raise ValueError("retention_days must be at least 1.")
    now = now or timezone.now()
    cutoff = now - timedelta(days=retention_days)

    expired_n, _ = PasswordResetToken.objects.filter(expires_at__lt=now).delete()
    used_old_n, _ = PasswordResetToken.objects.filter(
        used_at__isnull=False, used_at__lt=cutoff
    ).delete()

    return {
        "expired": int(expired_n),
        "used_old": int(used_old_n),
    }


def clear_password_reset_rate_limit_cache_for_user(user_id: int) -> None:
    """Clear OTP attempt / lockout keys (LocMem or Redis) after password changes outside the reset flow."""
    cache.delete(f"pwreset_otp:{user_id}")
    cache.delete(f"pwreset_otp_lock:{user_id}")
    cache.delete(f"pwreset_otp_fail:{user_id}")
