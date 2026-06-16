"""Letter of Credit documents — import/export, Bangladesh-aware fields."""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.shared.base import TenantBase


class LetterOfCredit(TenantBase):
    __tablename__ = "letter_of_credits"
    __table_args__ = (UniqueConstraint("tenant_id", "lc_internal_number", name="uq_lc_tenant_internal_no"),)

    # Identity / bank refs
    lc_internal_number = Column(String(64), nullable=False, index=True)
    bank_lc_reference = Column(String(128), nullable=True, index=True)

    direction = Column(String(16), nullable=False)  # import | export
    deal_type = Column(String(32), nullable=False, default="sight")
    # sight, usance, deferred_payment, mixed_payment, revolving, transferable, back_to_back

    status = Column(String(32), nullable=False, default="draft")
    # draft, bank_review, opened, advised, amended, docs_in_review, negotiated, settled, closed, cancelled

    # Parties
    applicant_name = Column(String(512), nullable=False)
    applicant_address = Column(Text, nullable=True)
    beneficiary_name = Column(String(512), nullable=False)
    beneficiary_address = Column(Text, nullable=True)
    beneficiary_country = Column(String(128), nullable=True)

    # Banks (Bangladesh AD / foreign — SWIFT BIC 8 or 11 chars where possible)
    issuing_bank_name = Column(String(256), nullable=False)
    issuing_bank_branch = Column(String(256), nullable=True)
    issuing_bank_swift = Column(String(32), nullable=True)
    advising_bank_name = Column(String(256), nullable=True)
    advising_bank_swift = Column(String(32), nullable=True)
    confirming_bank_name = Column(String(256), nullable=True)

    # Money & trade terms
    currency_code = Column(String(3), nullable=False, default="USD")
    amount = Column(Numeric(20, 2), nullable=False)
    tolerance_pct_plus = Column(Numeric(6, 2), nullable=True)
    tolerance_pct_minus = Column(Numeric(6, 2), nullable=True)
    incoterm = Column(String(32), nullable=True)  # FOB, CIF, CFR, EXW, etc.
    partial_shipment_allowed = Column(Boolean, nullable=False, default=True)
    transshipment_allowed = Column(Boolean, nullable=False, default=True)

    latest_shipment_date = Column(DateTime, nullable=True)
    expiry_date = Column(DateTime, nullable=True)
    presentation_period_days = Column(Integer, nullable=True)

    # Product / HS (feed industry)
    goods_description = Column(Text, nullable=False)
    goods_category = Column(String(64), nullable=False, default="feed_ingredient")
    hs_codes = Column(String(512), nullable=True)

    # Bangladesh: regulatory & bank reporting (values vary by sector — store as entered)
    bin_tin = Column(String(64), nullable=True)
    irc_number = Column(String(128), nullable=True)
    erc_number = Column(String(128), nullable=True)
    feed_reg_license_ref = Column(String(128), nullable=True)
    bangladesh_bank_reporting_ref = Column(String(128), nullable=True)
    bank_lodgment_reference = Column(String(128), nullable=True)
    insurers_cover_note = Column(String(256), nullable=True)

    margin_pct = Column(Numeric(6, 2), nullable=True)
    charges_account_party = Column(String(64), nullable=True)  # applicant | beneficiary | shared

    # Links to ERP masters (optional)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    purchase_order_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=True)

    documents_required = Column(JSON, nullable=True)
    compliance_notes = Column(Text, nullable=True)
    internal_notes = Column(Text, nullable=True)

    amendments = relationship(
        "LCAmendment",
        back_populates="letter_of_credit",
        cascade="all, delete-orphan",
        order_by="LCAmendment.amendment_no",
    )


class LCAmendment(TenantBase):
    __tablename__ = "lc_amendments"
    __table_args__ = (UniqueConstraint("lc_id", "amendment_no", name="uq_lc_amendment_seq"),)

    lc_id = Column(Integer, ForeignKey("letter_of_credits.id"), nullable=False, index=True)
    amendment_no = Column(Integer, nullable=False)
    effective_date = Column(DateTime, nullable=False)
    summary = Column(String(512), nullable=False)
    detail = Column(Text, nullable=True)
    # Optional snapshot deltas (human-readable; not a full legal replacement)
    amount_before = Column(Numeric(20, 2), nullable=True)
    amount_after = Column(Numeric(20, 2), nullable=True)

    letter_of_credit = relationship("LetterOfCredit", back_populates="amendments")
