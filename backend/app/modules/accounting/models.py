from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Numeric, Boolean, UniqueConstraint
from sqlalchemy.orm import relationship
from app.shared.base import TenantBase


class CostCenter(TenantBase):
    """Profit / cost center for departmental P&L and fuel expense allocation."""

    __tablename__ = "cost_centers"
    __table_args__ = (UniqueConstraint("tenant_id", "code", name="uq_cost_centers_tenant_code"),)

    code = Column(String(32), nullable=False, index=True)
    name = Column(String(256), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)


class Account(TenantBase):
    __tablename__ = "accounts"
    
    code = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)  # asset, liability, equity, income, expense
    parent_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)
    is_active = Column(Boolean, default=True)
    
    # Self-referential relationship - use string reference for remote_side
    parent = relationship("Account", remote_side="Account.id", foreign_keys=[parent_id], back_populates="children")
    children = relationship("Account", foreign_keys=[parent_id], back_populates="parent")

class JournalEntry(TenantBase):
    __tablename__ = "journal_entries"
    
    entry_number = Column(String, nullable=False, unique=True, index=True)
    date = Column(DateTime, nullable=False, index=True)
    memo = Column(String, nullable=True)
    ref_type = Column(String, nullable=True)  # vendor_bill, sales_invoice, production_batch, etc.
    ref_id = Column(Integer, nullable=True)
    posted_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    is_posted = Column(Boolean, default=False)
    
    lines = relationship("JournalLine", back_populates="journal_entry", cascade="all, delete-orphan")

class JournalLine(TenantBase):
    __tablename__ = "journal_lines"

    journal_id = Column(Integer, ForeignKey("journal_entries.id"), nullable=False)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    debit = Column(Numeric(15, 2), default=0)
    credit = Column(Numeric(15, 2), default=0)
    memo = Column(String, nullable=True)
    cost_center_id = Column(Integer, ForeignKey("cost_centers.id"), nullable=True)

    journal_entry = relationship("JournalEntry", back_populates="lines")
    account = relationship("Account")
    cost_center = relationship("CostCenter")

