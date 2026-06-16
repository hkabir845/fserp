"""
Feed mill laboratory API — samples, specifications (COA / formulation / regulatory),
and results with automatic OOS (out-of-specification) evaluation.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from app.core.dependencies import get_db, get_current_user, require_tenant_id
from app.modules.lab.compliance import evaluate_compliance
from app.modules.lab.models import (
    LabParameter,
    LabResult,
    LabSample,
    LabSpecification,
    LabSpecificationLine,
)
from app.modules.tenancy.models import User

router = APIRouter()


def _d(v) -> Optional[Decimal]:
    if v is None:
        return None
    return Decimal(str(v))


def _sample_no(db: Session, tenant_id: int) -> str:
    return f"LAB-{tenant_id}-{uuid.uuid4().hex[:10].upper()}"


# ----- Parameters -----


class ParameterCreate(BaseModel):
    code: str
    name: str
    unit: Optional[str] = None
    category: str = "proximate"
    method_family: Optional[str] = None
    description: Optional[str] = None


class ParameterResponse(BaseModel):
    id: int
    code: str
    name: str
    unit: Optional[str]
    category: str
    method_family: Optional[str]
    is_active: bool

    class Config:
        from_attributes = True


@router.get("/parameters", response_model=List[ParameterResponse])
async def list_parameters(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    category: Optional[str] = None,
):
    q = db.query(LabParameter).filter(LabParameter.tenant_id == tenant_id, LabParameter.is_active == True)
    if category:
        q = q.filter(LabParameter.category == category)
    return q.order_by(LabParameter.code).all()


@router.post("/parameters", response_model=ParameterResponse)
async def create_parameter(
    body: ParameterCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    dup = (
        db.query(LabParameter)
        .filter(LabParameter.tenant_id == tenant_id, LabParameter.code == body.code.strip().upper())
        .first()
    )
    if dup:
        raise HTTPException(status_code=400, detail="Parameter code already exists")

    p = LabParameter(
        tenant_id=tenant_id,
        code=body.code.strip().upper(),
        name=body.name.strip(),
        unit=body.unit,
        category=body.category,
        method_family=body.method_family,
        description=body.description,
        is_active=True,
        created_by=current_user.id,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


DEFAULT_PARAMETER_SEEDS = [
    ("PROTEIN_CP", "Crude protein", "%", "proximate", "Kjeldahl / NIR"),
    ("FAT_EE", "Ether extract (fat)", "%", "proximate", "Soxhlet / NIR"),
    ("FIBER_CF", "Crude fiber", "%", "proximate", "Weende"),
    ("ASH", "Ash", "%", "proximate", "Muffle"),
    ("MOISTURE", "Moisture", "%", "proximate", "Oven / NIR"),
    ("ENERGY_ME", "Metabolizable energy (poultry)", "kcal/kg", "proximate", "Calculated"),
    ("CALCIUM", "Calcium (Ca)", "%", "minerals", "AAS / ICP"),
    ("PHOS_TOTAL", "Total phosphorus (P)", "%", "minerals", "Colorimetry"),
    ("SALT_NACL", "Salt (NaCl)", "%", "minerals", "Titration"),
    ("AF_B1", "Aflatoxin B1", "µg/kg", "toxins", "ELISA / HPLC"),
    ("ZEARALENONE", "Zearalenone", "µg/kg", "toxins", "ELISA"),
    ("DON", "Deoxynivalenol (DON)", "ppm", "toxins", "ELISA"),
    ("PDI", "Pellet durability index", "%", "physical", "Tumbling box"),
    ("HARDNESS", "Pellet hardness", "kg", "physical", "Kahl"),
    ("FLOATABILITY", "Floatability", "%", "physical", "Tank test"),
    ("SALMONELLA", "Salmonella spp.", "-", "micro", "ISO 6579 enrichment"),
    ("ENTEROBACTERIACEAE", "Enterobacteriaceae", "CFU/g", "micro", "Plate count"),
]


@router.post("/parameters/seed-defaults", response_model=dict)
async def seed_default_parameters(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    """Load a world-class default panel for compound feed mills (proximate, toxins, physical, micro)."""
    created = 0
    for code, name, unit, cat, method in DEFAULT_PARAMETER_SEEDS:
        exists = (
            db.query(LabParameter)
            .filter(LabParameter.tenant_id == tenant_id, LabParameter.code == code)
            .first()
        )
        if exists:
            continue
        db.add(
            LabParameter(
                tenant_id=tenant_id,
                code=code,
                name=name,
                unit=unit,
                category=cat,
                method_family=method,
                is_active=True,
                created_by=current_user.id,
            )
        )
        created += 1
    db.commit()
    return {"parameters_created": created, "detail": "Default lab parameter catalog seeded where missing."}


# ----- Specifications -----


class SpecLineIn(BaseModel):
    parameter_id: int
    lower_limit: Optional[float] = None
    upper_limit: Optional[float] = None
    target_value: Optional[float] = None
    unit_override: Optional[str] = None
    is_critical: bool = False
    notes: Optional[str] = None


class SpecificationCreate(BaseModel):
    name: str
    purpose: str = "formulation_release"
    supplier_id: Optional[int] = None
    ingredient_item_id: Optional[int] = None
    feed_product_id: Optional[int] = None
    bom_id: Optional[int] = None
    version: Optional[str] = None
    notes: Optional[str] = None
    lines: List[SpecLineIn] = Field(default_factory=list)


class SpecificationResponse(BaseModel):
    id: int
    name: str
    purpose: str
    supplier_id: Optional[int]
    ingredient_item_id: Optional[int]
    feed_product_id: Optional[int]
    bom_id: Optional[int]
    version: Optional[str]
    is_active: bool

    class Config:
        from_attributes = True


@router.get("/specifications", response_model=List[SpecificationResponse])
async def list_specifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    purpose: Optional[str] = None,
):
    q = db.query(LabSpecification).filter(LabSpecification.tenant_id == tenant_id, LabSpecification.is_active == True)
    if purpose:
        q = q.filter(LabSpecification.purpose == purpose)
    return q.order_by(LabSpecification.name).all()


@router.post("/specifications", response_model=dict)
async def create_specification(
    body: SpecificationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    spec = LabSpecification(
        tenant_id=tenant_id,
        name=body.name.strip(),
        purpose=body.purpose,
        supplier_id=body.supplier_id,
        ingredient_item_id=body.ingredient_item_id,
        feed_product_id=body.feed_product_id,
        bom_id=body.bom_id,
        version=body.version,
        notes=body.notes,
        effective_from=datetime.utcnow(),
        is_active=True,
        created_by=current_user.id,
    )
    db.add(spec)
    db.flush()

    for ln in body.lines:
        db.add(
            LabSpecificationLine(
                tenant_id=tenant_id,
                specification_id=spec.id,
                parameter_id=ln.parameter_id,
                lower_limit=_d(ln.lower_limit),
                upper_limit=_d(ln.upper_limit),
                target_value=_d(ln.target_value),
                unit_override=ln.unit_override,
                is_critical=ln.is_critical,
                notes=ln.notes,
                created_by=current_user.id,
            )
        )

    db.commit()
    db.refresh(spec)
    return {"id": spec.id, "name": spec.name}


@router.get("/specifications/{spec_id}", response_model=dict)
async def get_specification(
    spec_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    spec = (
        db.query(LabSpecification)
        .options(joinedload(LabSpecification.lines).joinedload(LabSpecificationLine.parameter))
        .filter(LabSpecification.id == spec_id, LabSpecification.tenant_id == tenant_id)
        .first()
    )
    if not spec:
        raise HTTPException(status_code=404, detail="Specification not found")
    lines_out = []
    for ln in spec.lines:
        p = ln.parameter
        lines_out.append(
            {
                "id": ln.id,
                "parameter_id": ln.parameter_id,
                "code": p.code if p else None,
                "name": p.name if p else None,
                "lower_limit": float(ln.lower_limit) if ln.lower_limit is not None else None,
                "upper_limit": float(ln.upper_limit) if ln.upper_limit is not None else None,
                "target_value": float(ln.target_value) if ln.target_value is not None else None,
                "unit_override": ln.unit_override,
                "is_critical": ln.is_critical,
            }
        )
    return {
        "id": spec.id,
        "name": spec.name,
        "purpose": spec.purpose,
        "lines": lines_out,
    }


# ----- Samples & results -----


class SampleCreate(BaseModel):
    sample_type: str = "finished_feed"
    item_id: Optional[int] = None
    ingredient_id: Optional[int] = None
    feed_product_id: Optional[int] = None
    production_order_id: Optional[int] = None
    supplier_id: Optional[int] = None
    lab_specification_id: Optional[int] = None
    lot_reference: Optional[str] = None
    sampling_point: Optional[str] = None
    sampled_at: Optional[datetime] = None
    priority: str = "normal"
    chain_of_custody_notes: Optional[str] = None


class SampleResponse(BaseModel):
    id: int
    sample_number: str
    sample_type: str
    status: str
    lab_specification_id: Optional[int]
    lot_reference: Optional[str]
    overall_compliant: Optional[bool]

    class Config:
        from_attributes = True


class ResultUpsert(BaseModel):
    parameter_id: int
    result_numeric: Optional[float] = None
    result_text: Optional[str] = None
    method_reference: Optional[str] = None
    deviation_notes: Optional[str] = None


def _apply_limits_and_comply(
    db: Session,
    tenant_id: int,
    sample: LabSample,
    parameter_id: int,
    value: Optional[Decimal],
    text_val: Optional[str],
) -> tuple[Optional[Decimal], Optional[Decimal], Optional[Decimal], Optional[bool], bool]:
    """Returns lower_applied, upper_applied, target_applied, compliant, is_critical."""
    lower = upper = target = None
    critical = False
    compliant: Optional[bool] = None

    if not sample.lab_specification_id:
        return None, None, None, None, False

    line = (
        db.query(LabSpecificationLine)
        .filter(
            LabSpecificationLine.tenant_id == tenant_id,
            LabSpecificationLine.specification_id == sample.lab_specification_id,
            LabSpecificationLine.parameter_id == parameter_id,
        )
        .first()
    )
    if line:
        lower = line.lower_limit
        upper = line.upper_limit
        target = line.target_value
        critical = bool(line.is_critical)
        if value is not None:
            compliant = evaluate_compliance(value, lower, upper)
        elif text_val is not None and text_val.strip():
            # Qualitative: no auto-pass unless future rules
            compliant = None

    elif value is not None:
        compliant = None

    return lower, upper, target, compliant, critical


def _recompute_sample_overall(db: Session, sample: LabSample, tenant_id: int) -> None:
    """Overall pass when no evaluated result is non-compliant; unknown limits leave compliant None per analyte."""
    results = (
        db.query(LabResult).filter(LabResult.sample_id == sample.id, LabResult.tenant_id == tenant_id).all()
    )
    if not results:
        sample.overall_compliant = None
        return
    oos = [r for r in results if r.compliant is False]
    if oos:
        sample.overall_compliant = False
        return
    unset = [r for r in results if r.compliant is None]
    if unset:
        sample.overall_compliant = None  # pending quantitative limits or qualitative review
    else:
        sample.overall_compliant = True


@router.get("/samples", response_model=List[SampleResponse])
async def list_samples(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    status: Optional[str] = None,
    limit: int = Query(200, ge=1, le=500),
):
    q = db.query(LabSample).filter(LabSample.tenant_id == tenant_id)
    if status:
        q = q.filter(LabSample.status == status)
    return q.order_by(LabSample.id.desc()).limit(limit).all()


@router.post("/samples", response_model=SampleResponse)
async def create_sample(
    body: SampleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    if body.lab_specification_id:
        sp = (
            db.query(LabSpecification)
            .filter(LabSpecification.id == body.lab_specification_id, LabSpecification.tenant_id == tenant_id)
            .first()
        )
        if not sp:
            raise HTTPException(status_code=400, detail="Specification not found")

    s = LabSample(
        tenant_id=tenant_id,
        sample_number=_sample_no(db, tenant_id),
        sample_type=body.sample_type,
        status="logged",
        item_id=body.item_id,
        ingredient_id=body.ingredient_id,
        feed_product_id=body.feed_product_id,
        production_order_id=body.production_order_id,
        supplier_id=body.supplier_id,
        lab_specification_id=body.lab_specification_id,
        lot_reference=body.lot_reference,
        sampling_point=body.sampling_point,
        sampled_at=body.sampled_at or datetime.utcnow(),
        received_at=datetime.utcnow(),
        priority=body.priority,
        chain_of_custody_notes=body.chain_of_custody_notes,
        created_by=current_user.id,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


@router.get("/samples/{sample_id}", response_model=dict)
async def get_sample(
    sample_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    s = (
        db.query(LabSample)
        .options(joinedload(LabSample.results).joinedload(LabResult.parameter))
        .filter(LabSample.id == sample_id, LabSample.tenant_id == tenant_id)
        .first()
    )
    if not s:
        raise HTTPException(status_code=404, detail="Sample not found")

    res_list = []
    for r in s.results:
        p = r.parameter
        res_list.append(
            {
                "id": r.id,
                "parameter_id": r.parameter_id,
                "code": p.code if p else None,
                "name": p.name if p else None,
                "unit": p.unit if p else None,
                "result_numeric": float(r.result_numeric) if r.result_numeric is not None else None,
                "result_text": r.result_text,
                "lower_applied": float(r.lower_applied) if r.lower_applied is not None else None,
                "upper_applied": float(r.upper_applied) if r.upper_applied is not None else None,
                "compliant": r.compliant,
                "is_critical": r.is_critical,
                "tested_at": r.tested_at.isoformat() if r.tested_at else None,
                "deviation_notes": r.deviation_notes,
            }
        )

    return {
        "id": s.id,
        "sample_number": s.sample_number,
        "sample_type": s.sample_type,
        "status": s.status,
        "lot_reference": s.lot_reference,
        "sampling_point": s.sampling_point,
        "lab_specification_id": s.lab_specification_id,
        "overall_compliant": s.overall_compliant,
        "results": res_list,
    }


@router.patch("/samples/{sample_id}/status")
async def set_sample_status(
    sample_id: int,
    status: str = Query(..., description="logged | received | in_progress | completed | on_hold | cancelled"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    allowed = {"logged", "received", "in_progress", "completed", "on_hold", "cancelled"}
    if status not in allowed:
        raise HTTPException(status_code=400, detail=f"status must be one of {sorted(allowed)}")
    s = db.query(LabSample).filter(LabSample.id == sample_id, LabSample.tenant_id == tenant_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Sample not found")
    s.status = status
    if status == "completed":
        s.completed_at = datetime.utcnow()
    s.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(s)
    return {"id": s.id, "status": s.status}


@router.post("/samples/{sample_id}/results", response_model=dict)
async def upsert_results(
    sample_id: int,
    items: List[ResultUpsert],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    s = db.query(LabSample).filter(LabSample.id == sample_id, LabSample.tenant_id == tenant_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Sample not found")

    out = []
    for it in items:
        param = db.query(LabParameter).filter(LabParameter.id == it.parameter_id, LabParameter.tenant_id == tenant_id).first()
        if not param:
            raise HTTPException(status_code=400, detail=f"Unknown parameter_id {it.parameter_id}")

        val = _d(it.result_numeric) if it.result_numeric is not None else None
        low, up, tgt, comp, crit = _apply_limits_and_comply(db, tenant_id, s, it.parameter_id, val, it.result_text)

        existing = (
            db.query(LabResult)
            .filter(LabResult.sample_id == s.id, LabResult.parameter_id == it.parameter_id)
            .first()
        )
        if existing:
            existing.result_numeric = val
            existing.result_text = it.result_text
            existing.lower_applied = low
            existing.upper_applied = up
            existing.target_applied = tgt
            existing.compliant = comp
            existing.is_critical = crit
            existing.method_reference = it.method_reference
            existing.deviation_notes = it.deviation_notes
            existing.tested_at = datetime.utcnow()
            existing.tested_by_user_id = current_user.id
            existing.updated_at = datetime.utcnow()
            row = existing
        else:
            row = LabResult(
                tenant_id=tenant_id,
                sample_id=s.id,
                parameter_id=it.parameter_id,
                result_numeric=val,
                result_text=it.result_text,
                lower_applied=low,
                upper_applied=up,
                target_applied=tgt,
                compliant=comp,
                is_critical=crit,
                method_reference=it.method_reference,
                deviation_notes=it.deviation_notes,
                tested_at=datetime.utcnow(),
                tested_by_user_id=current_user.id,
                created_by=current_user.id,
            )
            db.add(row)

        out.append({"parameter_id": it.parameter_id, "compliant": comp, "is_critical": crit})

    db.flush()
    if s.status == "logged":
        s.status = "in_progress"
    _recompute_sample_overall(db, s, tenant_id)
    s.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(s)

    return {"sample_id": s.id, "overall_compliant": s.overall_compliant, "results": out}


@router.post("/samples/{sample_id}/recalculate-overall")
async def recalculate_overall(
    sample_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    s = db.query(LabSample).filter(LabSample.id == sample_id, LabSample.tenant_id == tenant_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Sample not found")
    _recompute_sample_overall(db, s, tenant_id)
    s.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(s)
    return {"sample_id": s.id, "overall_compliant": s.overall_compliant}
