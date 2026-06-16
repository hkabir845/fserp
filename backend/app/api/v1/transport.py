"""Fleet: vehicles, drivers, trips, delivery notes, trip expenses."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from app.core.dependencies import get_db, get_current_user, require_tenant_id
from app.modules.tenancy.models import User
from app.modules.transport.models import DeliveryNote, Driver, Trip, TripExpense, Vehicle

router = APIRouter()


# --- Vehicles ---


class VehicleCreate(BaseModel):
    reg_no: str = Field(..., min_length=1)
    type: str = "truck"
    capacity: Optional[str] = None


class VehicleResponse(BaseModel):
    id: int
    reg_no: str
    type: str
    capacity: Optional[str]
    is_active: bool

    class Config:
        from_attributes = True


# --- Drivers ---


class DriverCreate(BaseModel):
    name: str
    phone: Optional[str] = None
    license_number: Optional[str] = None


class DriverResponse(BaseModel):
    id: int
    name: str
    phone: Optional[str]
    license_number: Optional[str]
    is_active: bool

    class Config:
        from_attributes = True


# --- Trips ---


class TripCreate(BaseModel):
    trip_number: str
    trip_type: str = Field(..., description="own_delivery or third_party")
    vehicle_id: int
    driver_id: int
    origin: Optional[str] = None
    destination: Optional[str] = None
    start_date: Optional[datetime] = None


class TripResponse(BaseModel):
    id: int
    trip_number: str
    trip_type: str
    vehicle_id: int
    driver_id: int
    origin: Optional[str]
    destination: Optional[str]
    start_date: Optional[datetime]
    end_date: Optional[datetime]
    status: str
    vehicle_reg_no: Optional[str] = None
    driver_name: Optional[str] = None

    class Config:
        from_attributes = True


class TripExpenseCreate(BaseModel):
    expense_type: str = Field(..., description="fuel, toll, maintenance, allowance, other")
    amount: float = Field(..., ge=0)
    date: datetime
    notes: Optional[str] = None


class DeliveryNoteCreate(BaseModel):
    dn_number: str
    customer_id: Optional[int] = None
    ref_invoice_id: Optional[int] = None


@router.get("/vehicles", response_model=List[VehicleResponse])
async def list_vehicles(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    active_only: bool = True,
):
    q = db.query(Vehicle).filter(Vehicle.tenant_id == tenant_id)
    if active_only:
        q = q.filter(Vehicle.is_active == True)
    return q.order_by(Vehicle.reg_no).all()


@router.post("/vehicles", response_model=VehicleResponse)
async def create_vehicle(
    body: VehicleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    dup = (
        db.query(Vehicle)
        .filter(Vehicle.tenant_id == tenant_id, Vehicle.reg_no == body.reg_no.strip().upper())
        .first()
    )
    if dup:
        raise HTTPException(status_code=400, detail="Registration already exists")

    v = Vehicle(
        tenant_id=tenant_id,
        reg_no=body.reg_no.strip().upper(),
        type=body.type,
        capacity=body.capacity,
        is_active=True,
        created_by=current_user.id,
    )
    db.add(v)
    db.commit()
    db.refresh(v)
    return v


@router.get("/drivers", response_model=List[DriverResponse])
async def list_drivers(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    active_only: bool = True,
):
    q = db.query(Driver).filter(Driver.tenant_id == tenant_id)
    if active_only:
        q = q.filter(Driver.is_active == True)
    return q.order_by(Driver.name).all()


@router.post("/drivers", response_model=DriverResponse)
async def create_driver(
    body: DriverCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    d = Driver(
        tenant_id=tenant_id,
        name=body.name.strip(),
        phone=body.phone,
        license_number=body.license_number,
        is_active=True,
        created_by=current_user.id,
    )
    db.add(d)
    db.commit()
    db.refresh(d)
    return d


@router.get("/trips", response_model=List[TripResponse])
async def list_trips(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    limit: int = 100,
    status: Optional[str] = None,
    trip_type: Optional[str] = None,
    search: Optional[str] = None,
):
    query = (
        db.query(Trip)
        .options(joinedload(Trip.vehicle), joinedload(Trip.driver))
        .filter(Trip.tenant_id == tenant_id)
    )
    if status:
        query = query.filter(Trip.status == status)
    if trip_type:
        query = query.filter(Trip.trip_type == trip_type)
    if search:
        like = f"%{search.strip()}%"
        query = query.filter(Trip.trip_number.ilike(like))

    rows = query.order_by(Trip.id.desc()).limit(min(limit, 500)).all()
    return [
        TripResponse(
            id=t.id,
            trip_number=t.trip_number,
            trip_type=t.trip_type,
            vehicle_id=t.vehicle_id,
            driver_id=t.driver_id,
            origin=t.origin,
            destination=t.destination,
            start_date=t.start_date,
            end_date=t.end_date,
            status=t.status,
            vehicle_reg_no=t.vehicle.reg_no if t.vehicle else None,
            driver_name=t.driver.name if t.driver else None,
        )
        for t in rows
    ]


@router.post("/trips", response_model=TripResponse)
async def create_trip(
    body: TripCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    dup = (
        db.query(Trip)
        .filter(Trip.tenant_id == tenant_id, Trip.trip_number == body.trip_number.strip())
        .first()
    )
    if dup:
        raise HTTPException(status_code=400, detail="trip_number already exists")

    v = db.query(Vehicle).filter(Vehicle.id == body.vehicle_id, Vehicle.tenant_id == tenant_id).first()
    dr = db.query(Driver).filter(Driver.id == body.driver_id, Driver.tenant_id == tenant_id).first()
    if not v or not dr:
        raise HTTPException(status_code=400, detail="Invalid vehicle or driver")

    t = Trip(
        tenant_id=tenant_id,
        trip_number=body.trip_number.strip(),
        trip_type=body.trip_type,
        vehicle_id=body.vehicle_id,
        driver_id=body.driver_id,
        origin=body.origin,
        destination=body.destination,
        start_date=body.start_date,
        status="draft",
        created_by=current_user.id,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


@router.patch("/trips/{trip_id}/status", response_model=TripResponse)
async def set_trip_status(
    trip_id: int,
    status: str = Query(..., description="draft, in_progress, completed, cancelled"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    allowed = {"draft", "in_progress", "completed", "cancelled"}
    if status not in allowed:
        raise HTTPException(status_code=400, detail=f"status must be one of {allowed}")
    t = db.query(Trip).filter(Trip.id == trip_id, Trip.tenant_id == tenant_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Trip not found")
    if t.status == status:
        return t

    # Prevent invalid lifecycle jumps in transport operations.
    transitions = {
        "draft": {"in_progress", "cancelled"},
        "in_progress": {"completed", "cancelled"},
        "completed": set(),
        "cancelled": set(),
    }
    if status not in transitions.get(t.status, set()):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status transition from '{t.status}' to '{status}'",
        )

    t.status = status
    if status == "in_progress" and not t.start_date:
        t.start_date = datetime.utcnow()
    if status == "completed":
        t.end_date = datetime.utcnow()
    t.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(t)
    return t


@router.get("/trips/summary", response_model=dict)
async def trips_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    rows = db.query(Trip.status).filter(Trip.tenant_id == tenant_id).all()
    counts = {"draft": 0, "in_progress": 0, "completed": 0, "cancelled": 0}
    for (status,) in rows:
        if status in counts:
            counts[status] += 1
    counts["total"] = len(rows)
    return counts


@router.post("/trips/{trip_id}/expenses", response_model=dict)
async def add_trip_expense(
    trip_id: int,
    body: TripExpenseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    trip = db.query(Trip).filter(Trip.id == trip_id, Trip.tenant_id == tenant_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    ex = TripExpense(
        tenant_id=tenant_id,
        trip_id=trip.id,
        expense_type=body.expense_type,
        amount=Decimal(str(body.amount)),
        date=body.date,
        notes=body.notes,
        created_by=current_user.id,
    )
    db.add(ex)
    db.commit()
    db.refresh(ex)
    return {"id": ex.id, "trip_id": trip.id, "expense_type": ex.expense_type, "amount": float(ex.amount)}


@router.post("/trips/{trip_id}/delivery-notes", response_model=dict)
async def add_delivery_note(
    trip_id: int,
    body: DeliveryNoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    trip = db.query(Trip).filter(Trip.id == trip_id, Trip.tenant_id == tenant_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    dup = (
        db.query(DeliveryNote)
        .filter(DeliveryNote.tenant_id == tenant_id, DeliveryNote.dn_number == body.dn_number.strip())
        .first()
    )
    if dup:
        raise HTTPException(status_code=400, detail="DN number already exists")

    dn = DeliveryNote(
        tenant_id=tenant_id,
        trip_id=trip.id,
        dn_number=body.dn_number.strip(),
        customer_id=body.customer_id,
        ref_invoice_id=body.ref_invoice_id,
        status="draft",
        created_by=current_user.id,
    )
    db.add(dn)
    db.commit()
    db.refresh(dn)
    return {"id": dn.id, "dn_number": dn.dn_number, "trip_id": trip.id, "status": dn.status}


@router.get("/trips/{trip_id}", response_model=dict)
async def get_trip(
    trip_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    t = (
        db.query(Trip)
        .options(joinedload(Trip.vehicle), joinedload(Trip.driver), joinedload(Trip.expenses))
        .filter(Trip.id == trip_id, Trip.tenant_id == tenant_id)
        .first()
    )
    if not t:
        raise HTTPException(status_code=404, detail="Trip not found")
    dns = (
        db.query(DeliveryNote).filter(DeliveryNote.trip_id == trip_id, DeliveryNote.tenant_id == tenant_id).all()
    )
    return {
        "id": t.id,
        "trip_number": t.trip_number,
        "trip_type": t.trip_type,
        "status": t.status,
        "vehicle": {"id": t.vehicle.id, "reg_no": t.vehicle.reg_no} if t.vehicle else None,
        "driver": {"id": t.driver.id, "name": t.driver.name} if t.driver else None,
        "expenses": [
            {"id": e.id, "expense_type": e.expense_type, "amount": float(e.amount), "date": e.date.isoformat()}
            for e in (t.expenses or [])
        ],
        "delivery_notes": [{"id": d.id, "dn_number": d.dn_number, "status": d.status} for d in dns],
    }
