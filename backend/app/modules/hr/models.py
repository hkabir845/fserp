"""HRM — extends payroll with time-off and attendance (FMERP tenant scope)."""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Date, UniqueConstraint
from sqlalchemy.orm import relationship

from app.shared.base import TenantBase


class LeaveRequest(TenantBase):
    __tablename__ = "leave_requests"

    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    leave_type = Column(String, nullable=False)  # annual, sick, casual, unpaid, other
    start_date = Column(Date, nullable=False, index=True)
    end_date = Column(Date, nullable=False, index=True)
    reason = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="pending")  # pending, approved, rejected, cancelled
    decided_at = Column(DateTime, nullable=True)
    decided_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    employee = relationship("Employee", foreign_keys=[employee_id])
    decider = relationship("User", foreign_keys=[decided_by_user_id])


class AttendanceDay(TenantBase):
    __tablename__ = "attendance_days"
    __table_args__ = (
        UniqueConstraint("tenant_id", "employee_id", "work_date", name="uq_attendance_tenant_emp_date"),
    )

    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    work_date = Column(Date, nullable=False, index=True)
    status = Column(String, nullable=False)  # present, absent, half_day, leave, holiday
    check_in = Column(DateTime, nullable=True)
    check_out = Column(DateTime, nullable=True)
    notes = Column(String, nullable=True)

    employee = relationship("Employee", foreign_keys=[employee_id])
