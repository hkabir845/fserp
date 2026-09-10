"""Who created or posted a journal — request-scoped, no signature churn on AUTO posters.

``auth_required`` sets the current user for the request. ``_create_posted_entry`` (and
manual journal create/post) read it. Legacy rows and management-command posts stay null.
"""
from __future__ import annotations

from contextvars import ContextVar, Token
from typing import Optional

_current_user_id: ContextVar[Optional[int]] = ContextVar("audit_user_id", default=None)


def set_audit_user_id(user_id: int | None) -> Token:
    return _current_user_id.set(int(user_id) if user_id is not None else None)


def reset_audit_user_id(token: Token) -> None:
    _current_user_id.reset(token)


def current_audit_user_id() -> int | None:
    return _current_user_id.get()
