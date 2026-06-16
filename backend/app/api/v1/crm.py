from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.dependencies import get_db, get_current_user, require_tenant_id
from app.modules.crm.models import CrmActivity, CrmLead
from app.modules.tenancy.models import User

router = APIRouter()

LEAD_STAGES = ("new", "qualified", "proposal", "won", "lost")
ACTIVITY_TYPES = ("call", "visit", "email", "task", "meeting", "note")


class LeadCreate(BaseModel):
    name: str
    company_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    source: Optional[str] = None
    stage: str = "new"
    estimated_value: Optional[str] = None
    owner_user_id: Optional[int] = None
    next_action: Optional[str] = None
    notes: Optional[str] = None


class LeadUpdate(BaseModel):
    name: Optional[str] = None
    company_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    source: Optional[str] = None
    stage: Optional[str] = None
    estimated_value: Optional[str] = None
    owner_user_id: Optional[int] = None
    next_action: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class LeadResponse(BaseModel):
    id: int
    name: str
    company_name: Optional[str]
    email: Optional[str]
    phone: Optional[str]
    source: Optional[str]
    stage: str
    estimated_value: Optional[str]
    owner_user_id: Optional[int]
    next_action: Optional[str]
    notes: Optional[str]
    is_active: bool

    class Config:
        from_attributes = True


@router.get("/leads", response_model=List[LeadResponse])
async def list_leads(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    stage: Optional[str] = None,
    search: Optional[str] = None,
):
    q = db.query(CrmLead).filter(CrmLead.tenant_id == tenant_id, CrmLead.is_active == True)
    if stage:
        if stage not in LEAD_STAGES:
            raise HTTPException(status_code=400, detail=f"stage must be one of {LEAD_STAGES}")
        q = q.filter(CrmLead.stage == stage)
    if search:
        s = f"%{search.strip()}%"
        q = q.filter(
            (CrmLead.name.ilike(s))
            | (CrmLead.company_name.ilike(s))
            | (CrmLead.email.ilike(s))
            | (CrmLead.phone.ilike(s))
        )
    return q.order_by(CrmLead.id.desc()).all()


