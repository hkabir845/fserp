"""
Letter of Credit — import / export trade finance.

Fields support Bangladesh Authorized Dealer (AD) bank workflow and common regulatory
references (IRC/ERC, BB reporting, lodgment). Users must confirm current Bangladesh Bank
& NBR circulars with their bank; this module tracks data operationally.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.dependencies import get_db, get_current_user, require_tenant_id
from app.modules.lc.models import LCAmendment, LetterOfCredit
from app.modules.tenancy.models import User

router = APIRouter()


DEFAULT_IMPORT_DOCUMENTS = [
    {"code": "INV", "label": "Commercial invoice", "status": "pending"},
    {"code": "PL", "label": "Packing list", "status": "pending"},
    {"code": "BL", "label": "Bill of lading / Airway bill", "status": "pending"},
    {"code": "COO", "label": "Certificate of origin", "status": "pending"},
    {"code": "QI", "label": "Quality / inspection certificate", "status": "pending"},
    {"code": "INS", "label": "Insurance certificate or policy", "status": "pending"},
    {"code": "WE", "label": "Weight note (where applicable)", "status": "pending"},
]

DEFAULT_EXPORT_DOCUMENTS = [
    {"code": "INV", "label": "Commercial invoice", "status": "pending"},
    {"code": "PL", "label": "Packing list", "status": "pending"},
    {"code": "BL", "label": "Bill of lading / Airway bill", "status": "pending"},
    {"code": "COO", "label": "Certificate of origin (Bangladesh)", "status": "pending"},
    {"code": "PHYTO", "label": "Phytosanitary / health certificate (if required)", "status": "pending"},
]


def _d(v: Any) -> Decimal:
    if v is None:
        return Decimal("0")
    return Decimal(str(v))


class LCBasePayload(BaseModel):
    lc_internal_number: str = Field(..., min_length=1, max_length=64)
    bank_lc_reference: Optional[str] = None
    direction: str = Field(..., pattern="^(import|export)$")
    deal_type: str = Field("sight", max_length=32)
    applicant_name: str
    applicant_address: Optional[str] = None
    beneficiary_name: str
    beneficiary_address: Optional[str] = None
    beneficiary_country: Optional[str] = None
    issuing_bank_name: str
    issuing_bank_branch: Optional[str] = None
    issuing_bank_swift: Optional[str] = None
    advising_bank_name: Optional[str] = None
    advising_bank_swift: Optional[str] = None
    confirming_bank_name: Optional[str] = None
    currency_code: str = Field("USD", min_length=3, max_length=3)
    amount: float = Field(..., gt=0)
    tolerance_pct_plus: Optional[float] = None
    tolerance_pct_minus: Optional[float] = None
    incoterm: Optional[str] = None
    partial_shipment_allowed: bool = True
    transshipment_allowed: bool = True
    latest_shipment_date: Optional[datetime] = None
    expiry_date: Optional[datetime] = None
    presentation_period_days: Optional[int] = None
    goods_description: str
    goods_category: str = Field("feed_ingredient", max_length=64)
    hs_codes: Optional[str] = None
    bin_tin: Optional[str] = None
    irc_number: Optional[str] = None
    erc_number: Optional[str] = None
    feed_reg_license_ref: Optional[str] = None
    bangladesh_bank_reporting_ref: Optional[str] = None
    bank_lodgment_reference: Optional[str] = None
    insurers_cover_note: Optional[str] = None
    margin_pct: Optional[float] = None
    charges_account_party: Optional[str] = None
    supplier_id: Optional[int] = None
    customer_id: Optional[int] = None
    purchase_order_id: Optional[int] = None
    documents_required: Optional[List[dict]] = None
    compliance_notes: Optional[str] = None
    internal_notes: Optional[str] = None


class LCCreate(LCBasePayload):
    status: str = Field("draft", max_length=32)


class LCUpdate(BaseModel):
    bank_lc_reference: Optional[str] = None
    status: Optional[str] = None
    deal_type: Optional[str] = None
    applicant_name: Optional[str] = None
    applicant_address: Optional[str] = None
    beneficiary_name: Optional[str] = None
    beneficiary_address: Optional[str] = None
    beneficiary_country: Optional[str] = None
    issuing_bank_name: Optional[str] = None
    issuing_bank_branch: Optional[str] = None
    issuing_bank_swift: Optional[str] = None
    advising_bank_name: Optional[str] = None
    advising_bank_swift: Optional[str] = None
    confirming_bank_name: Optional[str] = None
    currency_code: Optional[str] = Field(None, min_length=3, max_length=3)
    amount: Optional[float] = Field(None, gt=0)
    tolerance_pct_plus: Optional[float] = None
    tolerance_pct_minus: Optional[float] = None
    incoterm: Optional[str] = None
    partial_shipment_allowed: Optional[bool] = None
    transshipment_allowed: Optional[bool] = None
    latest_shipment_date: Optional[datetime] = None
    expiry_date: Optional[datetime] = None
    presentation_period_days: Optional[int] = None
    goods_description: Optional[str] = None
    goods_category: Optional[str] = None
    hs_codes: Optional[str] = None
    bin_tin: Optional[str] = None
    irc_number: Optional[str] = None
    erc_number: Optional[str] = None
    feed_reg_license_ref: Optional[str] = None
    bangladesh_bank_reporting_ref: Optional[str] = None
    bank_lodgment_reference: Optional[str] = None
    insurers_cover_note: Optional[str] = None
    margin_pct: Optional[float] = None
    charges_account_party: Optional[str] = None
    supplier_id: Optional[int] = None
    customer_id: Optional[int] = None
    purchase_order_id: Optional[int] = None
    documents_required: Optional[List[dict]] = None
    compliance_notes: Optional[str] = None
    internal_notes: Optional[str] = None


class AmendmentCreate(BaseModel):
    effective_date: datetime
    summary: str = Field(..., min_length=1, max_length=512)
    detail: Optional[str] = None
    amount_before: Optional[float] = None
    amount_after: Optional[float] = None


class AmendmentResponse(BaseModel):
    id: int
    lc_id: int
    amendment_no: int
    effective_date: datetime
    summary: str
    detail: Optional[str]
    amount_before: Optional[float]
    amount_after: Optional[float]

    class Config:
        from_attributes = True


class LCResponse(BaseModel):
    id: int
    lc_internal_number: str
    bank_lc_reference: Optional[str]
    direction: str
    deal_type: str
    status: str
    applicant_name: str
    applicant_address: Optional[str]
    beneficiary_name: str
    beneficiary_address: Optional[str]
    beneficiary_country: Optional[str]
    issuing_bank_name: str
    issuing_bank_branch: Optional[str]
    issuing_bank_swift: Optional[str]
    advising_bank_name: Optional[str]
    advising_bank_swift: Optional[str]
    confirming_bank_name: Optional[str]
    currency_code: str
    amount: float
    tolerance_pct_plus: Optional[float]
    tolerance_pct_minus: Optional[float]
    incoterm: Optional[str]
    partial_shipment_allowed: bool
    transshipment_allowed: bool
    latest_shipment_date: Optional[datetime]
    expiry_date: Optional[datetime]
    presentation_period_days: Optional[int]
    goods_description: str
    goods_category: str
    hs_codes: Optional[str]
    bin_tin: Optional[str]
    irc_number: Optional[str]
    erc_number: Optional[str]
    feed_reg_license_ref: Optional[str]
    bangladesh_bank_reporting_ref: Optional[str]
    bank_lodgment_reference: Optional[str]
    insurers_cover_note: Optional[str]
    margin_pct: Optional[float]
    charges_account_party: Optional[str]
    supplier_id: Optional[int]
    customer_id: Optional[int]
    purchase_order_id: Optional[int]
    documents_required: Optional[List[dict]]
    compliance_notes: Optional[str]
    internal_notes: Optional[str]

    class Config:
        from_attributes = True


class LCDetailResponse(LCResponse):
    amendments: List[AmendmentResponse] = []


def _serialize_lc(r: LetterOfCredit) -> LCResponse:
    return LCResponse(
        id=r.id,
        lc_internal_number=r.lc_internal_number,
        bank_lc_reference=r.bank_lc_reference,
        direction=r.direction,
        deal_type=r.deal_type,
        status=r.status,
        applicant_name=r.applicant_name,
        applicant_address=r.applicant_address,
        beneficiary_name=r.beneficiary_name,
        beneficiary_address=r.beneficiary_address,
        beneficiary_country=r.beneficiary_country,
        issuing_bank_name=r.issuing_bank_name,
        issuing_bank_branch=r.issuing_bank_branch,
        issuing_bank_swift=r.issuing_bank_swift,
        advising_bank_name=r.advising_bank_name,
        advising_bank_swift=r.advising_bank_swift,
        confirming_bank_name=r.confirming_bank_name,
        currency_code=r.currency_code,
        amount=float(r.amount),
        tolerance_pct_plus=float(r.tolerance_pct_plus) if r.tolerance_pct_plus is not None else None,
        tolerance_pct_minus=float(r.tolerance_pct_minus) if r.tolerance_pct_minus is not None else None,
        incoterm=r.incoterm,
        partial_shipment_allowed=bool(r.partial_shipment_allowed),
        transshipment_allowed=bool(r.transshipment_allowed),
        latest_shipment_date=r.latest_shipment_date,
        expiry_date=r.expiry_date,
        presentation_period_days=r.presentation_period_days,
        goods_description=r.goods_description,
        goods_category=r.goods_category,
        hs_codes=r.hs_codes,
        bin_tin=r.bin_tin,
        irc_number=r.irc_number,
        erc_number=r.erc_number,
        feed_reg_license_ref=r.feed_reg_license_ref,
        bangladesh_bank_reporting_ref=r.bangladesh_bank_reporting_ref,
        bank_lodgment_reference=r.bank_lodgment_reference,
        insurers_cover_note=r.insurers_cover_note,
        margin_pct=float(r.margin_pct) if r.margin_pct is not None else None,
        charges_account_party=r.charges_account_party,
        supplier_id=r.supplier_id,
        customer_id=r.customer_id,
        purchase_order_id=r.purchase_order_id,
        documents_required=r.documents_required if isinstance(r.documents_required, list) else None,
        compliance_notes=r.compliance_notes,
        internal_notes=r.internal_notes,
    )


@router.get("/defaults/documents", name="lc_document_defaults")
async def document_defaults(
    direction: str = Query("import", pattern="^(import|export)$"),
):
    """Default document checklist templates for UI (not legal advice)."""
    return {
        "direction": direction,
        "documents": list(DEFAULT_IMPORT_DOCUMENTS if direction == "import" else DEFAULT_EXPORT_DOCUMENTS),
        "notice": "Confirm document set with your Authorized Dealer bank and current Bangladesh Bank / customs guidance.",
    }


@router.get("", response_model=List[LCResponse])
async def list_lcs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    direction: Optional[str] = Query(None, description="import | export"),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
):
    q = db.query(LetterOfCredit).filter(LetterOfCredit.tenant_id == tenant_id)
    if direction:
        q = q.filter(LetterOfCredit.direction == direction)
    if status:
        q = q.filter(LetterOfCredit.status == status)
    if search:
        s = f"%{search.strip()}%"
        q = q.filter(
            (LetterOfCredit.lc_internal_number.ilike(s))
            | (LetterOfCredit.bank_lc_reference.ilike(s))
            | (LetterOfCredit.beneficiary_name.ilike(s))
            | (LetterOfCredit.applicant_name.ilike(s))
        )
    rows = q.order_by(LetterOfCredit.id.desc()).all()
    return [_serialize_lc(r) for r in rows]


@router.post("", response_model=LCResponse)
async def create_lc(
    body: LCCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    exists = (
        db.query(LetterOfCredit)
        .filter(
            LetterOfCredit.tenant_id == tenant_id,
            LetterOfCredit.lc_internal_number == body.lc_internal_number.strip(),
        )
        .first()
    )
    if exists:
        raise HTTPException(status_code=400, detail="LC internal number already exists")

    docs = body.documents_required
    if not docs:
        docs = list(DEFAULT_IMPORT_DOCUMENTS if body.direction == "import" else DEFAULT_EXPORT_DOCUMENTS)

    row = LetterOfCredit(
        tenant_id=tenant_id,
        lc_internal_number=body.lc_internal_number.strip(),
        bank_lc_reference=body.bank_lc_reference.strip() if body.bank_lc_reference else None,
        direction=body.direction,
        deal_type=(body.deal_type or "sight").strip(),
        status=body.status.strip() if body.status else "draft",
        applicant_name=body.applicant_name.strip(),
        applicant_address=body.applicant_address,
        beneficiary_name=body.beneficiary_name.strip(),
        beneficiary_address=body.beneficiary_address,
        beneficiary_country=body.beneficiary_country,
        issuing_bank_name=body.issuing_bank_name.strip(),
        issuing_bank_branch=body.issuing_bank_branch,
        issuing_bank_swift=body.issuing_bank_swift.strip() if body.issuing_bank_swift else None,
        advising_bank_name=body.advising_bank_name.strip() if body.advising_bank_name else None,
        advising_bank_swift=body.advising_bank_swift.strip() if body.advising_bank_swift else None,
        confirming_bank_name=body.confirming_bank_name.strip() if body.confirming_bank_name else None,
        currency_code=body.currency_code.upper().strip(),
        amount=_d(body.amount),
        tolerance_pct_plus=_d(body.tolerance_pct_plus) if body.tolerance_pct_plus is not None else None,
        tolerance_pct_minus=_d(body.tolerance_pct_minus) if body.tolerance_pct_minus is not None else None,
        incoterm=body.incoterm,
        partial_shipment_allowed=body.partial_shipment_allowed,
        transshipment_allowed=body.transshipment_allowed,
        latest_shipment_date=body.latest_shipment_date,
        expiry_date=body.expiry_date,
        presentation_period_days=body.presentation_period_days,
        goods_description=body.goods_description.strip(),
        goods_category=body.goods_category.strip(),
        hs_codes=body.hs_codes,
        bin_tin=body.bin_tin,
        irc_number=body.irc_number,
        erc_number=body.erc_number,
        feed_reg_license_ref=body.feed_reg_license_ref,
        bangladesh_bank_reporting_ref=body.bangladesh_bank_reporting_ref,
        bank_lodgment_reference=body.bank_lodgment_reference,
        insurers_cover_note=body.insurers_cover_note,
        margin_pct=_d(body.margin_pct) if body.margin_pct is not None else None,
        charges_account_party=body.charges_account_party,
        supplier_id=body.supplier_id,
        customer_id=body.customer_id,
        purchase_order_id=body.purchase_order_id,
        documents_required=docs,
        compliance_notes=body.compliance_notes,
        internal_notes=body.internal_notes,
        created_by=current_user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize_lc(row)


@router.get("/{lc_id}", response_model=LCDetailResponse)
async def get_lc(
    lc_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    row = db.query(LetterOfCredit).filter(LetterOfCredit.tenant_id == tenant_id, LetterOfCredit.id == lc_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Letter of credit not found")
    ams = (
        db.query(LCAmendment)
        .filter(LCAmendment.tenant_id == tenant_id, LCAmendment.lc_id == lc_id)
        .order_by(LCAmendment.amendment_no.asc())
        .all()
    )
    base = _serialize_lc(row)
    return LCDetailResponse(
        **base.model_dump(),
        amendments=[
            AmendmentResponse(
                id=a.id,
                lc_id=a.lc_id,
                amendment_no=a.amendment_no,
                effective_date=a.effective_date,
                summary=a.summary,
                detail=a.detail,
                amount_before=float(a.amount_before) if a.amount_before is not None else None,
                amount_after=float(a.amount_after) if a.amount_after is not None else None,
            )
            for a in ams
        ],
    )


@router.patch("/{lc_id}", response_model=LCResponse)
async def update_lc(
    lc_id: int,
    body: LCUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    row = db.query(LetterOfCredit).filter(LetterOfCredit.tenant_id == tenant_id, LetterOfCredit.id == lc_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Letter of credit not found")

    data = body.model_dump(exclude_unset=True)
    for key, val in data.items():
        if key == "amount" and val is not None:
            setattr(row, key, _d(val))
        elif key in ("tolerance_pct_plus", "tolerance_pct_minus", "margin_pct") and val is not None:
            setattr(row, key, _d(val))
        elif key == "currency_code" and val is not None:
            setattr(row, key, str(val).upper().strip())
        elif val is not None:
            setattr(row, key, val)

    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return _serialize_lc(row)


@router.post("/{lc_id}/status/{new_status}", response_model=LCResponse)
async def set_lc_status(
    lc_id: int,
    new_status: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    allowed = {
        "draft",
        "bank_review",
        "opened",
        "advised",
        "amended",
        "docs_in_review",
        "negotiated",
        "settled",
        "closed",
        "cancelled",
    }
    if new_status not in allowed:
        raise HTTPException(status_code=400, detail=f"Invalid status. Allowed: {sorted(allowed)}")
    row = db.query(LetterOfCredit).filter(LetterOfCredit.tenant_id == tenant_id, LetterOfCredit.id == lc_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Letter of credit not found")
    row.status = new_status
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return _serialize_lc(row)


@router.post("/{lc_id}/amendments", response_model=AmendmentResponse)
async def add_amendment(
    lc_id: int,
    body: AmendmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    lc = db.query(LetterOfCredit).filter(LetterOfCredit.tenant_id == tenant_id, LetterOfCredit.id == lc_id).first()
    if not lc:
        raise HTTPException(status_code=404, detail="Letter of credit not found")

    last_no = (
        db.query(LCAmendment)
        .filter(LCAmendment.lc_id == lc_id, LCAmendment.tenant_id == tenant_id)
        .order_by(LCAmendment.amendment_no.desc())
        .first()
    )
    next_no = (last_no.amendment_no + 1) if last_no else 1

    am = LCAmendment(
        tenant_id=tenant_id,
        lc_id=lc.id,
        amendment_no=next_no,
        effective_date=body.effective_date,
        summary=body.summary.strip(),
        detail=body.detail,
        amount_before=_d(body.amount_before) if body.amount_before is not None else None,
        amount_after=_d(body.amount_after) if body.amount_after is not None else None,
        created_by=current_user.id,
    )
    lc.status = "amended"
    lc.updated_at = datetime.utcnow()
    db.add(am)
    db.commit()
    db.refresh(am)
    return AmendmentResponse(
        id=am.id,
        lc_id=am.lc_id,
        amendment_no=am.amendment_no,
        effective_date=am.effective_date,
        summary=am.summary,
        detail=am.detail,
        amount_before=float(am.amount_before) if am.amount_before is not None else None,
        amount_after=float(am.amount_after) if am.amount_after is not None else None,
    )
