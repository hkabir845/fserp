"""HRM — leave requests and attendance (tenant-scoped; links to payroll employees)."""
from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.dependencies import get_db, get_current_user, require_tenant_id
from app.modules.hr.models import AttendanceDay, LeaveRequest
from app.modules.payroll.models import Employee
from app.modules.tenancy.models import User

router = APIRouter()
LEAVE_TYPES = {"annual", "sick", "casual", "unpaid", "other"}
ATTENDANCE_STATUSES = {"present", "absent", "half_day", "leave", "holiday"}


class LeaveRequestCreate(BaseModel):
    employee_id: int
    leave_type: str = Field(..., description="annual, sick, casual, unpaid, other")
    start_date: date
    end_date: date
    reason: Optional[str] = None


class LeaveRequestResponse(BaseModel):
    id: int
    employee_id: int
    leave_type: str
    start_date: date
    end_date: date
    reason: Optional[str]
    status: str

    class Config:
        from_attributes = True


class LeaveDecision(BaseModel):
    approve: bool
    note: Optional[str] = None


class AttendanceUpsert(BaseModel):
    employee_id: int
    work_date: date
    status: str = Field(..., description="present, absent, half_day, leave, holiday")
    check_in: Optional[datetime] = None
    check_out: Optional[datetime] = None
    notes: Optional[str] = None

class AttendanceBulkItem(BaseModel):
    employee_id: int
    status: str = Field(..., description="present, absent, half_day, leave, holiday")
    check_in: Optional[datetime] = None
    check_out: Optional[datetime] = None
    notes: Optional[str] = None

class AttendanceBulkUpsert(BaseModel):
    work_date: date
    rows: List[AttendanceBulkItem]


class AttendanceResponse(BaseModel):
    id: int
    employee_id: int
    work_date: date
    status: str
    check_in: Optional[datetime]
    check_out: Optional[datetime]
    notes: Optional[str]

    class Config:
        from_attributes = True


@router.get("/leave-requests", response_model=List[LeaveRequestResponse])
async def list_leave_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    status: Optional[str] = None,
):
    q = db.query(LeaveRequest).filter(LeaveRequest.tenant_id == tenant_id)
    if status:
        q = q.filter(LeaveRequest.status == status)
    return q.order_by(LeaveRequest.start_date.desc()).limit(500).all()


