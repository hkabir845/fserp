"""
Operational reporting: inventory truth (warehouse + silo), production commitment,
sales velocity for procurement / scheduling hints. Complements accounting_reports (GL).
"""
from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import asc, case, desc, func
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user, get_db, require_tenant_id
from app.modules.catalog.models import Item
from app.modules.feed_manufacturing.models import (
    Ingredient,
    ProductionOrder,
    ProductionOrderLine,
    ProductionStatus,
    Silo,
)
from app.modules.inventory.models import StockLedger, Warehouse
from app.modules.inventory.stock_service import StockService
from app.modules.sales.models import SalesInvoice, SalesInvoiceLine
from app.modules.tenancy.models import User
from app.modules.reports.models import CustomReport

router = APIRouter()

_COMMIT_STATUSES = (ProductionStatus.PLANNED.value, ProductionStatus.IN_PROGRESS.value)
_CUSTOM_REPORT_SOURCES = {
    "stock_observability",
    "production_pipeline",
    "sales_velocity",
    "demand_vs_cover",
    "silo_reorder_alerts",
}


def _ledger_by_wh(db: Session, tenant_id: int) -> Dict[Tuple[int, int], Decimal]:
    rows = (
        db.query(
            StockLedger.item_id,
            StockLedger.warehouse_id,
            func.coalesce(func.sum(StockLedger.qty_in - StockLedger.qty_out), 0),
        )
        .filter(StockLedger.tenant_id == tenant_id)
        .group_by(StockLedger.item_id, StockLedger.warehouse_id)
        .all()
    )
    out: Dict[Tuple[int, int], Decimal] = {}
    for item_id, wh_id, bal in rows:
        d = Decimal(str(bal or 0))
        if d != 0:
            out[(int(item_id), int(wh_id))] = d
    return out


def _silo_bulk_by_wh(db: Session, tenant_id: int) -> Dict[Tuple[int, int], Decimal]:
    rows = (
        db.query(
            Silo.item_id,
            Silo.warehouse_id,
            func.coalesce(func.sum(Silo.current_qty_kg), 0),
        )
        .filter(Silo.tenant_id == tenant_id, Silo.is_active == True)
        .group_by(Silo.item_id, Silo.warehouse_id)
        .all()
    )
    return {(int(i), int(w)): Decimal(str(s or 0)) for i, w, s in rows}


def _committed_remaining_by_wh(db: Session, tenant_id: int) -> Dict[Tuple[int, int], Decimal]:
    rem_expr = ProductionOrderLine.required_qty_with_loss_kg - func.coalesce(
        ProductionOrderLine.consumed_qty_kg, 0
    )
    pos_rem = case((rem_expr > 0, rem_expr), else_=0)
    rows = (
        db.query(
            Ingredient.item_id,
            ProductionOrder.warehouse_id,
            func.coalesce(func.sum(pos_rem), 0),
        )
        .select_from(ProductionOrderLine)
        .join(ProductionOrder, ProductionOrderLine.order_id == ProductionOrder.id)
        .join(Ingredient, ProductionOrderLine.ingredient_id == Ingredient.id)
        .filter(
            ProductionOrder.tenant_id == tenant_id,
            ProductionOrder.status.in_(_COMMIT_STATUSES),
        )
        .group_by(Ingredient.item_id, ProductionOrder.warehouse_id)
        .all()
    )
    return {(int(i), int(w)): Decimal(str(s or 0)) for i, w, s in rows}


class StockObservabilityRow(BaseModel):
    item_id: int
    item_name: str
    item_type: str
    warehouse_id: int
    warehouse_name: str
    warehouse_ledger_qty: float = Field(..., description="Stock ledger on-hand for this warehouse")
    silo_bulk_kg: float = Field(0, description="Sum of active silo levels for this item in this warehouse")
    committed_remaining_kg: float = Field(
        0,
        description="Unconsumed requirement on planned/in-progress feed production at this warehouse",
    )
    physical_bulk_kg: float = Field(
        ...,
        description="warehouse_ledger_qty + silo_bulk_kg (silo bulk is often the same economic stock as conveyors)",
    )
    available_after_commit_kg: float = Field(
        ...,
        description="physical_bulk_kg - committed_remaining_kg (negative means shortage vs firm orders)",
    )


