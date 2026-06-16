"""
Feed Manufacturing Models - Comprehensive BOM/Formulation/Production/QC/Traceability
Multi-tenant Feed Manufacturing ERP Module
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Numeric, Boolean, Text, Enum as SQLEnum, Index
from sqlalchemy.orm import relationship
from app.shared.base import TenantBase
from datetime import datetime
from decimal import Decimal
import enum

# ========== ENUMS ==========
class BOMStatus(str, enum.Enum):
    DRAFT = "draft"
    APPROVED = "approved"
    ARCHIVED = "archived"

class InclusionBasis(str, enum.Enum):
    PERCENT = "percent"
    KG_PER_TON = "kg_per_ton"
    G_PER_TON = "g_per_ton"

class ProcessPhase(str, enum.Enum):
    GRINDING = "grinding"
    MIXING = "mixing"
    CONDITIONING = "conditioning"
    EXTRUSION = "extrusion"
    PELLETING = "pelleting"
    DRYING = "drying"
    COOLING = "cooling"
    COATING = "coating"
    PACKING = "packing"
    CRUMBLING = "crumbling"

class ProductionStatus(str, enum.Enum):
    DRAFT = "draft"
    PLANNED = "planned"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"

class RouteType(str, enum.Enum):
    EXTRUDED_FLOATING = "extruded_floating"
    EXTRUDED_SINKING = "extruded_sinking"
    EXTRUDED_SLOW_SINKING = "extruded_slow_sinking"
    PELLETED = "pelleted"
    MASH = "mash"
    CRUMBLE = "crumble"

class TxnType(str, enum.Enum):
    RECEIPT = "receipt"
    ISSUE = "issue"
    PRODUCE = "produce"
    TRANSFER = "transfer"
    ADJUSTMENT = "adjustment"
    REWORK = "rework"

# ========== FEED PRODUCT (Finished Feed) ==========
class FeedProduct(TenantBase):
    """Finished Feed Products with variants"""
    __tablename__ = "feed_products"
    
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False, unique=True, index=True)
    
    # Category & Variants
    category = Column(String, nullable=False)  # Fish, Poultry, Cattle, Goat, Sheep, Pet, Other
    subtype = Column(String, nullable=True)  # Floating, Sinking, Slow-sinking (for fish)
    stage = Column(String, nullable=True)  # starter, grower, finisher, brood, laying, fry, fingerling
    
    # Physical properties
    pellet_size_mm = Column(Numeric(5, 2), nullable=True)  # 0.4, 0.6, 0.8, 1.2, 1.5, 2, 3, 4, 6, 8
    packaging = Column(String, nullable=True)
    
    # Target nutrition (optional)
    target_protein_pct = Column(Numeric(5, 2), nullable=True)
    target_fat_pct = Column(Numeric(5, 2), nullable=True)
    target_fiber_pct = Column(Numeric(5, 2), nullable=True)
    target_moisture_pct = Column(Numeric(5, 2), nullable=True)
    target_ash_pct = Column(Numeric(5, 2), nullable=True)
    target_energy_kcal = Column(Numeric(10, 2), nullable=True)
    
    # Process steps required
    requires_grinding = Column(Boolean, default=False)
    requires_extrusion = Column(Boolean, default=False)
    requires_pelleting = Column(Boolean, default=False)
    requires_drying = Column(Boolean, default=False)
    requires_coating = Column(Boolean, default=False)
    
    item = relationship("Item", foreign_keys=[item_id])
    boms = relationship("FeedBom", back_populates="product", cascade="all, delete-orphan")

# ========== INGREDIENT (Raw Material) ==========
class Ingredient(TenantBase):
    """Raw Materials / Ingredients with nutrient profiles"""
    __tablename__ = "ingredients"
    
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False, unique=True, index=True)
    
    # Type classification
    ingredient_type = Column(String, nullable=False)  # macro, micro, additive, medicine, binder, process_aid
    
    # Cost method
    cost_method = Column(String, default="weighted_average")  # weighted_average, fifo, standard
    
    # Nutrition attributes per kg (dry matter basis typically)
    protein_pct = Column(Numeric(5, 2), nullable=True)  # 0-100
    fat_pct = Column(Numeric(5, 2), nullable=True)
    fiber_pct = Column(Numeric(5, 2), nullable=True)
    ash_pct = Column(Numeric(5, 2), nullable=True)
    moisture_pct = Column(Numeric(5, 2), nullable=True)
    energy_kcal = Column(Numeric(10, 2), nullable=True)
    
    
    # Premix/Micro dosing
    is_premix = Column(Boolean, default=False)
    premix_unit = Column(String, nullable=True)  # g/ton, kg/ton
    
    item = relationship("Item", foreign_keys=[item_id])
    bom_lines = relationship("FeedBomLine", back_populates="ingredient")

# ========== BOM / FORMULA ==========
class FeedBom(TenantBase):
    """Bill of Materials for Feed Formulation with versioning"""
    __tablename__ = "feed_boms"
    
    bom_code = Column(String, nullable=False, index=True)  # e.g., FISH-001, POULTRY-001
    product_id = Column(Integer, ForeignKey("feed_products.id"), nullable=False, index=True)
    
    # Versioning
    version = Column(String, nullable=False, default="1.0")  # 1.0, 1.1, 2.0
    status = Column(String, nullable=False, default=BOMStatus.DRAFT.value)
    
    # Effective dates
    effective_from = Column(DateTime, nullable=True)
    effective_to = Column(DateTime, nullable=True)
    
    # Batch and process
    default_batch_size_ton = Column(Numeric(10, 3), nullable=False, default=Decimal("1.000"))
    process_type = Column(String, nullable=False)  # extrusion, pellet, mash, crumbles
    pellet_size_mm = Column(Numeric(5, 2), nullable=True)
    is_floating = Column(Boolean, default=False)
    
    # Target nutrition (for validation)
    target_protein_pct = Column(Numeric(5, 2), nullable=True)
    target_fat_pct = Column(Numeric(5, 2), nullable=True)
    target_fiber_pct = Column(Numeric(5, 2), nullable=True)
    target_moisture_pct = Column(Numeric(5, 2), nullable=True)
    target_ash_pct = Column(Numeric(5, 2), nullable=True)
    # NOTE: DB schema does not include target_energy_kcal, approval tracking, or tolerance fields.
    
    # Notes
    notes = Column(Text, nullable=True)
    
    # Relationships
    product = relationship("FeedProduct", back_populates="boms")
    lines = relationship("FeedBomLine", back_populates="bom", cascade="all, delete-orphan", order_by="FeedBomLine.sequence")
    production_orders = relationship("ProductionOrder", back_populates="bom")
    
    # Indexes for performance
    __table_args__ = (
        Index('idx_bom_tenant_product_version', 'tenant_id', 'product_id', 'version'),
        Index('idx_bom_status', 'tenant_id', 'status'),
    )

# ========== BOM LINE ==========
class FeedBomLine(TenantBase):
    """BOM Line with mixed inclusion basis support"""
    __tablename__ = "feed_bom_lines"
    
    bom_id = Column(Integer, ForeignKey("feed_boms.id"), nullable=False, index=True)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id"), nullable=False, index=True)
    sequence = Column(Integer, nullable=False, default=0)  # Display order
    
    # Inclusion basis: percent, kg/ton, g/ton
    inclusion_basis = Column(String, nullable=False)  # percent, kg_per_ton, g_per_ton
    inclusion_value = Column(Numeric(15, 4), nullable=False)  # The value in the basis
    
    # Computed values for the selected batch size
    computed_kg = Column(Numeric(15, 3), nullable=True)
    computed_percent = Column(Numeric(10, 4), nullable=True)
    
    # Process phase
    phase = Column(String, nullable=True)  # grinding, mixing, extrusion, coating, etc.
    
    # Loss/yield
    loss_factor_pct = Column(Numeric(5, 2), nullable=True, default=0)  # Loss during processing
    
    # Constraints (for formulation solver)
    min_percent = Column(Numeric(5, 2), nullable=True)
    max_percent = Column(Numeric(5, 2), nullable=True)
    # NOTE: DB schema does not include min/max kg_per_ton.
    
    # Relationships
    bom = relationship("FeedBom", back_populates="lines")
    ingredient = relationship("Ingredient", back_populates="bom_lines")
    production_lines = relationship("ProductionOrderLine", back_populates="bom_line")
    
    __table_args__ = (
        Index('idx_bom_line_bom', 'tenant_id', 'bom_id', 'sequence'),
    )

# ========== PRODUCTION ORDER ==========
class ProductionOrder(TenantBase):
    """Production Order from Approved BOM"""
    __tablename__ = "production_orders"
    
    order_number = Column(String, nullable=False, unique=True, index=True)  # PO-2024-001
    bom_id = Column(Integer, ForeignKey("feed_boms.id"), nullable=False, index=True)
    
    # Batch details
    batch_size_ton = Column(Numeric(10, 3), nullable=False)
    batch_size_kg = Column(Numeric(15, 3), nullable=False)  # Actual batch size
    
    # Status
    status = Column(String, nullable=False, default=ProductionStatus.DRAFT.value)
    
    # Dates
    planned_date = Column(DateTime, nullable=True)
    start_date = Column(DateTime, nullable=True)
    end_date = Column(DateTime, nullable=True)
    
    # Quantities
    planned_output_kg = Column(Numeric(15, 3), nullable=False)  # Expected output after yield
    actual_output_kg = Column(Numeric(15, 3), nullable=True)  # Actual produced
    yield_pct = Column(Numeric(5, 2), nullable=True)  # Actual vs planned yield
    
    # Costing
    material_cost = Column(Numeric(15, 2), nullable=True)
    overhead_cost = Column(Numeric(15, 2), nullable=True)
    total_cost = Column(Numeric(15, 2), nullable=True)
    cost_per_kg = Column(Numeric(15, 4), nullable=True)
    
    # Warehouse
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    
    notes = Column(Text, nullable=True)
    
    # Relationships
    bom = relationship("FeedBom", back_populates="production_orders")
    warehouse = relationship("Warehouse", foreign_keys=[warehouse_id])
    order_lines = relationship("ProductionOrderLine", back_populates="order", cascade="all, delete-orphan")
    steps = relationship("ProductionStep", back_populates="order", cascade="all, delete-orphan", order_by="ProductionStep.sequence")
    outputs = relationship("ProductionOutput", back_populates="order", cascade="all, delete-orphan")
    packing_ops = relationship("PackingOperation", back_populates="order", cascade="all, delete-orphan")
    qc_result = relationship("BatchQC", back_populates="order", uselist=False)
    
    __table_args__ = (
        # DB schema has no batch_no column; use order_number for batch identifier.
        Index('idx_prod_order_status', 'tenant_id', 'status'),
    )

# ========== SILO (BULK RAW MATERIAL STORAGE) ==========
class Silo(TenantBase):
    """
    Physical silo / bin tied to a warehouse and a single bulk item (corn, soybean meal, etc.).
    Tracks level for integration with conveyors, PLC/SCADA, or load-cell sensors.
    """
    __tablename__ = "silos"

    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False, index=True)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False, index=True)

    name = Column(String, nullable=False)
    code = Column(String, nullable=True, index=True)

    capacity_kg = Column(Numeric(15, 3), nullable=True)
    current_qty_kg = Column(Numeric(15, 3), nullable=False, default=Decimal("0"))

    reorder_min_kg = Column(Numeric(15, 3), nullable=True)

    # manual | plc | sensor — how level is maintained in the field
    integration_source = Column(String, nullable=False, default="manual")
    external_device_id = Column(String, nullable=True)

    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)

    warehouse = relationship("Warehouse", foreign_keys=[warehouse_id])
    item = relationship("Item", foreign_keys=[item_id])
    transactions = relationship("SiloTransaction", back_populates="silo", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_silo_tenant_wh_item", "tenant_id", "warehouse_id", "item_id"),
    )


class SiloTransaction(TenantBase):
    """Immutable silo level movements (fill, production draw, sensor sync, adjustment)."""
    __tablename__ = "silo_transactions"

    silo_id = Column(Integer, ForeignKey("silos.id"), nullable=False, index=True)
    qty_delta = Column(Numeric(15, 3), nullable=False)  # + in, − out

    ref_type = Column(String, nullable=False)
    # fill, production_issue, adjustment, sensor_sync, plc_sync
    ref_id = Column(Integer, nullable=True)

    notes = Column(Text, nullable=True)

    silo = relationship("Silo", back_populates="transactions")

    __table_args__ = (
        Index("idx_silo_txn_silo", "tenant_id", "silo_id"),
    )


# ========== PRODUCTION ORDER LINE ==========
class ProductionOrderLine(TenantBase):
    """Ingredient requirements for production order with lot tracking"""
    __tablename__ = "production_order_lines"
    
    order_id = Column(Integer, ForeignKey("production_orders.id"), nullable=False, index=True)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id"), nullable=False)
    bom_line_id = Column(Integer, ForeignKey("feed_bom_lines.id"), nullable=True)  # Reference to BOM line

    # Optional: material drawn from this silo (matches ingredient.item_id ↔ silo.item_id)
    silo_id = Column(Integer, ForeignKey("silos.id"), nullable=True, index=True)
    silo_consumed_kg = Column(Numeric(15, 3), nullable=True)  # Actual kg recorded from silo when integrated
    
    # Required quantities
    required_qty_kg = Column(Numeric(15, 3), nullable=False)
    required_qty_with_loss_kg = Column(Numeric(15, 3), nullable=False)  # Including loss factor
    
    # Actual consumption
    consumed_qty_kg = Column(Numeric(15, 3), nullable=True)
    
    # Costing
    unit_cost = Column(Numeric(15, 4), nullable=True)
    total_cost = Column(Numeric(15, 2), nullable=True)
    
    # Relationships
    order = relationship("ProductionOrder", back_populates="order_lines")
    ingredient = relationship("Ingredient", foreign_keys=[ingredient_id])
    bom_line = relationship("FeedBomLine", back_populates="production_lines")
    silo = relationship("Silo", foreign_keys=[silo_id])

# ========== PRODUCTION STEP ==========
class ProductionStep(TenantBase):
    """Timestamped production process steps"""
    __tablename__ = "production_steps"
    
    order_id = Column(Integer, ForeignKey("production_orders.id"), nullable=False, index=True)
    phase = Column(String, nullable=False)  # grinding, mixing, extrusion, etc.
    sequence = Column(Integer, nullable=False, default=0)
    
    start_time = Column(DateTime, nullable=True)
    end_time = Column(DateTime, nullable=True)
    
    # Step-specific data
    temperature_c = Column(Numeric(5, 2), nullable=True)
    pressure_bar = Column(Numeric(5, 2), nullable=True)
    notes = Column(Text, nullable=True)
    
    order = relationship("ProductionOrder", back_populates="steps")

# ========== PRODUCTION OUTPUT ==========
class ProductionOutput(TenantBase):
    """Finished goods produced from production batch"""
    __tablename__ = "production_outputs"
    
    order_id = Column(Integer, ForeignKey("production_orders.id"), nullable=False, index=True)
    finished_item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    
    produced_qty_kg = Column(Numeric(15, 3), nullable=False)
    
    # Lot/batch tracking
    lot_id = Column(Integer, ForeignKey("inventory_lots.id"), nullable=True)
    
    order = relationship("ProductionOrder", back_populates="outputs")
    item = relationship("Item", foreign_keys=[finished_item_id])
    warehouse = relationship("Warehouse", foreign_keys=[warehouse_id])
    lot = relationship("InventoryLot", foreign_keys=[lot_id])

# ========== PACKING OPERATION ==========
class PackingOperation(TenantBase):
    """Packing finished feed into bags"""
    __tablename__ = "packing_operations"
    
    order_id = Column(Integer, ForeignKey("production_orders.id"), nullable=False, index=True)
    bag_item_id = Column(Integer, ForeignKey("items.id"), nullable=False)  # Packaging material
    pack_size_kg = Column(Numeric(5, 2), nullable=False)  # 25, 50, etc.
    
    bags_count = Column(Integer, nullable=False)
    net_kg = Column(Numeric(15, 3), nullable=False)  # Total net weight
    gross_kg = Column(Numeric(15, 3), nullable=False)  # Total gross weight (net + bags)
    
    order = relationship("ProductionOrder", back_populates="packing_ops")
    bag_item = relationship("Item", foreign_keys=[bag_item_id])

# ========== BATCH QC RESULTS ==========
class BatchQC(TenantBase):
    """Quality Control results for production batch"""
    __tablename__ = "batch_qc_results"
    
    order_id = Column(Integer, ForeignKey("production_orders.id"), nullable=False, unique=True, index=True)
    
    # Actual lab values
    actual_protein_pct = Column(Numeric(5, 2), nullable=True)
    actual_fat_pct = Column(Numeric(5, 2), nullable=True)
    actual_fiber_pct = Column(Numeric(5, 2), nullable=True)
    actual_moisture_pct = Column(Numeric(5, 2), nullable=True)
    actual_ash_pct = Column(Numeric(5, 2), nullable=True)
    actual_energy_kcal = Column(Numeric(10, 2), nullable=True)
    
    # Fish feed specific
    pdi = Column(Numeric(5, 2), nullable=True)  # Pellet Durability Index
    floatability_pct = Column(Numeric(5, 2), nullable=True)  # For floating feed
    sinking_time_sec = Column(Numeric(10, 2), nullable=True)  # For sinking feed
    water_stability_min = Column(Numeric(10, 2), nullable=True)  # For fish feed
    
    # Pass/Fail (auto-evaluated against targets)
    protein_pass = Column(Boolean, nullable=True)
    fat_pass = Column(Boolean, nullable=True)
    fiber_pass = Column(Boolean, nullable=True)
    moisture_pass = Column(Boolean, nullable=True)
    ash_pass = Column(Boolean, nullable=True)
    energy_pass = Column(Boolean, nullable=True)
    
    overall_pass = Column(Boolean, nullable=True)
    
    # Test metadata
    test_date = Column(DateTime, nullable=True)
    tested_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    notes = Column(Text, nullable=True)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)  # Override approval
    approved_at = Column(DateTime, nullable=True)
    
    order = relationship("ProductionOrder", back_populates="qc_result")

# ========== QC TARGETS ==========
class QCTarget(TenantBase):
    """QC Targets per product or BOM"""
    __tablename__ = "qc_targets"
    
    product_id = Column(Integer, ForeignKey("feed_products.id"), nullable=True)
    bom_id = Column(Integer, ForeignKey("feed_boms.id"), nullable=True)
    
    # Target ranges
    protein_min_pct = Column(Numeric(5, 2), nullable=True)
    protein_max_pct = Column(Numeric(5, 2), nullable=True)
    fat_min_pct = Column(Numeric(5, 2), nullable=True)
    fat_max_pct = Column(Numeric(5, 2), nullable=True)
    fiber_max_pct = Column(Numeric(5, 2), nullable=True)
    moisture_max_pct = Column(Numeric(5, 2), nullable=True)
    ash_max_pct = Column(Numeric(5, 2), nullable=True)
    energy_min_kcal = Column(Numeric(10, 2), nullable=True)
    
    # Fish feed specific
    pdi_min = Column(Numeric(5, 2), nullable=True)
    floatability_min_pct = Column(Numeric(5, 2), nullable=True)
    sinking_time_max_sec = Column(Numeric(10, 2), nullable=True)
    water_stability_min_min = Column(Numeric(10, 2), nullable=True)
    
    product = relationship("FeedProduct", foreign_keys=[product_id])
    bom = relationship("FeedBom", foreign_keys=[bom_id])

# ========== AUDIT LOG ==========
class AuditLog(TenantBase):
    """Audit trail for BOM changes, approvals, etc."""
    __tablename__ = "audit_logs"
    
    entity_type = Column(String, nullable=False)  # bom, production_order, qc, etc.
    entity_id = Column(Integer, nullable=False)
    action = Column(String, nullable=False)  # created, updated, approved, cloned, archived
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    timestamp = Column(DateTime, nullable=False, default=datetime.utcnow)
    
    old_values = Column(Text, nullable=True)  # JSON
    new_values = Column(Text, nullable=True)  # JSON
    notes = Column(Text, nullable=True)
    
    __table_args__ = (
        Index('idx_audit_entity', 'tenant_id', 'entity_type', 'entity_id'),
        Index('idx_audit_timestamp', 'tenant_id', 'timestamp'),
    )
