"""
Sub-ledgers for customers (AR), suppliers (AP), and employees (payables) — opening balances vs retained earnings.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.accounting.models import Account, JournalEntry, JournalLine

# Feed-mill COA parent codes — sub-accounts hang under these
PARENT_AR_CODE = "1210"
PARENT_AP_CODE = "2110"
PARENT_EMP_PAY_CODE = "2140"
PARENT_LOAN_CODE = "2210"
OPENING_OFFSET_CODE = "3200"  # Retained earnings


def _create_journal_flush_only(
    db: Session,
    tenant_id: int,
    date: datetime,
    memo: str,
    lines: list,
    ref_type: Optional[str],
    ref_id: Optional[int],
    posted_by: int,
) -> JournalEntry:
    """Balanced journal like PostingService but flush-only for same-transaction party saves."""
    total_debit = sum(Decimal(str(line["debit"])) for line in lines)
    total_credit = sum(Decimal(str(line["credit"])) for line in lines)
    if total_debit != total_credit:
        raise ValueError(f"Journal not balanced: {total_debit} vs {total_credit}")
    entry_number = f"JE-OB-{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}"
    journal = JournalEntry(
        tenant_id=tenant_id,
        entry_number=entry_number,
        date=date,
        memo=memo,
        ref_type=ref_type,
        ref_id=ref_id,
        posted_by=posted_by,
        is_posted=True,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(journal)
    db.flush()
    for line_data in lines:
        ln = JournalLine(
            tenant_id=tenant_id,
            journal_id=journal.id,
            account_id=line_data["account_id"],
            debit=Decimal(str(line_data["debit"])),
            credit=Decimal(str(line_data["credit"])),
            memo=line_data.get("memo"),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(ln)
    db.flush()
    return journal


def _account_balance_raw(db: Session, tenant_id: int, account_id: int, as_of: Optional[datetime] = None) -> Decimal:
    """Debit minus credit (normal for assets; liabilities will show negative of credit balance)."""
    qd = (
        db.query(func.coalesce(func.sum(JournalLine.debit), 0))
        .join(JournalEntry)
        .filter(
            JournalLine.tenant_id == tenant_id,
            JournalLine.account_id == account_id,
            JournalEntry.is_posted == True,
        )
    )
    qc = (
        db.query(func.coalesce(func.sum(JournalLine.credit), 0))
        .join(JournalEntry)
        .filter(
            JournalLine.tenant_id == tenant_id,
            JournalLine.account_id == account_id,
            JournalEntry.is_posted == True,
        )
    )
    if as_of:
        qd = qd.filter(JournalEntry.date <= as_of)
        qc = qc.filter(JournalEntry.date <= as_of)
    dr = Decimal(str(qd.scalar() or 0))
    cr = Decimal(str(qc.scalar() or 0))
    return dr - cr


def account_balance_for_display(db: Session, tenant_id: int, account_id: Optional[int]) -> Optional[float]:
    """Human-friendly signed balance: AR asset (debit normal), AP/emp liability (credit normal)."""
    if not account_id:
        return None
    ac = db.query(Account).filter(Account.id == account_id, Account.tenant_id == tenant_id).first()
    if not ac:
        return None
    raw = _account_balance_raw(db, tenant_id, account_id)
    t = (ac.type or "").lower()
    if t == "asset":
        return float(raw)
    if t == "liability":
        return float(-raw)
    return float(raw)


def _parent_account(db: Session, tenant_id: int, parent_code: str) -> Optional[Account]:
    return (
        db.query(Account)
        .filter(Account.tenant_id == tenant_id, Account.code == parent_code, Account.is_active == True)
        .first()
    )


def _opening_offset_account(db: Session, tenant_id: int) -> Optional[Account]:
    return (
        db.query(Account)
        .filter(Account.tenant_id == tenant_id, Account.code == OPENING_OFFSET_CODE, Account.is_active == True)
        .first()
    )


def ensure_party_gl_account(
    db: Session,
    tenant_id: int,
    *,
    kind: str,  # customer | supplier | employee | loan
    entity_id: int,
    display_name: str,
) -> Account:
    """Create or return existing sub-account under AR / AP / Employee payables."""
    if kind == "customer":
        prefix = "1210-C"
        parent_code = PARENT_AR_CODE
        name = f"AR — {display_name[:200]}"
    elif kind == "supplier":
        prefix = "2110-S"
        parent_code = PARENT_AP_CODE
        name = f"AP — {display_name[:200]}"
    elif kind == "employee":
        prefix = "2140-E"
        parent_code = PARENT_EMP_PAY_CODE
        name = f"Payable — {display_name[:200]}"
    elif kind == "loan":
        prefix = "2210-L"
        parent_code = PARENT_LOAN_CODE
        name = f"Loan — {display_name[:200]}"
    else:
        raise ValueError("kind must be customer, supplier, employee, or loan")

    code = f"{prefix}{entity_id}"
    existing = (
        db.query(Account).filter(Account.tenant_id == tenant_id, Account.code == code).first()
    )
    if existing:
        return existing

    parent = _parent_account(db, tenant_id, parent_code)
    if not parent:
        raise ValueError(
            f"Chart of accounts missing parent `{parent_code}`. Apply the feed mill COA template in Accounting."
        )

    ac = Account(
        tenant_id=tenant_id,
        code=code,
        name=name,
        type="asset" if kind == "customer" else "liability",
        parent_id=parent.id,
        is_active=True,
    )
    db.add(ac)
    db.flush()
    return ac


def post_opening_balance_for_customer(
    db: Session,
    tenant_id: int,
    *,
    customer_id: int,
    display_name: str,
    opening: Decimal,
    as_of: datetime,
    posted_by: int,
) -> tuple[Account, Optional[JournalEntry]]:
    """Positive opening = receivable (they owe us). Negative = customer credit (advance)."""
    opening = Decimal(str(opening))
    if opening == 0:
        ac = ensure_party_gl_account(
            db, tenant_id, kind="customer", entity_id=customer_id, display_name=display_name
        )
        return ac, None

    ac = ensure_party_gl_account(
        db, tenant_id, kind="customer", entity_id=customer_id, display_name=display_name
    )
    offset = _opening_offset_account(db, tenant_id)
    if not offset:
        raise ValueError("Account 3200 (Retained earnings) not found. Apply chart of accounts.")

    amt = abs(opening)
    if opening > 0:
        lines = [
            {"account_id": ac.id, "debit": float(amt), "credit": 0, "memo": "Customer opening balance"},
            {"account_id": offset.id, "debit": 0, "credit": float(amt), "memo": "Opening balance offset"},
        ]
    else:
        lines = [
            {"account_id": offset.id, "debit": float(amt), "credit": 0, "memo": "Customer opening balance (credit)"},
            {"account_id": ac.id, "debit": 0, "credit": float(amt), "memo": "Customer advance / credit"},
        ]

    je = _create_journal_flush_only(
        db,
        tenant_id,
        as_of,
        f"Opening balance — customer #{customer_id}",
        lines,
        "customer_opening",
        customer_id,
        posted_by,
    )
    return ac, je


def post_opening_balance_for_supplier(
    db: Session,
    tenant_id: int,
    *,
    supplier_id: int,
    display_name: str,
    opening: Decimal,
    as_of: datetime,
    posted_by: int,
) -> tuple[Account, Optional[JournalEntry]]:
    """Positive opening = amount we owe vendor (AP credit). Negative = prepayment to supplier (debit AP)."""
    opening = Decimal(str(opening))
    if opening == 0:
        ac = ensure_party_gl_account(
            db, tenant_id, kind="supplier", entity_id=supplier_id, display_name=display_name
        )
        return ac, None

    ac = ensure_party_gl_account(
        db, tenant_id, kind="supplier", entity_id=supplier_id, display_name=display_name
    )
    offset = _opening_offset_account(db, tenant_id)
    if not offset:
        raise ValueError("Account 3200 (Retained earnings) not found. Apply chart of accounts.")

    amt = abs(opening)
    if opening > 0:
        # We owe supplier
        lines = [
            {"account_id": offset.id, "debit": float(amt), "credit": 0, "memo": "Supplier opening balance"},
            {"account_id": ac.id, "debit": 0, "credit": float(amt), "memo": "Opening AP"},
        ]
    else:
        lines = [
            {"account_id": ac.id, "debit": float(amt), "credit": 0, "memo": "Supplier prepayment"},
            {"account_id": offset.id, "debit": 0, "credit": float(amt), "memo": "Opening balance offset"},
        ]

    je = _create_journal_flush_only(
        db,
        tenant_id,
        as_of,
        f"Opening balance — supplier #{supplier_id}",
        lines,
        "supplier_opening",
        supplier_id,
        posted_by,
    )
    return ac, je


def post_opening_balance_for_employee(
    db: Session,
    tenant_id: int,
    *,
    employee_id: int,
    display_name: str,
    opening: Decimal,
    as_of: datetime,
    posted_by: int,
) -> tuple[Account, Optional[JournalEntry]]:
    """Positive = net we owe employee. Negative = employee owes company (advance recovery)."""
    opening = Decimal(str(opening))
    if opening == 0:
        ac = ensure_party_gl_account(
            db, tenant_id, kind="employee", entity_id=employee_id, display_name=display_name
        )
        return ac, None

    ac = ensure_party_gl_account(
        db, tenant_id, kind="employee", entity_id=employee_id, display_name=display_name
    )
    offset = _opening_offset_account(db, tenant_id)
    if not offset:
        raise ValueError("Account 3200 (Retained earnings) not found. Apply chart of accounts.")

    amt = abs(opening)
    if opening > 0:
        lines = [
            {"account_id": offset.id, "debit": float(amt), "credit": 0, "memo": "Employee opening balance"},
            {"account_id": ac.id, "debit": 0, "credit": float(amt), "memo": "Opening employee payable"},
        ]
    else:
        lines = [
            {"account_id": ac.id, "debit": float(amt), "credit": 0, "memo": "Employee advance / recovery"},
            {"account_id": offset.id, "debit": 0, "credit": float(amt), "memo": "Opening balance offset"},
        ]

    je = _create_journal_flush_only(
        db,
        tenant_id,
        as_of,
        f"Opening balance — employee #{employee_id}",
        lines,
        "employee_opening",
        employee_id,
        posted_by,
    )
    return ac, je


def post_opening_balance_for_loan(
    db: Session,
    tenant_id: int,
    *,
    loan_id: int,
    display_name: str,
    opening: Decimal,
    as_of: datetime,
    posted_by: int,
) -> tuple[Account, Optional[JournalEntry]]:
    """Positive = company liability to lender. Negative = net receivable/prepaid position."""
    opening = Decimal(str(opening))
    if opening == 0:
        ac = ensure_party_gl_account(
            db, tenant_id, kind="loan", entity_id=loan_id, display_name=display_name
        )
        return ac, None

    ac = ensure_party_gl_account(
        db, tenant_id, kind="loan", entity_id=loan_id, display_name=display_name
    )
    offset = _opening_offset_account(db, tenant_id)
    if not offset:
        raise ValueError("Account 3200 (Retained earnings) not found. Apply chart of accounts.")

    amt = abs(opening)
    if opening > 0:
        lines = [
            {"account_id": offset.id, "debit": float(amt), "credit": 0, "memo": "Loan opening balance"},
            {"account_id": ac.id, "debit": 0, "credit": float(amt), "memo": "Opening loan payable"},
        ]
    else:
        lines = [
            {"account_id": ac.id, "debit": float(amt), "credit": 0, "memo": "Loan prepayment / receivable"},
            {"account_id": offset.id, "debit": 0, "credit": float(amt), "memo": "Opening balance offset"},
        ]

    je = _create_journal_flush_only(
        db,
        tenant_id,
        as_of,
        f"Opening balance — loan #{loan_id}",
        lines,
        "loan_opening",
        loan_id,
        posted_by,
    )
    return ac, je


def ensure_gl_only(
    db: Session,
    tenant_id: int,
    kind: str,
    entity_id: int,
    display_name: str,
) -> Account:
    """Ledger row with zero opening — still link sub-account for future postings."""
    return ensure_party_gl_account(db, tenant_id, kind=kind, entity_id=entity_id, display_name=display_name)