@router.get("/stock-observability", response_model=List[StockObservabilityRow])
async def stock_observability(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    warehouse_id: Optional[int] = Query(None, description="Limit to one warehouse"),
):
    """
    True observability for bulk ingredients: warehouse ledger + silo levels, minus
    remaining ingredient need on planned / in-progress production orders.
    """
    warehouses = (
        db.query(Warehouse)
        .filter(Warehouse.tenant_id == tenant_id, Warehouse.is_active == True)
        .order_by(Warehouse.name)
        .all()
    )
    if warehouse_id is not None:
        warehouses = [w for w in warehouses if w.id == warehouse_id]
        if not warehouses:
            return []

    items = (
        db.query(Item)
        .filter(Item.tenant_id == tenant_id, Item.is_active == True, Item.is_stock_tracked == True)
        .order_by(Item.name)
        .all()
    )
    items = [i for i in items if getattr(i, "type", None) != "fuel"]

    ledger = _ledger_by_wh(db, tenant_id)
    silo_map = _silo_bulk_by_wh(db, tenant_id)
    commit_map = _committed_remaining_by_wh(db, tenant_id)

    keys: set[Tuple[int, int]] = set()
    keys.update(ledger.keys())
    keys.update(silo_map.keys())
    keys.update(commit_map.keys())

    for wh in warehouses:
        for it in items:
            if (it.id, wh.id) in keys:
                continue
            st = StockService.get_current_stock(db, tenant_id, it.id, wh.id)
            if st and Decimal(str(st)) != 0:
                keys.add((it.id, wh.id))

    item_by_id = {i.id: i for i in items}
    wh_by_id = {w.id: w for w in warehouses}

    rows: List[StockObservabilityRow] = []
    for item_id, wh_id in sorted(keys):
        it = item_by_id.get(item_id)
        wh = wh_by_id.get(wh_id)
        if not it or not wh:
            continue
        wqty = ledger.get((item_id, wh_id), Decimal("0"))
        if wqty == 0 and (item_id, wh_id) not in silo_map and (item_id, wh_id) not in commit_map:
            st = StockService.get_current_stock(db, tenant_id, item_id, wh_id)
            wqty = Decimal(str(st or 0))
        skg = silo_map.get((item_id, wh_id), Decimal("0"))
        ckg = commit_map.get((item_id, wh_id), Decimal("0"))
        physical = wqty + skg
        avail = physical - ckg
        if wqty == 0 and skg == 0 and ckg == 0:
            continue
        rows.append(
            StockObservabilityRow(
                item_id=item_id,
                item_name=it.name,
                item_type=it.type or "",
                warehouse_id=wh_id,
                warehouse_name=wh.name,
                warehouse_ledger_qty=float(wqty),
                silo_bulk_kg=float(skg),
                committed_remaining_kg=float(ckg),
                physical_bulk_kg=float(physical),
                available_after_commit_kg=float(avail),
            )
        )
    rows.sort(key=lambda r: (r.warehouse_name, r.item_name))
    return rows


class ProductionPipelineSummary(BaseModel):
    status: str
    count: int


class UpcomingProductionOrder(BaseModel):
    id: int
    order_number: str
    status: str
    planned_date: Optional[str]
    warehouse_id: int
    batch_size_kg: float
    planned_output_kg: float


class ProductionPipelineReport(BaseModel):
    by_status: List[ProductionPipelineSummary]
    upcoming: List[UpcomingProductionOrder]


@router.get("/production-pipeline", response_model=ProductionPipelineReport)
async def production_pipeline(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    upcoming_limit: int = Query(15, ge=1, le=100),
):
    """Counts by production order status plus next planned batches for scheduling."""
    status_counts = (
        db.query(ProductionOrder.status, func.count(ProductionOrder.id))
        .filter(ProductionOrder.tenant_id == tenant_id)
        .group_by(ProductionOrder.status)
        .all()
    )
    by_status = [ProductionPipelineSummary(status=s, count=int(c)) for s, c in status_counts]

    upcoming_rows = (
        db.query(ProductionOrder)
        .filter(
            ProductionOrder.tenant_id == tenant_id,
            ProductionOrder.status.in_(
                (ProductionStatus.DRAFT.value, ProductionStatus.PLANNED.value, ProductionStatus.IN_PROGRESS.value)
            ),
        )
        .order_by(asc(ProductionOrder.planned_date).nullslast(), ProductionOrder.id.asc())
        .limit(upcoming_limit)
        .all()
    )
    upcoming: List[UpcomingProductionOrder] = []
    for o in upcoming_rows:
        upcoming.append(
            UpcomingProductionOrder(
                id=o.id,
                order_number=o.order_number,
                status=o.status,
                planned_date=o.planned_date.isoformat() if o.planned_date else None,
                warehouse_id=o.warehouse_id,
                batch_size_kg=float(o.batch_size_kg or 0),
                planned_output_kg=float(o.planned_output_kg or 0),
            )
        )
    return ProductionPipelineReport(by_status=by_status, upcoming=upcoming)


