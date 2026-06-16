from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Numeric
from sqlalchemy.orm import relationship
from app.shared.base import TenantBase

class UOM(TenantBase):
    __tablename__ = "uoms"
    
    code = Column(String, nullable=False)
    name = Column(String, nullable=False)

class ItemCategory(TenantBase):
    __tablename__ = "item_categories"
    
    name = Column(String, nullable=False)
    parent_id = Column(Integer, ForeignKey("item_categories.id"), nullable=True)

class Item(TenantBase):
    __tablename__ = "items"
    
    sku = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)  # raw_material, finished_good, feed, flour, fuel, animal, bird, service
    uom_id = Column(Integer, ForeignKey("uoms.id"), nullable=False)
    category_id = Column(Integer, ForeignKey("item_categories.id"), nullable=True)
    is_stock_tracked = Column(Boolean, default=True)
    # Primary ERP bucket: inventory | non_inventory | service | other (see inventory_kind.py)
    inventory_kind = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    standard_cost = Column(Numeric(15, 2), nullable=True)
    
    uom = relationship("UOM")
    category = relationship("ItemCategory")

