"""GL posting for fuel tank receipts and internal vehicle issues (inventory accrual + expense)."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional, TYPE_CHECKING

from sqlalchemy.orm import Session

from app.modules.accounting.posting_service import PostingService

if TYPE_CHECKING:
    from app.modules.accounting.models import JournalEntry


def _inventory_account(db: Session, tenant_id: int):
    inv = PostingService.get_account_by_name(db, tenant_id, "Inventory")
    return inv


def _grni_account(db: Session, tenant_id: int):
    return PostingService.get_account_by_name(db, tenant_id, "Goods Received Not Invoiced")


def _fleet_expense_account(db: Session, tenant_id: int):
    for name in (
        "Fuel & fleet operating (non-capitalized)",
        "Fleet Fuel Expense",
        "Fuel & fleet operating",
    ):
        acc = PostingService.get_account_by_name(db, tenant_id, name)
        if acc:
            return acc
    return PostingService.get_account_by_code(db, tenant_id, "5210")


def post_fuel_receipt_accrual(
    db: Session,
    tenant_id: int,
    amount: Decimal,
    memo: str,
    ref_type: str,
    ref_id: int,
    posted_at: datetime,
    posted_by: Optional[int],
) -> Optional["JournalEntry"]:
    """
    Dr Inventory / Cr GRNI — same economics as GRN accrual (supplier not yet invoiced).
    """
    amount = Decimal(str(amount))
    if amount <= 0:
        return None
    inv = _inventory_account(db, tenant_id)
    grni = _grni_account(db, tenant_id)
    if not inv or not grni:
        return None
    return PostingService.create_journal_entry(
        db=db,
        tenant_id=tenant_id,
        date=posted_at,
        memo=memo,
        lines=[
            {"account_id": inv.id, "debit": float(amount), "credit": 0, "memo": memo},
            {"account_id": grni.id, "debit": 0, "credit": float(amount), "memo": memo},
        ],
        ref_type=ref_type,
        ref_id=ref_id,
        posted_by=posted_by,
    )


def post_fuel_internal_issue(
    db: Session,
    tenant_id: int,
    amount: Decimal,
    memo: str,
    ref_type: str,
    ref_id: int,
    posted_at: datetime,
    posted_by: Optional[int],
    cost_center_id: Optional[int] = None,
) -> Optional["JournalEntry"]:
    """
    Dr Fleet fuel expense (optional cost center on debit line) / Cr Inventory — internal use.
    """
    amount = Decimal(str(amount))
    if amount <= 0:
        return None
    exp = _fleet_expense_account(db, tenant_id)
    inv = _inventory_account(db, tenant_id)
    if not exp or not inv:
        return None
    return PostingService.create_journal_entry(
        db=db,
        tenant_id=tenant_id,
        date=posted_at,
        memo=memo,
        lines=[
            {
                "account_id": exp.id,
                "debit": float(amount),
                "credit": 0,
                "memo": memo,
                "cost_center_id": cost_center_id,
            },
            {
                "account_id": inv.id,
                "debit": 0,
                "credit": float(amount),
                "memo": memo,
                "cost_center_id": None,
            },
        ],
        ref_type=ref_type,
        ref_id=ref_id,
        posted_by=posted_by,
    )