class SalesVelocityRow(BaseModel):
    item_id: int
    item_name: str
    qty_sold: float
    period_days: int
    avg_daily_qty: float


def _compute_sales_velocity(db: Session, tenant_id: int, days: int) -> List[SalesVelocityRow]:
    """Posted sales invoice lines in the window — baseline for demand / forecast views."""
    since = datetime.utcnow() - timedelta(days=days)
    q = (
        db.query(
            SalesInvoiceLine.item_id,
            func.coalesce(func.sum(SalesInvoiceLine.qty), 0),
        )
        .join(SalesInvoice, SalesInvoiceLine.invoice_id == SalesInvoice.id)
        .filter(
            SalesInvoice.tenant_id == tenant_id,
            SalesInvoice.status == "posted",
            SalesInvoice.invoice_date >= since,
        )
        .group_by(SalesInvoiceLine.item_id)
    )
    sums = {int(i): Decimal(str(qty or 0)) for i, qty in q.all()}
    if not sums:
        return []

    item_rows = db.query(Item).filter(Item.tenant_id == tenant_id, Item.id.in_(sums.keys())).all()
    name_by_id = {i.id: i.name for i in item_rows}
    out: List[SalesVelocityRow] = []
    for item_id, qty in sorted(sums.items(), key=lambda x: -float(x[1])):
        qf = float(qty)
        avg = qf / float(days) if days else 0.0
        out.append(
            SalesVelocityRow(
                item_id=item_id,
                item_name=name_by_id.get(item_id, f"Item #{item_id}"),
                qty_sold=qf,
                period_days=days,
                avg_daily_qty=avg,
            )
        )
    return out


@router.get("/sales-velocity", response_model=List[SalesVelocityRow])
async def sales_velocity(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    days: int = Query(90, ge=7, le=365),
):
    return _compute_sales_velocity(db, tenant_id, days)


class DemandCoverRow(BaseModel):
    item_id: int
    item_name: str
    qty_sold_period: float
    period_days: int
    avg_daily_qty: float
    naive_forecast_qty: float = Field(description="avg_daily_qty × forecast horizon (same UOM as sales qty)")
    total_on_hand_qty: float
    cover_days: Optional[float] = Field(
        None, description="total_on_hand / avg_daily when avg_daily > 0; else null"
    )


@router.get("/demand-vs-cover", response_model=List[DemandCoverRow])
async def demand_vs_cover(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
    velocity_days: int = Query(90, ge=7, le=365),
    forecast_horizon_days: int = Query(30, ge=7, le=180),
):
    """
    Naive S&OP hint: scale recent posted sales to a horizon and compare to total on-hand
    (all warehouses: ledger + silo). Does not yet subtract open SO / requisitions — extend when those exist.
    """
    velocity = _compute_sales_velocity(db, tenant_id, velocity_days)
    if not velocity:
        return []

    ledger = _ledger_by_wh(db, tenant_id)
    silo_item = (
        db.query(Silo.item_id, func.coalesce(func.sum(Silo.current_qty_kg), 0))
        .filter(Silo.tenant_id == tenant_id, Silo.is_active == True)
        .group_by(Silo.item_id)
        .all()
    )
    silo_by_item = {int(i): Decimal(str(s or 0)) for i, s in silo_item}

    wh_qty_by_item: Dict[int, Decimal] = {}
    for (item_id, _wh_id), bal in ledger.items():
        wh_qty_by_item[item_id] = wh_qty_by_item.get(item_id, Decimal("0")) + Decimal(str(bal))

    rows: List[DemandCoverRow] = []
    for v in velocity:
        total = wh_qty_by_item.get(v.item_id, Decimal("0")) + silo_by_item.get(v.item_id, Decimal("0"))
        naive = v.avg_daily_qty * float(forecast_horizon_days)
        cd: Optional[float] = None
        if v.avg_daily_qty > 0:
            cd = float(total) / v.avg_daily_qty
        rows.append(
            DemandCoverRow(
                item_id=v.item_id,
                item_name=v.item_name,
                qty_sold_period=v.qty_sold,
                period_days=v.period_days,
                avg_daily_qty=v.avg_daily_qty,
                naive_forecast_qty=naive,
                total_on_hand_qty=float(total),
                cover_days=cd,
            )
        )
    rows.sort(key=lambda r: (r.cover_days is None, r.cover_days or 999999))
    return rows


