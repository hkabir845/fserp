"""
Pre-Formulation Library API Endpoints
World Standard Pre-Formulation Templates
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from decimal import Decimal
from pydantic import BaseModel
from fastapi import Request

from app.core.dependencies import get_db, get_current_user
from fastapi import Request
from app.modules.tenancy.models import User
from app.modules.feed_manufacturing.preformulation_models import PreFormulation, PreFormulationLine
from app.modules.feed_manufacturing.preformulation_service import PreFormulationService

router = APIRouter()

# ==================== Pydantic Models ====================

class PreFormulationResponse(BaseModel):
    id: int
    code: str
    title: str
    category: str
    species: str
    stage: str
    process_type: str
    float_type: Optional[str]
    pellet_mm: Optional[float]
    default_batch_kg: float
    protein_target_min: Optional[float]
    protein_target_max: Optional[float]
    is_reference_only: bool
    is_active: bool
    
    class Config:
        from_attributes = True

class PreFormulationLineResponse(BaseModel):
    id: int
    ingredient_item_id: int
    ingredient_name: str
    inclusion_value: float
    min_percent: Optional[float]
    max_percent: Optional[float]
    phase: Optional[str]
    is_process_aid: bool
    sort_order: int
    
    class Config:
        from_attributes = True

class PreFormulationDetailResponse(BaseModel):
    id: int
    code: str
    title: str
    category: str
    species: str
    stage: str
    process_type: str
    float_type: Optional[str]
    pellet_mm: Optional[float]
    default_batch_kg: float
    protein_target_min: Optional[float]
    protein_target_max: Optional[float]
    fat_target_min: Optional[float]
    fat_target_max: Optional[float]
    fiber_target_max: Optional[float]
    moisture_target_max: Optional[float]
    energy_target_min: Optional[float]
    notes: Optional[str]
    lines: List[PreFormulationLineResponse]

class CalculateRequest(BaseModel):
    output_qty: float
    output_uom: str  # 'kg' or 'ton'

class CalculateResponse(BaseModel):
    ingredients: List[dict]
    totals: dict
    warnings: List[str]

class CopyToBomRequest(BaseModel):
    product_name: Optional[str] = None
    product_item_id: Optional[int] = None
    bom_code: str
    version: int = 1
    default_batch_kg: Optional[float] = None
    route_type: Optional[str] = None
    pellet_mm: Optional[float] = None
    float_type: Optional[str] = None
    notes: Optional[str] = None

# ==================== Endpoints ====================

def get_tenant_id_from_request(request: Request, db: Session) -> Optional[int]:
    """Get tenant_id from request header X-Tenant-ID or X-Tenant-Domain"""
    # Try X-Tenant-ID first
    tenant_id_header = request.headers.get("X-Tenant-ID")
    if tenant_id_header:
        try:
            return int(tenant_id_header)
        except:
            pass
    
    # Try X-Tenant-Domain (existing system)
    tenant_domain = request.headers.get("X-Tenant-Domain")
    if tenant_domain:
        from app.modules.tenancy.models import Tenant
        tenant = db.query(Tenant).filter(Tenant.domain == tenant_domain).first()
        if tenant:
            return tenant.id
    
    # Try from request state (set by middleware)
    tenant_id = getattr(request.state, "tenant_id", None)
    return tenant_id

@router.get("/preformulations/filters")
async def get_filters(
    category: Optional[str] = Query(None),
    species: Optional[str] = Query(None),
    stage: Optional[str] = Query(None),
    process_type: Optional[str] = Query(None),
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get distinct filter values for dropdowns"""
    tenant_id = get_tenant_id_from_request(request, db)
    filters = PreFormulationService.get_filters(
        db, tenant_id, category, species, stage, process_type
    )
    return filters

