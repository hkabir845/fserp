"""Workshop jobs: factory equipment/fleet repair & install with technician assignment."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from app.core.dependencies import get_db, get_current_user, require_tenant_id
from app.modules.payroll.models import Employee
from app.modules.tenancy.models import User
from app.modules.transport.models import Vehicle
from app.modules.workshop.models import WorkshopJob, WorkshopJobAssignment

router = APIRouter()


def _job_no(db: Session, tenant_id: int) -> str:
    return f"WS-{tenant_id}-{uuid.uuid4().hex[:10].upper()}"


class JobCreate(BaseModel):
    title: str = Field(..., min_length=1)
    description: Optional[str] = None
    job_type: str = "repair"
    asset_kind: str = "machinery"
    vehicle_id: Optional[int] = None
    location_zone: Optional[str] = None
    facility_tag: Optional[str] = None
    priority: str = "normal"
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None


class JobUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    job_type: Optional[str] = None
    asset_kind: Optional[str] = None
    vehicle_id: Optional[int] = None
    location_zone: Optional[str] = None
    facility_tag: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None
    actual_start: Optional[datetime] = None
    actual_end: Optional[datetime] = None
    completion_notes: Optional[str] = None


class JobResponse(BaseModel):
    id: int
    job_number: str
    title: str
    description: Optional[str]
    job_type: str
    asset_kind: str
    vehicle_id: Optional[int]
    location_zone: Optional[str]
    facility_tag: Optional[str]
    priority: str
    status: str
    scheduled_start: Optional[datetime]
    scheduled_end: Optional[datetime]
    actual_start: Optional[datetime]
    actual_end: Optional[datetime]
    reported_by_user_id: Optional[int]
    completion_notes: Optional[str]

    class Config:
        from_attributes = True


class AssignmentCreate(BaseModel):
    employee_id: int
    role: str = Field("technician", description="lead, technician, helper, apprentice")


class AssignmentResponse(BaseModel):
    id: int
    job_id: int
    employee_id: int
    employee_name: Optional[str] = None
    role: str
    assigned_at: datetime
    released_at: Optional[datetime]
    is_active: bool

    class Config:
        from_attributes = True


@router.get("/jobs", response_model=List[JobResponse])
async def list_jobs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    status: Optional[str] = None,
    asset_kind: Optional[str] = None,
    limit: int = Query(200, ge=1, le=500),
):
    q = db.query(WorkshopJob).filter(WorkshopJob.tenant_id == tenant_id)
    if status:
        q = q.filter(WorkshopJob.status == status)
    if asset_kind:
        q = q.filter(WorkshopJob.asset_kind == asset_kind)
    return q.order_by(WorkshopJob.id.desc()).limit(limit).all()


@router.post("/jobs", response_model=JobResponse)
async def create_job(
    body: JobCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    if body.vehicle_id is not None:
        v = db.query(Vehicle).filter(Vehicle.id == body.vehicle_id, Vehicle.tenant_id == tenant_id).first()
        if not v:
            raise HTTPException(status_code=400, detail="vehicle_id not found for this tenant")

    job = WorkshopJob(
        tenant_id=tenant_id,
        job_number=_job_no(db, tenant_id),
        title=body.title.strip(),
        description=body.description,
        job_type=body.job_type,
        asset_kind=body.asset_kind,
        vehicle_id=body.vehicle_id,
        location_zone=body.location_zone,
        facility_tag=body.facility_tag,
        priority=body.priority,
        status="draft",
        scheduled_start=body.scheduled_start,
        scheduled_end=body.scheduled_end,
        reported_by_user_id=current_user.id,
        created_by=current_user.id,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


@router.get("/jobs/{job_id}", response_model=dict)
async def get_job(
    job_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    job = (
        db.query(WorkshopJob)
        .options(joinedload(WorkshopJob.assignments).joinedload(WorkshopJobAssignment.employee))
        .filter(WorkshopJob.id == job_id, WorkshopJob.tenant_id == tenant_id)
        .first()
    )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    veh = None
    if job.vehicle_id:
        v = db.query(Vehicle).filter(Vehicle.id == job.vehicle_id).first()
        if v:
            veh = {"id": v.id, "reg_no": v.reg_no, "type": v.type}

    assigns: List[dict] = []
    for a in job.assignments or []:
        nm = a.employee.name if a.employee else None
        assigns.append(
            {
                "id": a.id,
                "employee_id": a.employee_id,
                "employee_name": nm,
                "role": a.role,
                "assigned_at": a.assigned_at.isoformat() if a.assigned_at else None,
                "released_at": a.released_at.isoformat() if a.released_at else None,
                "is_active": a.is_active,
            }
        )

    return {
        "id": job.id,
        "job_number": job.job_number,
        "title": job.title,
        "description": job.description,
        "job_type": job.job_type,
        "asset_kind": job.asset_kind,
        "vehicle_id": job.vehicle_id,
        "vehicle": veh,
        "location_zone": job.location_zone,
        "facility_tag": job.facility_tag,
        "priority": job.priority,
        "status": job.status,
        "scheduled_start": job.scheduled_start.isoformat() if job.scheduled_start else None,
        "scheduled_end": job.scheduled_end.isoformat() if job.scheduled_end else None,
        "actual_start": job.actual_start.isoformat() if job.actual_start else None,
        "actual_end": job.actual_end.isoformat() if job.actual_end else None,
        "completion_notes": job.completion_notes,
        "assignments": assigns,
    }


@router.patch("/jobs/{job_id}", response_model=JobResponse)
async def update_job(
    job_id: int,
    body: JobUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    job = db.query(WorkshopJob).filter(WorkshopJob.id == job_id, WorkshopJob.tenant_id == tenant_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    data = body.model_dump(exclude_unset=True)
    if "vehicle_id" in data and data["vehicle_id"] is not None:
        v = db.query(Vehicle).filter(Vehicle.id == data["vehicle_id"], Vehicle.tenant_id == tenant_id).first()
        if not v:
            raise HTTPException(status_code=400, detail="vehicle_id not found")

    for k, v in data.items():
        setattr(job, k, v)
    job.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    return job


@router.post("/jobs/{job_id}/status", response_model=JobResponse)
async def set_job_status(
    job_id: int,
    status: str = Query(
        ...,
        description="draft, assigned, in_progress, waiting_parts, completed, cancelled",
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    allowed = {"draft", "assigned", "in_progress", "waiting_parts", "completed", "cancelled"}
    if status not in allowed:
        raise HTTPException(status_code=400, detail=f"status must be one of {sorted(allowed)}")

    job = db.query(WorkshopJob).filter(WorkshopJob.id == job_id, WorkshopJob.tenant_id == tenant_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    job.status = status
    if status == "in_progress" and not job.actual_start:
        job.actual_start = datetime.utcnow()
    if status == "completed":
        job.actual_end = datetime.utcnow()
    job.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    return job


@router.post("/jobs/{job_id}/assignments", response_model=AssignmentResponse)
async def assign_technician(
    job_id: int,
    body: AssignmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    job = db.query(WorkshopJob).filter(WorkshopJob.id == job_id, WorkshopJob.tenant_id == tenant_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    emp = db.query(Employee).filter(Employee.id == body.employee_id, Employee.tenant_id == tenant_id).first()
    if not emp:
        raise HTTPException(status_code=400, detail="Employee not found")

    existing = (
        db.query(WorkshopJobAssignment)
        .filter(
            WorkshopJobAssignment.job_id == job.id,
            WorkshopJobAssignment.employee_id == body.employee_id,
            WorkshopJobAssignment.is_active == True,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Employee already assigned to this job")

    a = WorkshopJobAssignment(
        tenant_id=tenant_id,
        job_id=job.id,
        employee_id=body.employee_id,
        role=body.role,
        assigned_at=datetime.utcnow(),
        is_active=True,
        created_by=current_user.id,
    )
    db.add(a)
    if job.status == "draft":
        job.status = "assigned"
    job.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(a)
    return AssignmentResponse(
        id=a.id,
        job_id=a.job_id,
        employee_id=a.employee_id,
        employee_name=emp.name,
        role=a.role,
        assigned_at=a.assigned_at,
        released_at=a.released_at,
        is_active=a.is_active,
    )


@router.post("/assignments/{assignment_id}/release", response_model=AssignmentResponse)
async def release_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    a = (
        db.query(WorkshopJobAssignment)
        .options(joinedload(WorkshopJobAssignment.employee))
        .filter(WorkshopJobAssignment.id == assignment_id, WorkshopJobAssignment.tenant_id == tenant_id)
        .first()
    )
    if not a:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if not a.is_active:
        raise HTTPException(status_code=400, detail="Already released")

    a.is_active = False
    a.released_at = datetime.utcnow()
    a.updated_at = datetime.utcnow()
    job = db.query(WorkshopJob).filter(WorkshopJob.id == a.job_id).first()
    if job:
        job.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(a)
    nm = a.employee.name if a.employee else None
    return AssignmentResponse(
        id=a.id,
        job_id=a.job_id,
        employee_id=a.employee_id,
        employee_name=nm,
        role=a.role,
        assigned_at=a.assigned_at,
        released_at=a.released_at,
        is_active=a.is_active,
    )
