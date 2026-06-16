"""
Stock ledger service - handles inventory movements
"""
from decimal import Decimal
from typing import Optional
from sqlalchemy import func
from sqlalchemy.orm import Session
from datetime import datetime
from app.modules.inventory.models import StockLedger
from app.core.exceptions import PostingError

class StockService:
    """Service for managing stock ledger entries"""
    
    @staticmethod
    def create_stock_move(
        db: Session,
        tenant_id: int,
        item_id: int,
        warehouse_id: int,
        qty_in: Decimal = Decimal("0"),
        qty_out: Decimal = Decimal("0"),
        unit_cost: Decimal = Decimal("0"),
        txn_type: str = "adjustment",
        ref_type: str = "",
        ref_id: Optional[int] = None,
        txn_date: Optional[datetime] = None,
        batch_no: Optional[str] = None,
        notes: Optional[str] = None,
        created_by: Optional[int] = None
    ) -> StockLedger:
        """Create a stock ledger entry"""
        if qty_in == 0 and qty_out == 0:
            raise PostingError("Both qty_in and qty_out cannot be zero")
        
        if qty_in > 0 and qty_out > 0:
            raise PostingError("Cannot have both qty_in and qty_out in same entry")
        
        # NOTE: Current sqlite schema uses qty_in/qty_out (not *_kg) and has no txn_type/total_cost columns.
        # We keep txn_type in the signature for forwards-compatibility with callers, but it is not persisted.
        qty_in = Decimal(str(qty_in or 0))
        qty_out = Decimal(str(qty_out or 0))
        unit_cost = Decimal(str(unit_cost or 0))
        
        move = StockLedger(
            tenant_id=tenant_id,
            item_id=item_id,
            warehouse_id=warehouse_id,
            qty_in=qty_in,
            qty_out=qty_out,
            unit_cost=unit_cost,
            ref_type=ref_type or "adjustment",
            ref_id=ref_id,
            txn_date=txn_date or datetime.utcnow(),
            batch_no=batch_no,
            notes=notes,
            created_by=created_by,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db.add(move)
        db.commit()
        db.refresh(move)
        return move

    @staticmethod
    def append_ledger_line(
        db: Session,
        tenant_id: int,
        item_id: int,
        warehouse_id: int,
        *,
        qty_in: Decimal = Decimal("0"),
        qty_out: Decimal = Decimal("0"),
        unit_cost: Decimal = Decimal("0"),
        ref_type: str,
        ref_id: Optional[int] = None,
        txn_date: Optional[datetime] = None,
        notes: Optional[str] = None,
        created_by: Optional[int] = None,
    ) -> StockLedger:
        """
        Same as create_stock_move but flush-only (caller controls commit).
        Used when posting alongside other domain transactions (e.g. fuel tanks).
        """
        if qty_in == 0 and qty_out == 0:
            raise PostingError("Both qty_in and qty_out cannot be zero")
        if qty_in > 0 and qty_out > 0:
            raise PostingError("Cannot have both qty_in and qty_out in same entry")
        qty_in = Decimal(str(qty_in or 0))
        qty_out = Decimal(str(qty_out or 0))
        unit_cost = Decimal(str(unit_cost or 0))
        move = StockLedger(
            tenant_id=tenant_id,
            item_id=item_id,
            warehouse_id=warehouse_id,
            qty_in=qty_in,
            qty_out=qty_out,
            unit_cost=unit_cost,
            ref_type=ref_type,
            ref_id=ref_id,
            txn_date=txn_date or datetime.utcnow(),
            notes=notes,
            created_by=created_by,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(move)
        db.flush()
        return move
    
    @staticmethod
    def get_current_stock(
        db: Session,
        tenant_id: int,
        item_id: int,
        warehouse_id: Optional[int] = None
    ) -> Decimal:
        """Sum ledger movements: qty_in - qty_out for this item (optionally per warehouse)."""
        q = db.query(
            func.coalesce(
                func.sum(StockLedger.qty_in - StockLedger.qty_out),
                0,
            )
        ).filter(
            StockLedger.tenant_id == tenant_id,
            StockLedger.item_id == item_id,
        )
        if warehouse_id is not None:
            q = q.filter(StockLedger.warehouse_id == warehouse_id)
        result = q.scalar()
        return Decimal(str(result if result is not None else 0))
    
    @staticmethod
    def get_fifo_cost(
        db: Session,
        tenant_id: int,
        item_id: int,
        warehouse_id: int,
        qty: Decimal
    ) -> Decimal:
        """
        Calculate FIFO cost for a quantity
        Returns average cost per unit
        """
        # Get all stock-in entries ordered by date
        stock_ins = db.query(StockLedger).filter(
            StockLedger.tenant_id == tenant_id,
            StockLedger.item_id == item_id,
            StockLedger.warehouse_id == warehouse_id,
            StockLedger.qty_in > 0
        ).order_by(StockLedger.txn_date, StockLedger.id).all()
        
        if not stock_ins:
            return Decimal("0")
        
        # Calculate weighted average cost
        total_cost = Decimal("0")
        total_qty = Decimal("0")
        
        for entry in stock_ins:
            total_cost += entry.qty_in * entry.unit_cost
            total_qty += entry.qty_in
        
        if total_qty == 0:
            return Decimal("0")
        
        return total_cost / total_qty

