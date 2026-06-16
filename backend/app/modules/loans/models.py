"""Tenant loan facilities: amortizing term loans with schedule and payments."""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Numeric, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.shared.base import TenantBase


class Loan(TenantBase):
    __tablename__ = "loans"
    __table_args__ = (UniqueConstraint("tenant_id", "loan_number", name="uq_loans_tenant_loan_number"),)

    loan_number = Column(String, nullable=False, index=True)
    lender_name = Column(String, nullable=False)
    reference = Column(String, nullable=True)

    principal = Column(Numeric(18, 2), nullable=False)
    annual_interest_rate_pct = Column(Numeric(10, 4), nullable=False)  # e.g. 12.5000 = 12.5% p.a.
    start_date = Column(DateTime, nullable=False)
    term_months = Column(Integer, nullable=False)

    status = Column(String, nullable=False, default="draft")  # draft, active, closed
    outstanding_principal = Column(Numeric(18, 2), nullable=True)
    opening_balance = Column(Numeric(18, 2), nullable=False, default=0)
    opening_balance_as_of = Column(DateTime, nullable=True)
    gl_account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True, index=True)

    notes = Column(Text, nullable=True)

    gl_account = relationship("Account", foreign_keys=[gl_account_id])

    schedule = relationship(
        "LoanScheduleLine",
        back_populates="loan",
        cascade="all, delete-orphan",
        order_by="LoanScheduleLine.installment_no",
    )
    payments = relationship("LoanPayment", back_populates="loan", cascade="all, delete-orphan")


class LoanScheduleLine(TenantBase):
    __tablename__ = "loan_schedule_lines"

    loan_id = Column(Integer, ForeignKey("loans.id"), nullable=False, index=True)
    installment_no = Column(Integer, nullable=False)
    due_date = Column(DateTime, nullable=False, index=True)

    opening_balance = Column(Numeric(18, 2), nullable=False)
    principal_due = Column(Numeric(18, 2), nullable=False)
    interest_due = Column(Numeric(18, 2), nullable=False)
    total_due = Column(Numeric(18, 2), nullable=False)

    principal_paid = Column(Numeric(18, 2), nullable=False, default=0)
    interest_paid = Column(Numeric(18, 2), nullable=False, default=0)
    status = Column(String, nullable=False, default="scheduled")  # scheduled, partial, paid

    loan = relationship("Loan", back_populates="schedule")


class LoanPayment(TenantBase):
    __tablename__ = "loan_payments"

    loan_id = Column(Integer, ForeignKey("loans.id"), nullable=False, index=True)
    payment_date = Column(DateTime, nullable=False, index=True)
    amount = Column(Numeric(18, 2), nullable=False)
    principal_allocated = Column(Numeric(18, 2), nullable=False, default=0)
    interest_allocated = Column(Numeric(18, 2), nullable=False, default=0)
    notes = Column(Text, nullable=True)

    loan = relationship("Loan", back_populates="payments")
