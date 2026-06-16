"""Purchase and sales requisitions — multi-level approval and downstream conversion."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import List, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from app.core.dependencies import get_current_user, get_db, get_tenant_id
from app.core.requisition_acl import (
    can_approve_executive,
    can_approve_purchase_dept,
    can_approve_sales_dept,
    can_reject_purchase,
    can_reject_sales,
    can_submit_purchase,
    can_submit_sales,
    user_role_slugs,
)
from app.modules.procurement.models import PurchaseOrder, PurchaseOrderLine
from app.modules.requisitions.models import (
    PurchaseRequisition,
    PurchaseRequisitionLine,
    RequisitionApprovalLog,
    SalesRequisition,
    SalesRequisitionLine,
)
from app.modules.sales.models import SalesInvoice, SalesInvoiceLine
from app.modules.tenancy.models import User
from app.shared.enums import DocumentStatus

router = APIRouter()

STATUS_DRAFT = "draft"
STATUS_PENDING_DEPT = "pending_dept_head"
STATUS_PENDING_EXEC = "pending_executive"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"


def _next_pr_number(db: Session, tenant_id: int) -> str:
    prefix = f"PR-{datetime.utcnow().strftime('%Y')}-"
    last = (
        db.query(PurchaseRequisition)
        .filter(PurchaseRequisition.tenant_id == tenant_id, PurchaseRequisition.doc_number.like(f"{prefix}%"))
        .order_by(PurchaseRequisition.id.desc())
        .first()
    )
    n = 1
    if last and last.doc_number:
        try:
            n = int(str(last.doc_number).split("-")[-1]) + 1
        except Exception:
            n = 1
    return f"{prefix}{n:05d}"


def _next_sr_number(db: Session, tenant_id: int) -> str:
    prefix = f"SR-{datetime.utcnow().strftime('%Y')}-"
    last = (
        db.query(SalesRequisition)
        .filter(SalesRequisition.tenant_id == tenant_id, SalesRequisition.doc_number.like(f"{prefix}%"))
        .order_by(SalesRequisition.id.desc())
        .first()
    )
    n = 1
    if last and last.doc_number:
        try:
            n = int(str(last.doc_number).split("-")[-1]) + 1
        except Exception:
            n = 1
    return f"{prefix}{n:05d}"


def _log(
    db: Session,
    tenant_id: int,
    kind: Literal["purchase", "sales"],
    requisition_id: int,
    action: str,
    actor_user_id: int,
    notes: str | None,
    created_by: int | None,
) -> None:
    db.add(
        RequisitionApprovalLog(
            tenant_id=tenant_id,
            requisition_kind=kind,
            requisition_id=requisition_id,
            action=action,
            notes=notes,
            actor_user_id=actor_user_id,
            created_by=created_by,
        )
    )


# ---------- Purchase ----------

class PRLineIn(BaseModel):
    item_id: int
    qty: float
    est_unit_price: float = 0


class PRCreate(BaseModel):
    supplier_id: int | None = None
    warehouse_id: int | None = None
    needed_by: datetime | None = None
    purpose: str | None = None
    lines: List[PRLineIn] = Field(default_factory=list)


class PRLineOut(BaseModel):
    id: int
    item_id: int
    qty: float
    est_unit_price: float

    class Config:
        from_attributes = True


class PRSummary(BaseModel):
    id: int
    doc_number: str
    supplier_id: int | None
    warehouse_id: int | None
    status: str
    needed_by: datetime | None
    purpose: str | None
    converted_po_id: int | None
    created_by: int | None

    class Config:
        from_attributes = True


class PRDetail(PRSummary):
    lines: List[PRLineOut] = []


class ApprovalNoteBody(BaseModel):
    notes: str | None = None


class ConvertPRBody(BaseModel):
    supplier_id: int | None = None
    order_date: datetime
    expected_date: datetime | None = None


@router.post("/purchase", response_model=PRSummary)
async def create_purchase_requisition(
    body: PRCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    if not body.lines:
        raise HTTPException(status_code=400, detail="Add at least one line item")
    pr = PurchaseRequisition(
        tenant_id=tenant_id,
        doc_number=_next_pr_number(db, tenant_id),
        supplier_id=body.supplier_id,
        warehouse_id=body.warehouse_id,
        needed_by=body.needed_by,
        purpose=body.purpose,
        status=STATUS_DRAFT,
        created_by=current_user.id,
    )
    db.add(pr)
    db.flush()
    for ln in body.lines:
        db.add(
            PurchaseRequisitionLine(
                tenant_id=tenant_id,
                pr_id=pr.id,
                item_id=ln.item_id,
                qty=Decimal(str(ln.qty)),
                est_unit_price=Decimal(str(ln.est_unit_price)),
                created_by=current_user.id,
            )
        )
    db.commit()
    db.refresh(pr)
    return pr


@router.get("/purchase", response_model=List[PRSummary])
async def list_purchase_requisitions(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    status: str | None = None,
):
    tenant_id = get_tenant_id(request)
    q = db.query(PurchaseRequisition).filter(PurchaseRequisition.tenant_id == tenant_id)
    if status:
        q = q.filter(PurchaseRequisition.status == status)
    return q.order_by(PurchaseRequisition.id.desc()).all()


@router.get("/purchase/{pr_id}", response_model=PRDetail)
async def get_purchase_requisition(
    pr_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    pr = (
        db.query(PurchaseRequisition)
        .options(joinedload(PurchaseRequisition.lines))
        .filter(PurchaseRequisition.tenant_id == tenant_id, PurchaseRequisition.id == pr_id)
        .first()
    )
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase requisition not found")
    return PRDetail(
        id=pr.id,
        doc_number=pr.doc_number,
        supplier_id=pr.supplier_id,
        warehouse_id=pr.warehouse_id,
        status=pr.status,
        needed_by=pr.needed_by,
        purpose=pr.purpose,
        converted_po_id=pr.converted_po_id,
        created_by=pr.created_by,
        lines=[PRLineOut.model_validate(x) for x in pr.lines],
    )


@router.put("/purchase/{pr_id}", response_model=PRDetail)
async def update_purchase_requisition(
    pr_id: int,
    body: PRCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    pr = db.query(PurchaseRequisition).filter(PurchaseRequisition.tenant_id == tenant_id, PurchaseRequisition.id == pr_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase requisition not found")
    if pr.status != STATUS_DRAFT:
        raise HTTPException(status_code=400, detail="Only draft requisitions can be edited")
    if not body.lines:
        raise HTTPException(status_code=400, detail="Add at least one line item")
    pr.supplier_id = body.supplier_id
    pr.warehouse_id = body.warehouse_id
    pr.needed_by = body.needed_by
    pr.purpose = body.purpose
    db.query(PurchaseRequisitionLine).filter(
        PurchaseRequisitionLine.tenant_id == tenant_id,
        PurchaseRequisitionLine.pr_id == pr_id,
    ).delete()
    for ln in body.lines:
        db.add(
            PurchaseRequisitionLine(
                tenant_id=tenant_id,
                pr_id=pr.id,
                item_id=ln.item_id,
                qty=Decimal(str(ln.qty)),
                est_unit_price=Decimal(str(ln.est_unit_price)),
                created_by=current_user.id,
            )
        )
    db.commit()
    return await get_purchase_requisition(pr_id, request, db, current_user)


@router.post("/purchase/{pr_id}/submit", response_model=PRSummary)
async def submit_purchase_requisition(
    pr_id: int,
    body: ApprovalNoteBody,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    slugs = user_role_slugs(db, current_user)
    pr = db.query(PurchaseRequisition).filter(PurchaseRequisition.tenant_id == tenant_id, PurchaseRequisition.id == pr_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase requisition not found")
    if pr.status != STATUS_DRAFT:
        raise HTTPException(status_code=400, detail="Only draft requisitions can be submitted")
    if not can_submit_purchase(slugs, current_user.id, pr.created_by):
        raise HTTPException(status_code=403, detail="Not allowed to submit this purchase requisition")
    lines = (
        db.query(PurchaseRequisitionLine)
        .filter(PurchaseRequisitionLine.tenant_id == tenant_id, PurchaseRequisitionLine.pr_id == pr_id)
        .all()
    )
    if not lines:
        raise HTTPException(status_code=400, detail="Requisition has no lines")
    pr.status = STATUS_PENDING_DEPT
    _log(db, tenant_id, "purchase", pr.id, "submit", current_user.id, body.notes, current_user.id)
    db.commit()
    db.refresh(pr)
    return pr


@router.post("/purchase/{pr_id}/approve", response_model=PRSummary)
async def approve_purchase_requisition(
    pr_id: int,
    body: ApprovalNoteBody,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    slugs = user_role_slugs(db, current_user)
    pr = db.query(PurchaseRequisition).filter(PurchaseRequisition.tenant_id == tenant_id, PurchaseRequisition.id == pr_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase requisition not found")
    if pr.status == STATUS_PENDING_DEPT:
        if not can_approve_purchase_dept(slugs):
            raise HTTPException(status_code=403, detail="Department head approval required (procurement head role)")
        pr.status = STATUS_PENDING_EXEC
        _log(db, tenant_id, "purchase", pr.id, "approve_dept", current_user.id, body.notes, current_user.id)
    elif pr.status == STATUS_PENDING_EXEC:
        if not can_approve_executive(slugs):
            raise HTTPException(
                status_code=403,
                detail="Executive approval required (General Manager, Head of Accounts, Managing Director, or similar role)",
            )
        pr.status = STATUS_APPROVED
        _log(db, tenant_id, "purchase", pr.id, "approve_exec", current_user.id, body.notes, current_user.id)
    else:
        raise HTTPException(status_code=400, detail="Requisition is not awaiting approval")
    db.commit()
    db.refresh(pr)
    return pr


@router.post("/purchase/{pr_id}/reject", response_model=PRSummary)
async def reject_purchase_requisition(
    pr_id: int,
    body: ApprovalNoteBody,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    slugs = user_role_slugs(db, current_user)
    pr = db.query(PurchaseRequisition).filter(PurchaseRequisition.tenant_id == tenant_id, PurchaseRequisition.id == pr_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase requisition not found")
    if pr.status not in (STATUS_PENDING_DEPT, STATUS_PENDING_EXEC):
        raise HTTPException(status_code=400, detail="Requisition is not pending approval")
    if not can_reject_purchase(slugs, pr.status):
        raise HTTPException(status_code=403, detail="Not allowed to reject at this stage")
    pr.status = STATUS_REJECTED
    _log(db, tenant_id, "purchase", pr.id, "reject", current_user.id, body.notes, current_user.id)
    db.commit()
    db.refresh(pr)
    return pr


@router.post("/purchase/{pr_id}/convert-po", response_model=dict)
async def convert_pr_to_po(
    pr_id: int,
    body: ConvertPRBody,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    pr = (
        db.query(PurchaseRequisition)
        .options(joinedload(PurchaseRequisition.lines))
        .filter(PurchaseRequisition.tenant_id == tenant_id, PurchaseRequisition.id == pr_id)
        .first()
    )
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase requisition not found")
    if pr.status != STATUS_APPROVED:
        raise HTTPException(status_code=400, detail="Requisition must be fully approved before creating a PO")
    if pr.converted_po_id:
        raise HTTPException(status_code=400, detail="A purchase order was already created from this requisition")
    supplier_id = body.supplier_id or pr.supplier_id
    if not supplier_id:
        raise HTTPException(status_code=400, detail="supplier_id is required on the requisition or in the request body")

    total = Decimal("0")
    po_lines_payload: list[dict] = []
    for line in pr.lines:
        lt = Decimal(str(line.qty)) * Decimal(str(line.est_unit_price))
        total += lt
        po_lines_payload.append(
            {
                "item_id": line.item_id,
                "qty": float(line.qty),
                "unit_price": float(line.est_unit_price),
            }
        )

    po_number = f"PO-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
    po = PurchaseOrder(
        tenant_id=tenant_id,
        po_number=po_number,
        supplier_id=supplier_id,
        source_purchase_requisition_id=pr.id,
        status=DocumentStatus.DRAFT,
        order_date=body.order_date,
        expected_date=body.expected_date,
        total_amount=total,
        created_by=current_user.id,
    )
    db.add(po)
    db.flush()
    for pl in po_lines_payload:
        line_total = Decimal(str(pl["qty"])) * Decimal(str(pl["unit_price"]))
        db.add(
            PurchaseOrderLine(
                tenant_id=tenant_id,
                po_id=po.id,
                item_id=pl["item_id"],
                qty=Decimal(str(pl["qty"])),
                qty_received=Decimal("0"),
                unit_price=Decimal(str(pl["unit_price"])),
                total=line_total,
                created_by=current_user.id,
            )
        )
    pr.converted_po_id = po.id
    db.commit()
    db.refresh(po)
    return {"purchase_order_id": po.id, "po_number": po.po_number}


# ---------- Sales ----------

class SRLineIn(BaseModel):
    item_id: int
    qty: float
    unit_price: float = 0


class SRCreate(BaseModel):
    customer_id: int
    requested_delivery: datetime | None = None
    purpose: str | None = None
    lines: List[SRLineIn] = Field(default_factory=list)


class SRLineOut(BaseModel):
    id: int
    item_id: int
    qty: float
    unit_price: float

    class Config:
        from_attributes = True


class SRSummary(BaseModel):
    id: int
    doc_number: str
    customer_id: int
    status: str
    requested_delivery: datetime | None
    purpose: str | None
    converted_invoice_id: int | None
    created_by: int | None

    class Config:
        from_attributes = True


class SRDetail(SRSummary):
    lines: List[SRLineOut] = []


class ConvertSRBody(BaseModel):
    invoice_date: str


@router.post("/sales", response_model=SRSummary)
async def create_sales_requisition(
    body: SRCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    if not body.lines:
        raise HTTPException(status_code=400, detail="Add at least one line item")
    sr = SalesRequisition(
        tenant_id=tenant_id,
        doc_number=_next_sr_number(db, tenant_id),
        customer_id=body.customer_id,
        requested_delivery=body.requested_delivery,
        purpose=body.purpose,
        status=STATUS_DRAFT,
        created_by=current_user.id,
    )
    db.add(sr)
    db.flush()
    for ln in body.lines:
        db.add(
            SalesRequisitionLine(
                tenant_id=tenant_id,
                sr_id=sr.id,
                item_id=ln.item_id,
                qty=Decimal(str(ln.qty)),
                unit_price=Decimal(str(ln.unit_price)),
                created_by=current_user.id,
            )
        )
    db.commit()
    db.refresh(sr)
    return sr


@router.get("/sales", response_model=List[SRSummary])
async def list_sales_requisitions(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    status: str | None = None,
):
    tenant_id = get_tenant_id(request)
    q = db.query(SalesRequisition).filter(SalesRequisition.tenant_id == tenant_id)
    if status:
        q = q.filter(SalesRequisition.status == status)
    return q.order_by(SalesRequisition.id.desc()).all()


@router.get("/sales/{sr_id}", response_model=SRDetail)
async def get_sales_requisition(
    sr_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    sr = (
        db.query(SalesRequisition)
        .options(joinedload(SalesRequisition.lines))
        .filter(SalesRequisition.tenant_id == tenant_id, SalesRequisition.id == sr_id)
        .first()
    )
    if not sr:
        raise HTTPException(status_code=404, detail="Sales requisition not found")
    return SRDetail(
        id=sr.id,
        doc_number=sr.doc_number,
        customer_id=sr.customer_id,
        status=sr.status,
        requested_delivery=sr.requested_delivery,
        purpose=sr.purpose,
        converted_invoice_id=sr.converted_invoice_id,
        created_by=sr.created_by,
        lines=[SRLineOut.model_validate(x) for x in sr.lines],
    )


@router.put("/sales/{sr_id}", response_model=SRDetail)
async def update_sales_requisition(
    sr_id: int,
    body: SRCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    sr = db.query(SalesRequisition).filter(SalesRequisition.tenant_id == tenant_id, SalesRequisition.id == sr_id).first()
    if not sr:
        raise HTTPException(status_code=404, detail="Sales requisition not found")
    if sr.status != STATUS_DRAFT:
        raise HTTPException(status_code=400, detail="Only draft requisitions can be edited")
    if not body.lines:
        raise HTTPException(status_code=400, detail="Add at least one line item")
    sr.customer_id = body.customer_id
    sr.requested_delivery = body.requested_delivery
    sr.purpose = body.purpose
    db.query(SalesRequisitionLine).filter(
        SalesRequisitionLine.tenant_id == tenant_id,
        SalesRequisitionLine.sr_id == sr_id,
    ).delete()
    for ln in body.lines:
        db.add(
            SalesRequisitionLine(
                tenant_id=tenant_id,
                sr_id=sr.id,
                item_id=ln.item_id,
                qty=Decimal(str(ln.qty)),
                unit_price=Decimal(str(ln.unit_price)),
                created_by=current_user.id,
            )
        )
    db.commit()
    return await get_sales_requisition(sr_id, request, db, current_user)


@router.post("/sales/{sr_id}/submit", response_model=SRSummary)
async def submit_sales_requisition(
    sr_id: int,
    body: ApprovalNoteBody,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    slugs = user_role_slugs(db, current_user)
    sr = db.query(SalesRequisition).filter(SalesRequisition.tenant_id == tenant_id, SalesRequisition.id == sr_id).first()
    if not sr:
        raise HTTPException(status_code=404, detail="Sales requisition not found")
    if sr.status != STATUS_DRAFT:
        raise HTTPException(status_code=400, detail="Only draft requisitions can be submitted")
    if not can_submit_sales(slugs, current_user.id, sr.created_by):
        raise HTTPException(status_code=403, detail="Not allowed to submit this sales requisition")
    lines = (
        db.query(SalesRequisitionLine)
        .filter(SalesRequisitionLine.tenant_id == tenant_id, SalesRequisitionLine.sr_id == sr_id)
        .all()
    )
    if not lines:
        raise HTTPException(status_code=400, detail="Requisition has no lines")
    sr.status = STATUS_PENDING_DEPT
    _log(db, tenant_id, "sales", sr.id, "submit", current_user.id, body.notes, current_user.id)
    db.commit()
    db.refresh(sr)
    return sr


@router.post("/sales/{sr_id}/approve", response_model=SRSummary)
async def approve_sales_requisition(
    sr_id: int,
    body: ApprovalNoteBody,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    slugs = user_role_slugs(db, current_user)
    sr = db.query(SalesRequisition).filter(SalesRequisition.tenant_id == tenant_id, SalesRequisition.id == sr_id).first()
    if not sr:
        raise HTTPException(status_code=404, detail="Sales requisition not found")
    if sr.status == STATUS_PENDING_DEPT:
        if not can_approve_sales_dept(slugs):
            raise HTTPException(status_code=403, detail="Department head approval required (sales head role)")
        sr.status = STATUS_PENDING_EXEC
        _log(db, tenant_id, "sales", sr.id, "approve_dept", current_user.id, body.notes, current_user.id)
    elif sr.status == STATUS_PENDING_EXEC:
        if not can_approve_executive(slugs):
            raise HTTPException(
                status_code=403,
                detail="Executive approval required (General Manager, Head of Accounts, Managing Director, or similar role)",
            )
        sr.status = STATUS_APPROVED
        _log(db, tenant_id, "sales", sr.id, "approve_exec", current_user.id, body.notes, current_user.id)
    else:
        raise HTTPException(status_code=400, detail="Requisition is not awaiting approval")
    db.commit()
    db.refresh(sr)
    return sr


@router.post("/sales/{sr_id}/reject", response_model=SRSummary)
async def reject_sales_requisition(
    sr_id: int,
    body: ApprovalNoteBody,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    slugs = user_role_slugs(db, current_user)
    sr = db.query(SalesRequisition).filter(SalesRequisition.tenant_id == tenant_id, SalesRequisition.id == sr_id).first()
    if not sr:
        raise HTTPException(status_code=404, detail="Sales requisition not found")
    if sr.status not in (STATUS_PENDING_DEPT, STATUS_PENDING_EXEC):
        raise HTTPException(status_code=400, detail="Requisition is not pending approval")
    if not can_reject_sales(slugs, sr.status):
        raise HTTPException(status_code=403, detail="Not allowed to reject at this stage")
    sr.status = STATUS_REJECTED
    _log(db, tenant_id, "sales", sr.id, "reject", current_user.id, body.notes, current_user.id)
    db.commit()
    db.refresh(sr)
    return sr


@router.post("/sales/{sr_id}/convert-invoice", response_model=dict)
async def convert_sr_to_draft_invoice(
    sr_id: int,
    body: ConvertSRBody,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    sr = (
        db.query(SalesRequisition)
        .options(joinedload(SalesRequisition.lines))
        .filter(SalesRequisition.tenant_id == tenant_id, SalesRequisition.id == sr_id)
        .first()
    )
    if not sr:
        raise HTTPException(status_code=404, detail="Sales requisition not found")
    if sr.status != STATUS_APPROVED:
        raise HTTPException(status_code=400, detail="Requisition must be fully approved before creating an invoice")
    if sr.converted_invoice_id:
        raise HTTPException(status_code=400, detail="A sales invoice was already created from this requisition")

    invoice_date = datetime.fromisoformat(body.invoice_date) if isinstance(body.invoice_date, str) else body.invoice_date
    total = Decimal("0")
    for line in sr.lines:
        total += Decimal(str(line.qty)) * Decimal(str(line.unit_price))

    invoice_number = f"INV-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
    inv = SalesInvoice(
        tenant_id=tenant_id,
        invoice_number=invoice_number,
        customer_id=sr.customer_id,
        source_sales_requisition_id=sr.id,
        status=DocumentStatus.DRAFT,
        invoice_date=invoice_date,
        total_amount=total,
        created_by=current_user.id,
    )
    db.add(inv)
    db.flush()
    for line in sr.lines:
        qty = Decimal(str(line.qty))
        unit_price = Decimal(str(line.unit_price))
        db.add(
            SalesInvoiceLine(
                tenant_id=tenant_id,
                invoice_id=inv.id,
                item_id=line.item_id,
                qty=qty,
                unit_price=unit_price,
                total=qty * unit_price,
                warehouse_id=None,
                created_by=current_user.id,
            )
        )
    sr.converted_invoice_id = inv.id
    db.commit()
    db.refresh(inv)
    return {"invoice_id": inv.id, "invoice_number": inv.invoice_number, "status": inv.status}


# ---------- Shared ----------

class ApprovalLogOut(BaseModel):
    id: int
    action: str
    notes: str | None
    actor_user_id: int
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("/purchase/{pr_id}/approval-log", response_model=List[ApprovalLogOut])
async def purchase_approval_log(
    pr_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    pr = db.query(PurchaseRequisition).filter(PurchaseRequisition.tenant_id == tenant_id, PurchaseRequisition.id == pr_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase requisition not found")
    rows = (
        db.query(RequisitionApprovalLog)
        .filter(
            RequisitionApprovalLog.tenant_id == tenant_id,
            RequisitionApprovalLog.requisition_kind == "purchase",
            RequisitionApprovalLog.requisition_id == pr_id,
        )
        .order_by(RequisitionApprovalLog.id.asc())
        .all()
    )
    return rows


@router.get("/sales/{sr_id}/approval-log", response_model=List[ApprovalLogOut])
async def sales_approval_log(
    sr_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    sr = db.query(SalesRequisition).filter(SalesRequisition.tenant_id == tenant_id, SalesRequisition.id == sr_id).first()
    if not sr:
        raise HTTPException(status_code=404, detail="Sales requisition not found")
    rows = (
        db.query(RequisitionApprovalLog)
        .filter(
            RequisitionApprovalLog.tenant_id == tenant_id,
            RequisitionApprovalLog.requisition_kind == "sales",
            RequisitionApprovalLog.requisition_id == sr_id,
        )
        .order_by(RequisitionApprovalLog.id.asc())
        .all()
    )
    return rows


class InboxOut(BaseModel):
    purchase_pending_dept: List[PRSummary]
    purchase_pending_exec: List[PRSummary]
    sales_pending_dept: List[SRSummary]
    sales_pending_exec: List[SRSummary]
    my_drafts_purchase: List[PRSummary]
    my_drafts_sales: List[SRSummary]


@router.get("/inbox", response_model=InboxOut)
async def requisitions_inbox(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = get_tenant_id(request)
    slugs = user_role_slugs(db, current_user)

    pr_base = db.query(PurchaseRequisition).filter(PurchaseRequisition.tenant_id == tenant_id)
    sr_base = db.query(SalesRequisition).filter(SalesRequisition.tenant_id == tenant_id)

    pr_dept: List[PurchaseRequisition] = []
    pr_exec: List[PurchaseRequisition] = []
    if can_approve_purchase_dept(slugs):
        pr_dept = pr_base.filter(PurchaseRequisition.status == STATUS_PENDING_DEPT).order_by(PurchaseRequisition.id.desc()).limit(100).all()
    if can_approve_executive(slugs):
        pr_exec = pr_base.filter(PurchaseRequisition.status == STATUS_PENDING_EXEC).order_by(PurchaseRequisition.id.desc()).limit(100).all()

    sr_dept: List[SalesRequisition] = []
    sr_exec: List[SalesRequisition] = []
    if can_approve_sales_dept(slugs):
        sr_dept = sr_base.filter(SalesRequisition.status == STATUS_PENDING_DEPT).order_by(SalesRequisition.id.desc()).limit(100).all()
    if can_approve_executive(slugs):
        sr_exec = sr_base.filter(SalesRequisition.status == STATUS_PENDING_EXEC).order_by(SalesRequisition.id.desc()).limit(100).all()

    my_pr = pr_base.filter(PurchaseRequisition.status == STATUS_DRAFT, PurchaseRequisition.created_by == current_user.id).all()
    my_sr = sr_base.filter(SalesRequisition.status == STATUS_DRAFT, SalesRequisition.created_by == current_user.id).all()

    return InboxOut(
        purchase_pending_dept=pr_dept,
        purchase_pending_exec=pr_exec,
        sales_pending_dept=sr_dept,
        sales_pending_exec=sr_exec,
        my_drafts_purchase=my_pr,
        my_drafts_sales=my_sr,
    )
