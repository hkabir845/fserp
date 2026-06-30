"""
Reverse production order stock effects (material issue, completion, legacy one-step post).

Pattern matches inventory transfer unpost: restore raw materials, remove finished goods
from warehouse when still on hand, reset order to draft.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session, joinedload

from app.modules.catalog.models import Item
from app.modules.feed_manufacturing.models import (
    FeedBom,
    FeedProduct,
    Ingredient,
    ProductionOrder,
    ProductionOrderLine,
    ProductionStatus,
)
from app.modules.feed_manufacturing.silo_service import SiloService
from app.modules.inventory.models import StockBalance, StockLedger
from app.modules.inventory.stock_service import StockService


class ProductionRollbackError(Exception):
    def __init__(self, detail: str):
        self.detail = detail
        super().__init__(detail)


def _order_ledger_ref_types(db: Session, tenant_id: int, order_id: int) -> set[str]:
    rows = (
        db.query(StockLedger.ref_type)
        .filter(StockLedger.tenant_id == tenant_id, StockLedger.ref_id == order_id)
        .distinct()
        .all()
    )
    return {r[0] for r in rows if r[0]}


def _has_packing_issue(db: Session, tenant_id: int, order_id: int) -> bool:
    return (
        db.query(StockLedger.id)
        .filter(
            StockLedger.tenant_id == tenant_id,
            StockLedger.ref_id == order_id,
            StockLedger.ref_type == "packing_issue",
        )
        .first()
        is not None
    )


def _get_balance(
    db: Session, tenant_id: int, item_id: int, warehouse_id: int
) -> Optional[StockBalance]:
    return (
        db.query(StockBalance)
        .filter(
            StockBalance.tenant_id == tenant_id,
            StockBalance.item_id == item_id,
            StockBalance.warehouse_id == warehouse_id,
            StockBalance.lot_id.is_(None),
        )
        .first()
    )


def _apply_balance_increase(
    db: Session,
    tenant_id: int,
    item_id: int,
    warehouse_id: int,
    qty_kg: Decimal,
    unit_cost: Decimal,
    user_id: Optional[int],
) -> None:
    total_cost = (qty_kg * unit_cost).quantize(Decimal("0.01"))
    balance = _get_balance(db, tenant_id, item_id, warehouse_id)
    if balance:
        new_qty = Decimal(str(balance.qty_kg)) + qty_kg
        new_total = Decimal(str(balance.total_cost)) + total_cost
        balance.qty_kg = new_qty
        balance.total_cost = new_total
        balance.unit_cost = (
            (new_total / new_qty).quantize(Decimal("0.0001")) if new_qty > 0 else Decimal("0")
        )
        balance.last_txn_date = datetime.utcnow()
    else:
        db.add(
            StockBalance(
                tenant_id=tenant_id,
                item_id=item_id,
                warehouse_id=warehouse_id,
                lot_id=None,
                qty_kg=qty_kg,
                unit_cost=unit_cost,
                total_cost=total_cost,
                last_txn_date=datetime.utcnow(),
                created_by=user_id,
            )
        )


def _apply_balance_decrease(
    db: Session,
    tenant_id: int,
    item_id: int,
    warehouse_id: int,
    qty_kg: Decimal,
    label: str,
) -> Decimal:
    balance = _get_balance(db, tenant_id, item_id, warehouse_id)
    if not balance or Decimal(str(balance.qty_kg)) < qty_kg:
        avail = Decimal(str(balance.qty_kg)) if balance else Decimal("0")
        raise ProductionRollbackError(
            f"Cannot rollback {label}: insufficient warehouse stock "
            f"(need {qty_kg} kg, have {avail} kg)."
        )
    unit_cost = Decimal(str(balance.unit_cost))
    total_cost = (qty_kg * unit_cost).quantize(Decimal("0.01"))
    new_qty = Decimal(str(balance.qty_kg)) - qty_kg
    new_total = Decimal(str(balance.total_cost)) - total_cost
    balance.qty_kg = new_qty
    balance.total_cost = max(Decimal("0"), new_total)
    balance.unit_cost = (
        (balance.total_cost / new_qty).quantize(Decimal("0.0001")) if new_qty > 0 else Decimal("0")
    )
    balance.last_txn_date = datetime.utcnow()
    return unit_cost


def _add_ledger_reversal(
    db: Session,
    tenant_id: int,
    item_id: int,
    warehouse_id: int,
    *,
    qty_in: Decimal = Decimal("0"),
    qty_out: Decimal = Decimal("0"),
    unit_cost: Decimal,
    ref_type: str,
    ref_id: int,
    notes: str,
    user_id: Optional[int],
    batch_no: Optional[str] = None,
) -> None:
    move = StockService.append_ledger_line(
        db,
        tenant_id,
        item_id,
        warehouse_id,
        qty_in=qty_in,
        qty_out=qty_out,
        unit_cost=unit_cost,
        ref_type=ref_type,
        ref_id=ref_id,
        notes=notes,
        created_by=user_id,
    )
    if batch_no:
        move.batch_no = batch_no


def _finished_item_for_order(db: Session, tenant_id: int, order: ProductionOrder) -> Item:
    bom = db.query(FeedBom).filter(FeedBom.id == order.bom_id, FeedBom.tenant_id == tenant_id).first()
    if not bom:
        raise ProductionRollbackError("BOM not found for this order.")
    product = (
        db.query(FeedProduct)
        .filter(FeedProduct.id == bom.product_id, FeedProduct.tenant_id == tenant_id)
        .first()
    )
    if not product:
        raise ProductionRollbackError("Feed product not found for this order.")
    item = db.query(Item).filter(Item.id == product.item_id, Item.tenant_id == tenant_id).first()
    if not item:
        raise ProductionRollbackError("Finished item not found for this order.")
    return item


def _reverse_factory_output(
    db: Session, tenant_id: int, order: ProductionOrder, user_id: Optional[int]
) -> None:
    actual = Decimal(str(order.actual_output_kg or 0))
    if actual <= 0:
        return
    finished = _finished_item_for_order(db, tenant_id, order)
    unit_cost = _apply_balance_decrease(
        db, tenant_id, finished.id, order.warehouse_id, actual, "finished goods receipt"
    )
    _add_ledger_reversal(
        db,
        tenant_id,
        finished.id,
        order.warehouse_id,
        qty_out=actual,
        unit_cost=unit_cost,
        ref_type="production_output_reversal",
        ref_id=order.id,
        notes=f"Rollback output for Production Order {order.order_number}",
        user_id=user_id,
        batch_no=order.order_number,
    )


def _reverse_silo_draw(
    db: Session,
    tenant_id: int,
    order: ProductionOrder,
    line: ProductionOrderLine,
    user_id: Optional[int],
) -> None:
    if not line.silo_id or not line.silo_consumed_kg:
        return
    silo_qty = Decimal(str(line.silo_consumed_kg))
    if silo_qty <= 0:
        return
    SiloService.fill(
        db=db,
        tenant_id=tenant_id,
        silo_id=int(line.silo_id),
        qty_kg=silo_qty,
        ref_type="production_issue_reversal",
        ref_id=order.id,
        notes=f"Rollback silo draw for Production Order {order.order_number}",
        user_id=user_id,
    )


def _reverse_factory_material_issues(
    db: Session, tenant_id: int, order: ProductionOrder, user_id: Optional[int]
) -> None:
    lines = (
        db.query(ProductionOrderLine)
        .filter(ProductionOrderLine.order_id == order.id, ProductionOrderLine.tenant_id == tenant_id)
        .all()
    )
    for line in lines:
        consumed = Decimal(str(line.consumed_qty_kg or 0))
        if consumed <= 0:
            continue
        ingredient = (
            db.query(Ingredient)
            .filter(Ingredient.id == line.ingredient_id, Ingredient.tenant_id == tenant_id)
            .first()
        )
        if not ingredient:
            continue
        item = db.query(Item).filter(Item.id == ingredient.item_id, Item.tenant_id == tenant_id).first()
        if not item:
            continue
        unit_cost = Decimal(str(line.unit_cost or 0))
        _apply_balance_increase(db, tenant_id, item.id, order.warehouse_id, consumed, unit_cost, user_id)
        _add_ledger_reversal(
            db,
            tenant_id,
            item.id,
            order.warehouse_id,
            qty_in=consumed,
            unit_cost=unit_cost,
            ref_type="production_issue_reversal",
            ref_id=order.id,
            notes=f"Rollback material issue for Production Order {order.order_number}",
            user_id=user_id,
            batch_no=order.order_number,
        )
        _reverse_silo_draw(db, tenant_id, order, line, user_id)
        line.consumed_qty_kg = None
        line.unit_cost = None
        line.total_cost = None
        line.silo_consumed_kg = None


def _reverse_legacy_post(
    db: Session, tenant_id: int, order: ProductionOrder, user_id: Optional[int]
) -> None:
    ledgers = (
        db.query(StockLedger)
        .filter(
            StockLedger.tenant_id == tenant_id,
            StockLedger.ref_id == order.id,
            StockLedger.ref_type.in_(("production_consumption", "production_output")),
        )
        .all()
    )
    for row in ledgers:
        qty_in = Decimal(str(row.qty_out or 0))
        qty_out = Decimal(str(row.qty_in or 0))
        if qty_in == 0 and qty_out == 0:
            continue
        unit_cost = Decimal(str(row.unit_cost or 0))
        ref_type = (
            "production_consumption_reversal"
            if row.ref_type == "production_consumption"
            else "production_output_reversal"
        )
        if qty_out > 0:
            current = StockService.get_current_stock(
                db, tenant_id, row.item_id, row.warehouse_id
            )
            if current < qty_out:
                raise ProductionRollbackError(
                    f"Cannot rollback {ref_type}: insufficient stock "
                    f"(need {qty_out} kg, ledger shows {current} kg)."
                )
            if _get_balance(db, tenant_id, row.item_id, row.warehouse_id):
                _apply_balance_decrease(
                    db, tenant_id, row.item_id, row.warehouse_id, qty_out, ref_type
                )
        if qty_in > 0:
            _apply_balance_increase(
                db, tenant_id, row.item_id, row.warehouse_id, qty_in, unit_cost, user_id
            )
        _add_ledger_reversal(
            db,
            tenant_id,
            row.item_id,
            row.warehouse_id,
            qty_in=qty_in,
            qty_out=qty_out,
            unit_cost=unit_cost,
            ref_type=ref_type,
            ref_id=order.id,
            notes=f"Rollback legacy post for Production Order {order.order_number}",
            user_id=user_id,
            batch_no=order.order_number,
        )

    lines = (
        db.query(ProductionOrderLine)
        .filter(ProductionOrderLine.order_id == order.id, ProductionOrderLine.tenant_id == tenant_id)
        .all()
    )
    for line in lines:
        _reverse_silo_draw(db, tenant_id, order, line, user_id)
        line.consumed_qty_kg = None
        line.unit_cost = None
        line.total_cost = None
        line.silo_consumed_kg = None


def _recalc_order_costs_from_bom(db: Session, order: ProductionOrder) -> None:
    material_cost = Decimal("0")
    for line in order.order_lines:
        ingredient = (
            db.query(Ingredient)
            .filter(Ingredient.id == line.ingredient_id, Ingredient.tenant_id == order.tenant_id)
            .first()
        )
        if not ingredient:
            continue
        item = db.query(Item).filter(Item.id == ingredient.item_id, Item.tenant_id == order.tenant_id).first()
        std = Decimal(str(item.standard_cost or 0)) if item else Decimal("0")
        req = Decimal(str(line.required_qty_with_loss_kg or 0))
        if std > 0 and req > 0:
            line.unit_cost = std
            line.total_cost = (req * std).quantize(Decimal("0.01"))
            material_cost += line.total_cost
        else:
            line.unit_cost = None
            line.total_cost = None
    order.material_cost = material_cost if material_cost > 0 else None
    overhead = Decimal(str(order.overhead_cost or 0))
    if material_cost > 0:
        order.total_cost = (material_cost + overhead).quantize(Decimal("0.01"))
        if order.planned_output_kg and Decimal(str(order.planned_output_kg)) > 0:
            order.cost_per_kg = (
                Decimal(str(order.total_cost)) / Decimal(str(order.planned_output_kg))
            ).quantize(Decimal("0.0001"))
    else:
        order.total_cost = overhead if overhead > 0 else None
        order.cost_per_kg = None


def rollback_production_order(
    db: Session, tenant_id: int, order_id: int, user_id: Optional[int]
) -> ProductionOrder:
    order = (
        db.query(ProductionOrder)
        .options(joinedload(ProductionOrder.order_lines))
        .filter(ProductionOrder.id == order_id, ProductionOrder.tenant_id == tenant_id)
        .first()
    )
    if not order:
        raise ProductionRollbackError("Production order not found.")

    status = (order.status or "").strip().lower()
    if status in (ProductionStatus.DRAFT.value, ProductionStatus.CANCELLED.value, ProductionStatus.PLANNED.value):
        raise ProductionRollbackError(f"Nothing to rollback for order in status '{order.status}'.")

    if _has_packing_issue(db, tenant_id, order.id):
        raise ProductionRollbackError(
            "Cannot rollback: packaging material was already issued for this batch."
        )

    ref_types = _order_ledger_ref_types(db, tenant_id, order.id)
    is_factory = "production_issue" in ref_types
    is_legacy = "production_consumption" in ref_types and not is_factory

    if not ref_types and status not in (ProductionStatus.IN_PROGRESS.value, ProductionStatus.COMPLETED.value):
        raise ProductionRollbackError(f"Cannot rollback order with status '{order.status}'.")

    if status == ProductionStatus.COMPLETED.value:
        if is_factory:
            _reverse_factory_output(db, tenant_id, order, user_id)
            _reverse_factory_material_issues(db, tenant_id, order, user_id)
        elif is_legacy or "production_output" in ref_types:
            _reverse_legacy_post(db, tenant_id, order, user_id)
        else:
            raise ProductionRollbackError("No stock movements found to reverse for this completed order.")
    elif status == ProductionStatus.IN_PROGRESS.value:
        if is_factory or any(line.consumed_qty_kg for line in order.order_lines):
            _reverse_factory_material_issues(db, tenant_id, order, user_id)
        else:
            raise ProductionRollbackError("No material issues found to reverse.")
    else:
        raise ProductionRollbackError(f"Cannot rollback order with status '{order.status}'.")

    order.status = ProductionStatus.DRAFT.value
    order.start_date = None
    order.end_date = None
    order.actual_output_kg = None
    order.yield_pct = None
    _recalc_order_costs_from_bom(db, order)

    db.commit()
    db.refresh(order)
    return order
