"""Append-only financial audit events (who / what / before / after / why)."""
from __future__ import annotations

import logging
from typing import Any

from api.services.audit_actor import current_audit_user_id

logger = logging.getLogger(__name__)


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return str(value)


def record_financial_audit(
    *,
    company_id: int,
    action: str,
    entity_type: str,
    entity_id: int | None = None,
    entity_ref: str = "",
    reason: str = "",
    before: dict | None = None,
    after: dict | None = None,
    actor_user_id: int | None = None,
    request_meta: dict | None = None,
) -> None:
    """
    Persist one immutable audit row inside the current transaction when possible.

    Insert failures are logged and swallowed so a logging glitch cannot undo a
    successful void / unpost / reverse.
    """
    from api.models import FinancialAuditEvent

    uid = actor_user_id if actor_user_id is not None else current_audit_user_id()
    try:
        FinancialAuditEvent.objects.create(
            company_id=int(company_id),
            actor_user_id=uid,
            action=(action or "")[:64],
            entity_type=(entity_type or "")[:64],
            entity_id=entity_id,
            entity_ref=(entity_ref or "")[:128],
            reason=(reason or "")[:2000],
            before_json=_json_safe(before or {}),
            after_json=_json_safe(after or {}),
            request_meta=_json_safe(request_meta or {}),
        )
    except Exception:
        logger.exception(
            "Failed to record financial audit company=%s action=%s entity=%s/%s",
            company_id,
            action,
            entity_type,
            entity_id,
        )


def require_mutation_reason(
    body: dict | None,
    *,
    field_names: tuple[str, ...] = ("reason", "void_reason", "reversal_reason"),
) -> tuple[str | None, str | None]:
    """
    Return ``(reason, None)`` or ``(None, error_detail)``.
    Requires a non-trivial reason for void / unpost / reverse / reopen.
    """
    raw = ""
    data = body if isinstance(body, dict) else {}
    for name in field_names:
        v = data.get(name)
        if isinstance(v, str) and v.strip():
            raw = v.strip()
            break
        if v is not None and not isinstance(v, str) and str(v).strip():
            raw = str(v).strip()
            break
    if len(raw) < 3:
        return None, "A reason of at least 3 characters is required for this change."
    return raw[:2000], None


def record_document_deletion(
    request,
    *,
    company_id: int,
    entity_type: str,
    entity_id: int,
    entity_ref: str = "",
    before: dict | None = None,
) -> None:
    """
    Trail one deleted financial document.

    Deleting an invoice / bill / payment removes its journals with it, so without a row here the
    only evidence a posted document ever existed disappears with it. A reason is recorded when the
    caller supplies one, but is not demanded — the delete buttons predate this trail and blocking
    them would take away a routine correction.
    """
    body = {}
    try:
        import json as _json

        raw = getattr(request, "body", None)
        if raw:
            parsed = _json.loads(raw)
            if isinstance(parsed, dict):
                body = parsed
    except Exception:
        body = {}
    reason, _err = require_mutation_reason(body)
    record_financial_audit(
        company_id=company_id,
        action="delete",
        entity_type=entity_type,
        entity_id=int(entity_id),
        entity_ref=entity_ref or "",
        reason=reason or "",
        before=before or {},
        after={"deleted": True},
        actor_user_id=getattr(getattr(request, "api_user", None), "id", None),
    )
