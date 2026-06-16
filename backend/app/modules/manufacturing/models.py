from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Numeric, Boolean
from sqlalchemy.orm import relationship
from app.shared.base import TenantBase

class Bom(TenantBase):
    __tablename__ = "boms"
    
    name = Column(String, nullable=False)
    output_item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    output_qty = Column(Numeric(15, 3), nullable=False)
    is_active = Column(Boolean, default=True)
    effective_from = Column(DateTime, nullable=True)
    effective_to = Column(DateTime, nullable=True)
    version = Column(String, nullable=True)
    
    output_item = relationship("Item", foreign_keys=[output_item_id])
    lines = relationship("BomLine", back_populates="bom", cascade="all, delete-orphan")

class BomLine(TenantBase):
    __tablename__ = "bom_lines"
    
    bom_id = Column(Integer, ForeignKey("boms.id"), nullable=False)
    input_item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    qty = Column(Numeric(15, 3), nullable=False)
    uom_id = Column(Integer, ForeignKey("uoms.id"), nullable=False)
    waste_percent = Column(Numeric(5, 2), default=0)
    
    bom = relationship("Bom", back_populates="lines")
    item = relationship("Item")
    uom = relationship("UOM")

class ProductionBatch(TenantBase):
    __tablename__ = "production_batches"
    
    batch_number = Column(String, nullable=False, unique=True, index=True)
    bom_id = Column(Integer, ForeignKey("boms.id"), nullable=False)
    status = Column(String, nullable=False, default="draft")  # draft, in_progress, completed, cancelled
    planned_qty = Column(Numeric(15, 3), nullable=False)
    actual_qty = Column(Numeric(15, 3), nullable=True)
    start_date = Column(DateTime, nullable=True)
    end_date = Column(DateTime, nullable=True)
    
    bom = relationship("Bom")
    consumptions = relationship("ProductionConsumption", back_populates="batch", cascade="all, delete-orphan")
    outputs = relationship("ManufacturingProductionOutput", back_populates="batch", cascade="all, delete-orphan")
    scraps = relationship("Scrap", back_populates="batch", cascade="all, delete-orphan")

class ProductionConsumption(TenantBase):
    __tablename__ = "production_consumptions"
    
    batch_id = Column(Integer, ForeignKey("production_batches.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    qty = Column(Numeric(15, 3), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    unit_cost = Column(Numeric(15, 2), nullable=False)
    
    batch = relationship("ProductionBatch", back_populates="consumptions")
    item = relationship("Item")
    warehouse = relationship("Warehouse")

class ManufacturingProductionOutput(TenantBase):
    # NOTE: Feed manufacturing module also defines "production_outputs".
    # Use a distinct table name to avoid SQLAlchemy MetaData collisions.
    __tablename__ = "manufacturing_production_outputs"
    
    batch_id = Column(Integer, ForeignKey("production_batches.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    qty = Column(Numeric(15, 3), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    unit_cost = Column(Numeric(15, 2), nullable=False)
    
    batch = relationship("ProductionBatch", back_populates="outputs")
    item = relationship("Item")
    warehouse = relationship("Warehouse")

class Scrap(TenantBase):
    __tablename__ = "scraps"
    
    batch_id = Column(Integer, ForeignKey("production_batches.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    qty = Column(Numeric(15, 3), nullable=False)
    reason = Column(String, nullable=True)
    
    batch = relationship("ProductionBatch", back_populates="scraps")
    item = relationship("Item")

