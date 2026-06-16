"""
Factory workshop: repairs, installations, and maintenance for plant equipment,
machinery, and fleet (lorries, trucks, internal transport).
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Boolean, UniqueConstraint
from sqlalchemy.orm import relationship

from app.shared.base import TenantBase


class WorkshopJob(TenantBase):
    __tablename__ = "workshop_jobs"
    __table_args__ = (UniqueConstraint("tenant_id", "job_number", name="uq_workshop_jobs_tenant_job_number"),)

    job_number = Column(String, nullable=False, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)

    # repair | install | preventive | inspection | breakdown | upgrade
    job_type = Column(String, nullable=False, default="repair")
    # production_equipment | machinery | truck_lorry | other_transport | factory_infrastructure | other
    asset_kind = Column(String, nullable=False, default="machinery")
    # Optional link to fleet vehicle (lorries, trucks, factory trucks, etc.)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id"), nullable=True, index=True)
    # e.g. "Pellet line 1", "Bulk silo area", "Workshop bay A"
    location_zone = Column(String, nullable=True)
    facility_tag = Column(String, nullable=True)

    priority = Column(String, nullable=False, default="normal")  # low, normal, high, urgent
    status = Column(
        String,
        nullable=False,
        default="draft",
    )  # draft, assigned, in_progress, waiting_parts, completed, cancelled

    scheduled_start = Column(DateTime, nullable=True)
    scheduled_end = Column(DateTime, nullable=True)
    actual_start = Column(DateTime, nullable=True)
    actual_end = Column(DateTime, nullable=True)

    reported_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    completion_notes = Column(Text, nullable=True)

    vehicle = relationship("Vehicle", foreign_keys=[vehicle_id])
    reporter = relationship("User", foreign_keys=[reported_by_user_id])
    assignments = relationship(
        "WorkshopJobAssignment",
        back_populates="job",
        cascade="all, delete-orphan",
    )


class WorkshopJobAssignment(TenantBase):
    __tablename__ = "workshop_job_assignments"

    job_id = Column(Integer, ForeignKey("workshop_jobs.id"), nullable=False, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    role = Column(String, nullable=False, default="technician")  # lead, technician, helper, apprentice
    assigned_at = Column(DateTime, nullable=False)
    released_at = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)

    job = relationship("WorkshopJob", back_populates="assignments")
    employee = relationship("Employee", foreign_keys=[employee_id])