@router.get("/preformulations", response_model=List[PreFormulationResponse])
async def list_preformulations(
    category: Optional[str] = Query(None),
    species: Optional[str] = Query(None),
    stage: Optional[str] = Query(None),
    process_type: Optional[str] = Query(None),
    pellet_mm: Optional[float] = Query(None),
    float_type: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List pre-formulations with filters"""
    tenant_id = get_tenant_id_from_request(request, db)
    templates = PreFormulationService.list_preformulations(
        db, tenant_id, category, species, stage, process_type, pellet_mm, float_type, q
    )
    return templates

@router.get("/preformulations/{preform_id}", response_model=PreFormulationDetailResponse)
async def get_preformulation(
    preform_id: int,
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get pre-formulation details with lines"""
    tenant_id = get_tenant_id_from_request(request, db)
    template = PreFormulationService.get_preformulation(db, preform_id, tenant_id)
    
    if not template:
        raise HTTPException(status_code=404, detail="Pre-formulation not found")
    
    # Get lines with ingredient names
    lines = db.query(PreFormulationLine).filter(
        PreFormulationLine.pre_formulation_id == preform_id
    ).order_by(PreFormulationLine.sort_order).all()
    
    from app.modules.catalog.models import Item
    line_responses = []
    for line in lines:
        item = db.query(Item).filter(Item.id == line.ingredient_item_id).first()
        line_responses.append(PreFormulationLineResponse(
            id=line.id,
            ingredient_item_id=line.ingredient_item_id,
            ingredient_name=item.name if item else "Unknown",
            inclusion_value=float(line.inclusion_value),
            min_percent=float(line.min_percent) if line.min_percent else None,
            max_percent=float(line.max_percent) if line.max_percent else None,
            phase=line.phase,
            is_process_aid=line.is_process_aid,
            sort_order=line.sort_order
        ))
    
    return PreFormulationDetailResponse(
        id=template.id,
        code=template.code,
        title=template.title,
        category=template.category,
        species=template.species,
        stage=template.stage,
        process_type=template.process_type,
        float_type=template.float_type,
        pellet_mm=float(template.pellet_mm) if template.pellet_mm else None,
        default_batch_kg=float(template.default_batch_kg),
        protein_target_min=float(template.protein_target_min) if template.protein_target_min else None,
        protein_target_max=float(template.protein_target_max) if template.protein_target_max else None,
        fat_target_min=float(template.fat_target_min) if template.fat_target_min else None,
        fat_target_max=float(template.fat_target_max) if template.fat_target_max else None,
        fiber_target_max=float(template.fiber_target_max) if template.fiber_target_max else None,
        moisture_target_max=float(template.moisture_target_max) if template.moisture_target_max else None,
        energy_target_min=float(template.energy_target_min) if template.energy_target_min else None,
        notes=template.notes,
        lines=line_responses
    )

@router.post("/preformulations/{preform_id}/calculate", response_model=CalculateResponse)
async def calculate_requirements(
    preform_id: int,
    calc_data: CalculateRequest,
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Calculate ingredient requirements for target output"""
    tenant_id = get_tenant_id(request)
    
    if calc_data.output_uom not in ['kg', 'ton']:
        raise HTTPException(status_code=400, detail="output_uom must be 'kg' or 'ton'")
    
    result = PreFormulationService.calculate_requirements(
        db, preform_id, tenant_id,
        Decimal(str(calc_data.output_qty)), calc_data.output_uom
    )
    
    if 'error' in result:
        raise HTTPException(status_code=404, detail=result['error'])
    
    return CalculateResponse(
        ingredients=result['ingredients'],
        totals=result['totals'],
        warnings=result['warnings']
    )

@router.post("/preformulations/{preform_id}/copy-to-bom")
async def copy_to_bom(
    preform_id: int,
    bom_data: CopyToBomRequest,
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Copy pre-formulation to draft BOM"""
    tenant_id = get_tenant_id(request)
    
    if not bom_data.product_name and not bom_data.product_item_id:
        raise HTTPException(status_code=400, detail="Either product_name or product_item_id is required")
    
    result = PreFormulationService.copy_to_bom(
        db, preform_id, tenant_id, {
            'product_name': bom_data.product_name,
            'product_item_id': bom_data.product_item_id,
            'bom_code': bom_data.bom_code,
            'version': bom_data.version,
            'default_batch_kg': bom_data.default_batch_kg,
            'route_type': bom_data.route_type,
            'pellet_mm': bom_data.pellet_mm,
            'float_type': bom_data.float_type,
            'notes': bom_data.notes
        }
    )
    
    if 'error' in result:
        raise HTTPException(status_code=400, detail=result['error'])
    
    db.commit()
    return result

@router.get("/preformulations/recommendations")
async def get_recommendations(
    species: str = Query(...),
    stage: str = Query(...),
    process_type: str = Query(...),
    pellet_mm: Optional[float] = Query(None),
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get top 3 closest matching templates"""
    tenant_id = get_tenant_id(request)
    recommendations = PreFormulationService.get_recommendations(
        db, tenant_id, species, stage, process_type, pellet_mm
    )
    return recommendations