class SiloReorderAlertRow(BaseModel):
    silo_id: int
    name: str
    code: Optional[str]
    warehouse_id: int
    item_id: int
    item_name: str
    current_qty_kg: float
    reorder_min_kg: Optional[float]
    capacity_kg: Optional[float]


@router.get("/silo-reorder-alerts", response_model=List[SiloReorderAlertRow])
async def silo_reorder_alerts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    """Silos at or below reorder_min_kg (when min is set)."""
    silos = (
        db.query(Silo)
        .filter(Silo.tenant_id == tenant_id, Silo.is_active == True, Silo.reorder_min_kg != None)
        .all()
    )
    item_ids = list({s.item_id for s in silos})
    names = {}
    if item_ids:
        for it in db.query(Item).filter(Item.tenant_id == tenant_id, Item.id.in_(item_ids)).all():
            names[it.id] = it.name
    out: List[SiloReorderAlertRow] = []
    for s in silos:
        cur = Decimal(str(s.current_qty_kg or 0))
        mn = Decimal(str(s.reorder_min_kg or 0))
        if cur > mn:
            continue
        out.append(
            SiloReorderAlertRow(
                silo_id=s.id,
                name=s.name,
                code=s.code,
                warehouse_id=s.warehouse_id,
                item_id=s.item_id,
                item_name=names.get(s.item_id, ""),
                current_qty_kg=float(cur),
                reorder_min_kg=float(mn),
                capacity_kg=float(s.capacity_kg) if s.capacity_kg is not None else None,
            )
        )
    out.sort(key=lambda r: (r.warehouse_id, r.name))
    return out


class ReportCatalogItem(BaseModel):
    key: str
    name: str
    description: str
    source: str
    endpoint: str
    default_params: Dict[str, object] = Field(default_factory=dict)


@router.get("/catalog", response_model=List[ReportCatalogItem])
async def report_catalog(
    current_user: User = Depends(get_current_user),
):
    return [
        ReportCatalogItem(
            key="inventory_observability",
            name="Inventory observability",
            description="Ledger + silo + production commitments by warehouse and item",
            source="stock_observability",
            endpoint="/api/v1/reports/stock-observability",
            default_params={},
        ),
        ReportCatalogItem(
            key="production_pipeline",
            name="Production pipeline",
            description="Production status counts and upcoming planned batches",
            source="production_pipeline",
            endpoint="/api/v1/reports/production-pipeline",
            default_params={"upcoming_limit": 15},
        ),
        ReportCatalogItem(
            key="sales_velocity_90d",
            name="Sales velocity (90d)",
            description="Posted sales quantities and average daily demand",
            source="sales_velocity",
            endpoint="/api/v1/reports/sales-velocity",
            default_params={"days": 90},
        ),
        ReportCatalogItem(
            key="demand_vs_cover_30d",
            name="Demand vs cover",
            description="Naive demand forecast against current stock cover",
            source="demand_vs_cover",
            endpoint="/api/v1/reports/demand-vs-cover",
            default_params={"velocity_days": 90, "forecast_horizon_days": 30},
        ),
        ReportCatalogItem(
            key="silo_reorder_alerts",
            name="Silo reorder alerts",
            description="Silos at or below configured reorder minimum",
            source="silo_reorder_alerts",
            endpoint="/api/v1/reports/silo-reorder-alerts",
            default_params={},
        ),
    ]


class CustomReportConfig(BaseModel):
    days: Optional[int] = Field(None, ge=7, le=365)
    warehouse_id: Optional[int] = Field(None, ge=1)
    velocity_days: Optional[int] = Field(None, ge=7, le=365)
    forecast_horizon_days: Optional[int] = Field(None, ge=7, le=180)
    upcoming_limit: Optional[int] = Field(None, ge=1, le=100)


class CustomReportCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    source: str
    is_shared: bool = False
    config: CustomReportConfig = Field(default_factory=CustomReportConfig)


class CustomReportUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    source: Optional[str] = None
    is_shared: Optional[bool] = None
    config: Optional[CustomReportConfig] = None


class CustomReportOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    source: str
    is_shared: bool
    config: Dict[str, object]
    created_by: int
    created_at: datetime
    updated_at: datetime


def _normalize_source(source: str) -> str:
    out = (source or "").strip().lower()
    if out not in _CUSTOM_REPORT_SOURCES:
        raise HTTPException(status_code=400, detail="Unsupported report source")
    return out


