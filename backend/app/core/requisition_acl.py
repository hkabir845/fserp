"""Role helpers for purchase/sales requisition approvals."""

from __future__ import annotations

from sqlalchemy.orm import Session, joinedload

from app.modules.tenancy.models import User


def _slug(name: str) -> str:
    s = "".join(c if c.isalnum() or c in " _-" else "" for c in (name or "")).lower().strip()
    return s.replace(" ", "_").replace("-", "_")


def user_role_slugs(db: Session, user: User) -> set[str]:
    u = db.query(User).options(joinedload(User.roles)).filter(User.id == user.id).first()
    if not u or not u.roles:
        return set()
    return {_slug(r.name) for r in u.roles}


# Tenant-facing role names (normalized slugs). Admin / Super Admin can operate all steps for small orgs.
ADMIN_SLUGS = frozenset({"admin", "super_admin", "administrator"})

CREATOR_SALES_SLUGS = frozenset(
    {"sales_person", "sales_executive", "sales_rep", "sales", "sales_officer", "commercial_officer"}
)
HEAD_SALES_SLUGS = frozenset({"sales_head", "head_of_sales", "sales_manager", "head_sales"})

CREATOR_PURCHASE_SLUGS = frozenset(
    {"procurement_officer", "buyer", "procurement", "purchase_officer", "store_officer"}
)
HEAD_PURCHASE_SLUGS = frozenset(
    {"procurement_head", "head_of_procurement", "procurement_manager", "purchase_manager", "head_purchase"}
)

EXECUTIVE_SLUGS = frozenset(
    {
        "general_manager",
        "gm",
        "head_of_accounts",
        "accounts_head",
        "finance_head",
        "chief_accountant",
        "managing_director",
        "md",
        "ceo",
        "director",
        "cfo",
    }
)


def is_admin(slugs: set[str]) -> bool:
    return bool(slugs & ADMIN_SLUGS)


def can_submit_sales(slugs: set[str], user_id: int, created_by: int | None) -> bool:
    if is_admin(slugs):
        return True
    if created_by is not None and user_id == created_by:
        return True
    return bool(slugs & CREATOR_SALES_SLUGS)


def can_submit_purchase(slugs: set[str], user_id: int, created_by: int | None) -> bool:
    if is_admin(slugs):
        return True
    if created_by is not None and user_id == created_by:
        return True
    return bool(slugs & CREATOR_PURCHASE_SLUGS)


def can_approve_sales_dept(slugs: set[str]) -> bool:
    return is_admin(slugs) or bool(slugs & HEAD_SALES_SLUGS)


def can_approve_purchase_dept(slugs: set[str]) -> bool:
    return is_admin(slugs) or bool(slugs & HEAD_PURCHASE_SLUGS)


def can_approve_executive(slugs: set[str]) -> bool:
    return is_admin(slugs) or bool(slugs & EXECUTIVE_SLUGS)


def can_reject_sales(slugs: set[str], status: str) -> bool:
    if is_admin(slugs):
        return True
    if status == "pending_dept_head":
        return can_approve_sales_dept(slugs) or can_approve_executive(slugs)
    if status == "pending_executive":
        return can_approve_executive(slugs)
    return False


def can_reject_purchase(slugs: set[str], status: str) -> bool:
    if is_admin(slugs):
        return True
    if status == "pending_dept_head":
        return can_approve_purchase_dept(slugs) or can_approve_executive(slugs)
    if status == "pending_executive":
        return can_approve_executive(slugs)
    return False