@router.post("/leads", response_model=LeadResponse)
async def create_lead(
    body: LeadCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    if body.stage not in LEAD_STAGES:
        raise HTTPException(status_code=400, detail=f"stage must be one of {LEAD_STAGES}")
    lead = CrmLead(
        tenant_id=tenant_id,
        name=body.name,
        company_name=body.company_name,
        email=body.email,
        phone=body.phone,
        source=body.source,
        stage=body.stage,
        estimated_value=body.estimated_value,
        owner_user_id=body.owner_user_id or current_user.id,
        next_action=body.next_action,
        notes=body.notes,
        created_by=current_user.id,
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return lead


@router.patch("/leads/{lead_id}", response_model=LeadResponse)
async def update_lead(
    lead_id: int,
    body: LeadUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    lead = (
        db.query(CrmLead)
        .filter(CrmLead.id == lead_id, CrmLead.tenant_id == tenant_id)
        .first()
    )
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    data = body.model_dump(exclude_unset=True)
    if "stage" in data:
        next_stage = data["stage"]
        if next_stage not in LEAD_STAGES:
            raise HTTPException(status_code=400, detail=f"stage must be one of {LEAD_STAGES}")
        if lead.stage in ("won", "lost") and next_stage != lead.stage:
            raise HTTPException(status_code=400, detail="Closed leads cannot change stage")
    if "stage" in data and data["stage"] in ("won", "lost"):
        lead.closed_at = datetime.utcnow()
    for k, v in data.items():
        setattr(lead, k, v)
    db.commit()
    db.refresh(lead)
    return lead


# ---------- Activities (calls, visits, tasks) ----------


class ActivityCreate(BaseModel):
    lead_id: Optional[int] = None
    customer_id: Optional[int] = None
    activity_type: str  # call, visit, email, task, meeting, note
    subject: str
    due_at: Optional[datetime] = None
    owner_user_id: Optional[int] = None
    notes: Optional[str] = None


class ActivityUpdate(BaseModel):
    subject: Optional[str] = None
    due_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    notes: Optional[str] = None


class ActivityResponse(BaseModel):
    id: int
    lead_id: Optional[int]
    customer_id: Optional[int]
    activity_type: str
    subject: str
    due_at: Optional[datetime]
    completed_at: Optional[datetime]
    owner_user_id: Optional[int]
    notes: Optional[str]

    class Config:
        from_attributes = True


@router.get("/activities", response_model=List[ActivityResponse])
async def list_activities(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    lead_id: Optional[int] = None,
    open_only: bool = False,
    overdue_only: bool = False,
    activity_type: Optional[str] = None,
    owner_user_id: Optional[int] = None,
    search: Optional[str] = None,
):
    q = db.query(CrmActivity).filter(CrmActivity.tenant_id == tenant_id)
    if lead_id is not None:
        q = q.filter(CrmActivity.lead_id == lead_id)
    if activity_type:
        if activity_type not in ACTIVITY_TYPES:
            raise HTTPException(status_code=400, detail=f"activity_type must be one of {ACTIVITY_TYPES}")
        q = q.filter(CrmActivity.activity_type == activity_type)
    if owner_user_id is not None:
        q = q.filter(CrmActivity.owner_user_id == owner_user_id)
    if search:
        s = f"%{search.strip()}%"
        q = q.filter(CrmActivity.subject.ilike(s))
    if open_only:
        q = q.filter(CrmActivity.completed_at.is_(None))
    if overdue_only:
        q = q.filter(CrmActivity.completed_at.is_(None), CrmActivity.due_at.is_not(None), CrmActivity.due_at < datetime.utcnow())
    return q.order_by(CrmActivity.id.desc()).limit(300).all()


@router.post("/activities", response_model=ActivityResponse)
async def create_activity(
    body: ActivityCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    if body.lead_id is None and body.customer_id is None:
        raise HTTPException(status_code=400, detail="Provide lead_id and/or customer_id")
    if body.activity_type not in ACTIVITY_TYPES:
        raise HTTPException(status_code=400, detail=f"activity_type must be one of {ACTIVITY_TYPES}")
    if body.lead_id is not None:
        lead = db.query(CrmLead).filter(CrmLead.id == body.lead_id, CrmLead.tenant_id == tenant_id).first()
        if not lead:
            raise HTTPException(status_code=404, detail="Lead not found")

    act = CrmActivity(
        tenant_id=tenant_id,
        lead_id=body.lead_id,
        customer_id=body.customer_id,
        activity_type=body.activity_type,
        subject=body.subject,
        due_at=body.due_at,
        owner_user_id=body.owner_user_id or current_user.id,
        notes=body.notes,
        created_by=current_user.id,
    )
    db.add(act)
    db.commit()
    db.refresh(act)
    return act


@router.patch("/activities/{activity_id}", response_model=ActivityResponse)
async def update_activity(
    activity_id: int,
    body: ActivityUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    act = (
        db.query(CrmActivity)
        .filter(CrmActivity.id == activity_id, CrmActivity.tenant_id == tenant_id)
        .first()
    )
    if not act:
        raise HTTPException(status_code=404, detail="Activity not found")
    data = body.model_dump(exclude_unset=True)
    if "completed_at" in data and data["completed_at"] and act.due_at and data["completed_at"] < act.due_at:
        raise HTTPException(status_code=400, detail="completed_at cannot be before due_at")
    for k, v in data.items():
        setattr(act, k, v)
    act.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(act)
    return act


@router.get("/summary", response_model=dict)
async def crm_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    leads = db.query(CrmLead).filter(CrmLead.tenant_id == tenant_id, CrmLead.is_active == True).all()
    activities = db.query(CrmActivity).filter(CrmActivity.tenant_id == tenant_id).all()
    lead_counts = {stage: 0 for stage in LEAD_STAGES}
    for lead in leads:
        if lead.stage in lead_counts:
            lead_counts[lead.stage] += 1
    open_activities = sum(1 for a in activities if a.completed_at is None)
    overdue_open = sum(1 for a in activities if a.completed_at is None and a.due_at and a.due_at < datetime.utcnow())
    return {
        "total_leads": len(leads),
        "stages": lead_counts,
        "open_activities": open_activities,
        "overdue_open_activities": overdue_open,
    }
