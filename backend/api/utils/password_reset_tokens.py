"""Invalidate pending self-service password reset rows when a password is set elsewhere."""

from __future__ import annotations

from django.core.cache import cache
from django.utils import timezone

from api.models import PasswordResetToken, User


def invalidate_password_reset_tokens_for_user(user: User) -> None:
    """Mark all unused reset tokens (link or OTP) for this user as consumed."""
    PasswordResetToken.objects.filter(user=user, used_at__isnull=True).update(used_at=timezone.now())


def clear_password_reset_rate_limit_cache_for_user(user_id: int) -> None:
    """Clear OTP attempt / lockout keys (LocMem or Redis) after password changes outside the reset flow."""
    cache.delete(f"pwreset_otp:{user_id}")
    cache.delete(f"pwreset_otp_lock:{user_id}")
    cache.delete(f"pwreset_otp_fail:{user_id}")
