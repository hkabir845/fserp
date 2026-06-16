"""
Pre-Formulation Library Models
World Standard Pre-Formulation Templates
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Numeric, Boolean, Text, Index
from sqlalchemy.orm import relationship
from app.db.session import Base
from datetime import datetime

class PreFormulation(Base):
    """
    Pre-Formulation Library Templates
    Global templates (tenant_id NULL) and tenant overrides (tenant_id NOT NULL)
    """
    __tablename__ = "pre_formulations"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)  # NULL for global templates
    code = Column(String, nullable=False, index=True)  # e.g., FISH-TILAPIA-FRY-001
    title = Column(String, nullable=False)  # e.g., "Tilapia Fry Floating Feed 0.8mm"
    
    # Classification
    category = Column(String, nullable=False)  # Fish, Poultry, Cattle, Goat, Sheep, Pet, Other
    species = Column(String, nullable=False)  # Tilapia, Carp, Catfish, Broiler, Layer, Dairy, etc.
    stage = Column(String, nullable=False)  # Fry, Starter, Grower, Finisher, Layer, etc.
    process_type = Column(String, nullable=False)  # Extruded, Pellet, Mash, Crumble
    float_type = Column(String, nullable=True)  # Floating, Sinking, Slow-sinking (Fish only)
    pellet_mm = Column(Numeric(5, 2), nullable=True)  # 0.8, 2.5, 5.0, etc.
    
    # Batch defaults
    default_batch_kg = Column(Numeric(15, 3), nullable=False, default=1000.0)
    
    # Target nutrition
    protein_target_min = Column(Numeric(5, 2), nullable=True)
    protein_target_max = Column(Numeric(5, 2), nullable=True)
    fat_target_min = Column(Numeric(5, 2), nullable=True)
    fat_target_max = Column(Numeric(5, 2), nullable=True)
    fiber_target_max = Column(Numeric(5, 2), nullable=True)
    moisture_target_max = Column(Numeric(5, 2), nullable=True)
    energy_target_min = Column(Numeric(10, 2), nullable=True)
    
    # Metadata
    notes = Column(Text, nullable=True)
    is_reference_only = Column(Boolean, default=True)  # True = template only, False = can be used directly
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Relationships
    lines = relationship("PreFormulationLine", back_populates="pre_formulation", 
                        cascade="all, delete-orphan", order_by="PreFormulationLine.sort_order")
    
    __table_args__ = (
        Index('idx_preform_tenant_code', 'tenant_id', 'code'),
        Index('idx_preform_category_species', 'tenant_id', 'category', 'species'),
        Index('idx_preform_filters', 'tenant_id', 'category', 'species', 'stage', 'process_type'),
    )

class PreFormulationLine(Base):
    """
    Pre-Formulation Lines (Percent-based only for library)
    """
    __tablename__ = "pre_formulation_lines"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)  # NULL for global templates
    pre_formulation_id = Column(Integer, ForeignKey("pre_formulations.id"), nullable=False, index=True)
    ingredient_item_id = Column(Integer, ForeignKey("items.id"), nullable=False, index=True)
    
    # Inclusion (PERCENT only for library templates)
    inclusion_basis = Column(String, nullable=False, default="PERCENT")  # PERCENT only
    inclusion_value = Column(Numeric(10, 4), nullable=False)  # Percent 0-100
    
    # Constraints
    min_percent = Column(Numeric(5, 2), nullable=True)
    max_percent = Column(Numeric(5, 2), nullable=True)
    
    # Process phase
    phase = Column(String, nullable=True)  # Grinding, Mixing, Extrusion, Coating, etc.
    
    # Process aid flag
    is_process_aid = Column(Boolean, default=False)  # Excluded from 100% total
    
    # Display order
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Relationships
    pre_formulation = relationship("PreFormulation", back_populates="lines")
    ingredient_item = relationship("Item", foreign_keys=[ingredient_item_id])
    
    __table_args__ = (
        Index('idx_preform_line_form', 'tenant_id', 'pre_formulation_id'),
        Index('idx_preform_line_item', 'tenant_id', 'ingredient_item_id'),
    )

