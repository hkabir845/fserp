"""Server-side refresh JWT rotation and replay detection."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from django.db import transaction
from django.utils import timezone as dj_tz

from api.models import AuthRefreshSession, User


def _new_id() -> str:
    return uuid.uuid4().hex


def issue_refresh_session(
    user: User,
    *,
    ttl_days: int = 7,
    user_agent: str = "",
    ip_address: str = "",
    family_id: str | None = None,
) -> tuple[str, str, datetime]:
    """
    Create a refresh session row. Returns (jti, family_id, expires_at UTC).
    """
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=ttl_days)
    jti = _new_id()
    fid = family_id or _new_id()
    AuthRefreshSession.objects.create(
        user=user,
        jti=jti,
        family_id=fid,
        expires_at=expires,
        user_agent=(user_agent or "")[:255],
        ip_address=(ip_address or "")[:64],
    )
    return jti, fid, expires


@transaction.atomic
def rotate_refresh_session(
    *,
    user: User,
    jti: str,
    family_id: str,
    user_agent: str = "",
    ip_address: str = "",
    ttl_days: int = 7,
) -> tuple[str, str, datetime] | None:
    """
    Mark the presented jti as rotated and mint a successor in the same family.

    Returns None when the token is unknown/expired/revoked.
    Raises ReplayDetected when a previously rotated jti is presented again —
    the caller should revoke the family and refuse the refresh.
    """
    now = dj_tz.now()
    row = (
        AuthRefreshSession.objects.select_for_update()
        .filter(jti=jti, user_id=user.id)
        .first()
    )
    if row is None:
        return None
    if row.family_id != family_id:
        return None
    if row.revoked_at is not None:
        return None
    if row.expires_at < now:
        return None
    if row.rotated_at is not None:
        raise ReplayDetected(row.family_id)
    row.rotated_at = now
    row.save(update_fields=["rotated_at"])
    return issue_refresh_session(
        user,
        ttl_days=ttl_days,
        user_agent=user_agent,
        ip_address=ip_address,
        family_id=row.family_id,
    )


def revoke_family(family_id: str) -> int:
    if not family_id:
        return 0
    now = dj_tz.now()
    return AuthRefreshSession.objects.filter(
        family_id=family_id, revoked_at__isnull=True
    ).update(revoked_at=now)


def revoke_user_sessions(user: User) -> int:
    now = dj_tz.now()
    return AuthRefreshSession.objects.filter(
        user_id=user.id, revoked_at__isnull=True
    ).update(revoked_at=now)


def revoke_jti(jti: str) -> int:
    if not jti:
        return 0
    now = dj_tz.now()
    return AuthRefreshSession.objects.filter(jti=jti, revoked_at__isnull=True).update(
        revoked_at=now
    )


class ReplayDetected(Exception):
    def __init__(self, family_id: str):
        super().__init__("refresh token replay detected")
        self.family_id = family_id
