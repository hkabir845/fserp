"""CRM — leads, pipeline, and activities (feed mill / FMERP distribution)."""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Boolean
from sqlalchemy.orm import relationship
from app.shared.base import TenantBase


class CrmLead(TenantBase):
    __tablename__ = "crm_leads"

    name = Column(String, nullable=False)
    company_name = Column(String, nullable=True)
    email = Column(String, nullable=True, index=True)
    phone = Column(String, nullable=True)
    source = Column(String, nullable=True)  # web, referral, trade_show, field_visit, other
    stage = Column(String, nullable=False, default="new")  # new, qualified, proposal, won, lost
    estimated_value = Column(String, nullable=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    next_action = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    closed_at = Column(DateTime, nullable=True)

    owner = relationship("User", foreign_keys=[owner_user_id])
    activities = relationship("CrmActivity", back_populates="lead")


class CrmActivity(TenantBase):
    __tablename__ = "crm_activities"

    lead_id = Column(Integer, ForeignKey("crm_leads.id"), nullable=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True, index=True)
    activity_type = Column(String, nullable=False)  # call, visit, email, task, meeting, note
    subject = Column(String, nullable=False)
    due_at = Column(DateTime, nullable=True, index=True)
    completed_at = Column(DateTime, nullable=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    notes = Column(Text, nullable=True)

    lead = relationship("CrmLead", back_populates="activities")
    customer = relationship("Customer", foreign_keys=[customer_id])
    owner = relationship("User", foreign_keys=[owner_user_id])
