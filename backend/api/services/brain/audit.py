"""Audit logging for AI actions and configuration changes."""
from __future__ import annotations

from typing import Any

from api.models import BrainActionLog


def log_action(
    *,
    action_type: str,
    description: str = "",
    company_id: int | None = None,
    user_id: int | None = None,
    metadata: dict[str, Any] | None = None,
) -> BrainActionLog:
    return BrainActionLog.objects.create(
        company_id=company_id,
        user_id=user_id,
        action_type=action_type[:64],
        description=description[:4000],
        metadata=metadata or {},
    )
