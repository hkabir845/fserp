from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Numeric
from sqlalchemy.orm import relationship
from app.shared.base import TenantBase

class Species(TenantBase):
    __tablename__ = "species"
    
    name = Column(String, nullable=False)
    category = Column(String, nullable=False)  # animal, bird
    description = Column(String, nullable=True)

class HerdFlock(TenantBase):
    __tablename__ = "herd_flocks"
    
    name = Column(String, nullable=False)
    species_id = Column(Integer, ForeignKey("species.id"), nullable=False)
    purpose = Column(String, nullable=False)  # breeding, fattening, layer, broiler, other
    start_date = Column(DateTime, nullable=False)
    initial_qty = Column(Numeric(15, 3), default=0)
    current_qty = Column(Numeric(15, 3), default=0)
    
    species = relationship("Species")
    events = relationship("AnimalEvent", back_populates="herd_flock", cascade="all, delete-orphan")

class AnimalEvent(TenantBase):
    __tablename__ = "animal_events"
    
    herd_id = Column(Integer, ForeignKey("herd_flocks.id"), nullable=False)
    event_type = Column(String, nullable=False)  # purchase, birth, transfer, sale, mortality, health
    qty = Column(Numeric(15, 3), nullable=False)
    date = Column(DateTime, nullable=False)
    notes = Column(String, nullable=True)
    ref_document_type = Column(String, nullable=True)  # sales_invoice, purchase_order, etc.
    ref_document_id = Column(Integer, nullable=True)
    
    herd_flock = relationship("HerdFlock", back_populates="events")

