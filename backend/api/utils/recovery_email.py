"""
Rules for self-service password recovery: deliverable address when username is not an email.
Shared by password reset and user CRUD validation.
"""
from __future__ import annotations

import re

# Same shape as a typical sign-in email (aligned with password_views historical check).
EMAIL_LIKE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+", re.IGNORECASE)


def username_looks_like_email(username: str) -> bool:
    u = (username or "").strip()
    return bool(u and EMAIL_LIKE.search(u))


def profile_allows_password_recovery(*, username: str, email: str) -> bool:
    """
    True if the user can receive a reset link/OTP: email-shaped username, or non-empty profile email.
    """
    if username_looks_like_email(username):
        return True
    return bool((email or "").strip())