def _clean_config(cfg: CustomReportConfig) -> Dict[str, object]:
    return cfg.model_dump(exclude_none=True)


def _to_custom_report_out(r: CustomReport) -> CustomReportOut:
    return CustomReportOut(
        id=r.id,
        name=r.name,
        description=r.description,
        source=r.source,
        is_shared=bool(r.is_shared),
        config=r.config or {},
        created_by=r.created_by,
        created_at=r.created_at,
        updated_at=r.updated_at,
    )


async def _run_custom_source(
    source: str,
    config: Dict[str, object],
    db: Session,
    current_user: User,
    tenant_id: int,
):
    if source == "stock_observability":
        return await stock_observability(
            db=db,
            current_user=current_user,
            tenant_id=tenant_id,
            warehouse_id=config.get("warehouse_id"),
        )
    if source == "production_pipeline":
        return await production_pipeline(
            db=db,
            current_user=current_user,
            tenant_id=tenant_id,
            upcoming_limit=int(config.get("upcoming_limit", 15)),
        )
    if source == "sales_velocity":
        return await sales_velocity(
            db=db,
            current_user=current_user,
            tenant_id=tenant_id,
            days=int(config.get("days", 90)),
        )
    if source == "demand_vs_cover":
        return await demand_vs_cover(
            db=db,
            current_user=current_user,
            tenant_id=tenant_id,
            velocity_days=int(config.get("velocity_days", 90)),
            forecast_horizon_days=int(config.get("forecast_horizon_days", 30)),
        )
    if source == "silo_reorder_alerts":
        return await silo_reorder_alerts(
            db=db,
            current_user=current_user,
            tenant_id=tenant_id,
        )
    raise HTTPException(status_code=400, detail="Unsupported report source")


@router.get("/custom-definitions", response_model=List[CustomReportOut])
async def list_custom_reports(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    rows = (
        db.query(CustomReport)
        .filter(
            CustomReport.tenant_id == tenant_id,
            (CustomReport.created_by == current_user.id) | (CustomReport.is_shared == True),
        )
        .order_by(desc(CustomReport.updated_at), desc(CustomReport.id))
        .all()
    )
    return [_to_custom_report_out(r) for r in rows]


@router.post("/custom-definitions", response_model=CustomReportOut)
async def create_custom_report(
    payload: CustomReportCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    source = _normalize_source(payload.source)
    row = CustomReport(
        tenant_id=tenant_id,
        created_by=current_user.id,
        name=payload.name.strip(),
        description=(payload.description or "").strip() or None,
        source=source,
        config=_clean_config(payload.config),
        is_shared=bool(payload.is_shared),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_custom_report_out(row)


@router.put("/custom-definitions/{report_id}", response_model=CustomReportOut)
async def update_custom_report(
    report_id: int,
    payload: CustomReportUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    row = (
        db.query(CustomReport)
        .filter(CustomReport.id == report_id, CustomReport.tenant_id == tenant_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    if row.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Only creator can edit this report")

    if payload.name is not None:
        row.name = payload.name.strip()
    if payload.description is not None:
        row.description = payload.description.strip() or None
    if payload.source is not None:
        row.source = _normalize_source(payload.source)
    if payload.config is not None:
        row.config = _clean_config(payload.config)
    if payload.is_shared is not None:
        row.is_shared = bool(payload.is_shared)

    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_custom_report_out(row)


@router.delete("/custom-definitions/{report_id}")
async def delete_custom_report(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    row = (
        db.query(CustomReport)
        .filter(CustomReport.id == report_id, CustomReport.tenant_id == tenant_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    if row.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Only creator can delete this report")

    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/custom-preview")
async def preview_custom_report(
    payload: CustomReportCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    source = _normalize_source(payload.source)
    config = _clean_config(payload.config)
    data = await _run_custom_source(source, config, db=db, current_user=current_user, tenant_id=tenant_id)
    return {"source": source, "config": config, "data": data}


@router.get("/custom-definitions/{report_id}/run")
async def run_custom_report(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: int = Depends(require_tenant_id),
):
    row = (
        db.query(CustomReport)
        .filter(
            CustomReport.id == report_id,
            CustomReport.tenant_id == tenant_id,
            (CustomReport.created_by == current_user.id) | (CustomReport.is_shared == True),
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")

    data = await _run_custom_source(
        row.source,
        row.config or {},
        db=db,
        current_user=current_user,
        tenant_id=tenant_id,
    )
    return {"report_id": row.id, "name": row.name, "source": row.source, "config": row.config or {}, "data": data}
