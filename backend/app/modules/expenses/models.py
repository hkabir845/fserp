"""Employee expense claims (client visits, transport, meals, etc.)."""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Numeric, Text, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from app.shared.base import TenantBase


class ExpenseClaim(TenantBase):
    __tablename__ = "expense_claims"

    claim_number = Column(String, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
    status = Column(String, nullable=False, default="draft")  # draft, submitted, approved, rejected, paid
    purpose = Column(String, nullable=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    trip_ref = Column(String, nullable=True)  # optional link to transport trip number / DN
    submitted_at = Column(DateTime, nullable=True)
    decided_at = Column(DateTime, nullable=True)
    decided_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewer_notes = Column(Text, nullable=True)

    user = relationship("User", foreign_keys=[user_id])
    decider = relationship("User", foreign_keys=[decided_by_user_id])
    customer = relationship("Customer", foreign_keys=[customer_id])
    lines = relationship("ExpenseClaimLine", back_populates="claim", cascade="all, delete-orphan")


class ExpenseClaimLine(TenantBase):
    __tablename__ = "expense_claim_lines"

    claim_id = Column(Integer, ForeignKey("expense_claims.id"), nullable=False)
    category = Column(String, nullable=False)
    # transport, fuel, meals_breakfast, meals_lunch, meals_dinner, lodging, toll, parking, other
    amount = Column(Numeric(15, 2), nullable=False)
    spent_on = Column(DateTime, nullable=False, default=datetime.utcnow)
    description = Column(Text, nullable=True)
    receipt_ref = Column(String, nullable=True)  # URL or file id

    claim = relationship("ExpenseClaim", back_populates="lines")