@router.post("/leave-requests", response_model=LeaveRequestResponse)
async def create_leave_request(
    body: LeaveRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    emp = db.query(Employee).filter(Employee.id == body.employee_id, Employee.tenant_id == tenant_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    if body.leave_type not in LEAVE_TYPES:
        raise HTTPException(status_code=400, detail=f"leave_type must be one of {sorted(LEAVE_TYPES)}")
    if body.end_date < body.start_date:
        raise HTTPException(status_code=400, detail="end_date must be on or after start_date")
    overlap = (
        db.query(LeaveRequest)
        .filter(
            LeaveRequest.tenant_id == tenant_id,
            LeaveRequest.employee_id == body.employee_id,
            LeaveRequest.status.in_(["pending", "approved"]),
            LeaveRequest.start_date <= body.end_date,
            LeaveRequest.end_date >= body.start_date,
        )
        .first()
    )
    if overlap:
        raise HTTPException(status_code=400, detail="Overlapping leave request already exists")

    r = LeaveRequest(
        tenant_id=tenant_id,
        employee_id=body.employee_id,
        leave_type=body.leave_type,
        start_date=body.start_date,
        end_date=body.end_date,
        reason=body.reason,
        status="pending",
        created_by=current_user.id,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


@router.patch("/leave-requests/{request_id}/decide", response_model=LeaveRequestResponse)
async def decide_leave(
    request_id: int,
    body: LeaveDecision,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    r = (
        db.query(LeaveRequest)
        .filter(LeaveRequest.id == request_id, LeaveRequest.tenant_id == tenant_id)
        .first()
    )
    if not r:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if r.status != "pending":
        raise HTTPException(status_code=400, detail="Request already decided")

    r.status = "approved" if body.approve else "rejected"
    r.decided_at = datetime.utcnow()
    r.decided_by_user_id = current_user.id
    r.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(r)
    return r


@router.get("/attendance", response_model=List[AttendanceResponse])
async def list_attendance(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    from_date: Optional[date] = Query(None, alias="from"),
    to_date: Optional[date] = Query(None, alias="to"),
    employee_id: Optional[int] = None,
):
    q = db.query(AttendanceDay).filter(AttendanceDay.tenant_id == tenant_id)
    if employee_id:
        q = q.filter(AttendanceDay.employee_id == employee_id)
    if from_date:
        q = q.filter(AttendanceDay.work_date >= from_date)
    if to_date:
        q = q.filter(AttendanceDay.work_date <= to_date)
    return q.order_by(AttendanceDay.work_date.desc()).limit(500).all()


@router.put("/attendance", response_model=AttendanceResponse)
async def upsert_attendance(
    body: AttendanceUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    emp = db.query(Employee).filter(Employee.id == body.employee_id, Employee.tenant_id == tenant_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    if body.status not in ATTENDANCE_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of {sorted(ATTENDANCE_STATUSES)}")
    if body.check_in and body.check_out and body.check_out < body.check_in:
        raise HTTPException(status_code=400, detail="check_out cannot be before check_in")

    row = (
        db.query(AttendanceDay)
        .filter(
            AttendanceDay.tenant_id == tenant_id,
            AttendanceDay.employee_id == body.employee_id,
            AttendanceDay.work_date == body.work_date,
        )
        .first()
    )
    if row:
        row.status = body.status
        row.check_in = body.check_in
        row.check_out = body.check_out
        row.notes = body.notes
        row.updated_at = datetime.utcnow()
    else:
        row = AttendanceDay(
            tenant_id=tenant_id,
            employee_id=body.employee_id,
            work_date=body.work_date,
            status=body.status,
            check_in=body.check_in,
            check_out=body.check_out,
            notes=body.notes,
            created_by=current_user.id,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/attendance/bulk", response_model=dict)
async def bulk_upsert_attendance(
    body: AttendanceBulkUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    if not body.rows:
        raise HTTPException(status_code=400, detail="rows are required")
    updated = 0
    for item in body.rows:
        if item.status not in ATTENDANCE_STATUSES:
            raise HTTPException(status_code=400, detail=f"status must be one of {sorted(ATTENDANCE_STATUSES)}")
        if item.check_in and item.check_out and item.check_out < item.check_in:
            raise HTTPException(status_code=400, detail="check_out cannot be before check_in")
        emp = db.query(Employee).filter(Employee.id == item.employee_id, Employee.tenant_id == tenant_id).first()
        if not emp:
            raise HTTPException(status_code=404, detail=f"Employee not found: {item.employee_id}")
        row = (
            db.query(AttendanceDay)
            .filter(
                AttendanceDay.tenant_id == tenant_id,
                AttendanceDay.employee_id == item.employee_id,
                AttendanceDay.work_date == body.work_date,
            )
            .first()
        )
        if row:
            row.status = item.status
            row.check_in = item.check_in
            row.check_out = item.check_out
            row.notes = item.notes
            row.updated_at = datetime.utcnow()
        else:
            row = AttendanceDay(
                tenant_id=tenant_id,
                employee_id=item.employee_id,
                work_date=body.work_date,
                status=item.status,
                check_in=item.check_in,
                check_out=item.check_out,
                notes=item.notes,
                created_by=current_user.id,
            )
            db.add(row)
        updated += 1
    db.commit()
    return {"updated_rows": updated, "work_date": body.work_date.isoformat()}


@router.get("/summary", response_model=dict)
async def hr_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    pending_leaves = (
        db.query(LeaveRequest)
        .filter(LeaveRequest.tenant_id == tenant_id, LeaveRequest.status == "pending")
        .count()
    )
    approved_leaves = (
        db.query(LeaveRequest)
        .filter(LeaveRequest.tenant_id == tenant_id, LeaveRequest.status == "approved")
        .count()
    )
    today = date.today()
    attendance_today = db.query(AttendanceDay).filter(
        AttendanceDay.tenant_id == tenant_id, AttendanceDay.work_date == today
    ).all()
    present_today = sum(1 for a in attendance_today if a.status == "present")
    absent_today = sum(1 for a in attendance_today if a.status == "absent")
    return {
        "pending_leaves": pending_leaves,
        "approved_leaves": approved_leaves,
        "attendance_marked_today": len(attendance_today),
        "present_today": present_today,
        "absent_today": absent_today,
    }
