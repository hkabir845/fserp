"""
Inventory Models - Stock Ledger, Lots, Transactions
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Numeric, Boolean, Text, Index
from sqlalchemy.orm import relationship
from app.shared.base import TenantBase
from datetime import datetime

class Warehouse(TenantBase):
    """Warehouses/Locations"""
    __tablename__ = "warehouses"
    
    name = Column(String, nullable=False)
    address = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    
    # Relationships
    stock_ledger = relationship("StockLedger", back_populates="warehouse")
    # NOTE: Avoid hard relationship wiring here; some scripts import Warehouse without importing
    # the manufacturing/feed models, which breaks mapper configuration.

class InventoryLot(TenantBase):
    """Inventory Lots/Batches for traceability"""
    __tablename__ = "inventory_lots"
    
    lot_no = Column(String, nullable=False, index=True)  # LOT-2024-001
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False, index=True)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    
    # Lot details
    qty_kg = Column(Numeric(15, 3), nullable=False)  # Current quantity
    unit_cost = Column(Numeric(15, 4), nullable=False)  # Weighted average cost
    total_cost = Column(Numeric(15, 4), nullable=False)
    
    # Expiry tracking
    manufacture_date = Column(DateTime, nullable=True)
    expiry_date = Column(DateTime, nullable=True)
    
    # Source tracking
    source_type = Column(String, nullable=True)  # purchase, production, transfer
    source_ref = Column(String, nullable=True)  # PO number, batch number, etc.
    
    # Status
    is_active = Column(Boolean, default=True)
    
    # Relationships
    item = relationship("Item", foreign_keys=[item_id])
    warehouse = relationship("Warehouse", foreign_keys=[warehouse_id])
    
    __table_args__ = (
        Index('idx_lot_item_warehouse', 'tenant_id', 'item_id', 'warehouse_id'),
        Index('idx_lot_no', 'tenant_id', 'lot_no'),
    )

class StockLedger(TenantBase):
    """Immutable stock movement ledger"""
    __tablename__ = "stock_ledger"
    
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False, index=True)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False, index=True)
    
    # Transaction date
    txn_date = Column(DateTime, nullable=False, index=True, default=datetime.utcnow)
    
    # Quantities (legacy schema uses qty_in/qty_out)
    qty_in = Column(Numeric(15, 3), default=0)
    qty_out = Column(Numeric(15, 3), default=0)
    
    # Costing (legacy schema uses 2dp)
    unit_cost = Column(Numeric(15, 2), nullable=False)
    
    # Reference tracking (legacy schema requires ref_type)
    ref_type = Column(String, nullable=False)  # grn, production_order, sales_invoice, adjustment, transfer
    ref_id = Column(Integer, nullable=True)
    
    # Batch/lot tracking
    batch_no = Column(String, nullable=True, index=True)  # Production batch number
    
    notes = Column(Text, nullable=True)
    
    # Relationships
    item = relationship("Item", foreign_keys=[item_id])
    warehouse = relationship("Warehouse", back_populates="stock_ledger")
    
    __table_args__ = (
        Index('idx_stock_item_warehouse', 'tenant_id', 'item_id', 'warehouse_id'),
        Index('idx_stock_txn_date', 'tenant_id', 'txn_date'),
        Index('idx_stock_batch', 'tenant_id', 'batch_no'),
    )

class StockBalance(TenantBase):
    """Current stock balance (computed view or materialized)"""
    __tablename__ = "stock_balances"
    
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False, index=True)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False, index=True)
    lot_id = Column(Integer, ForeignKey("inventory_lots.id"), nullable=True)
    
    # Current balance
    qty_kg = Column(Numeric(15, 3), nullable=False, default=0)
    unit_cost = Column(Numeric(15, 4), nullable=False)
    total_cost = Column(Numeric(15, 4), nullable=False)
    
    # Last updated
    last_txn_date = Column(DateTime, nullable=True)
    
    # Relationships
    item = relationship("Item", foreign_keys=[item_id])
    warehouse = relationship("Warehouse", foreign_keys=[warehouse_id])
    lot = relationship("InventoryLot", foreign_keys=[lot_id])
    
    __table_args__ = (
        Index('idx_balance_item_warehouse', 'tenant_id', 'item_id', 'warehouse_id', 'lot_id', unique=True),
    )
