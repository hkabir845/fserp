from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Numeric
from sqlalchemy.orm import relationship
from app.shared.base import TenantBase

class FuelTank(TenantBase):
    __tablename__ = "fuel_tanks"

    name = Column(String, nullable=False)
    # diesel | octane — aligns tank to grade; item still defines SKU/pricing (e.g. FS-FUEL-DIESEL).
    fuel_grade = Column(String, nullable=False, default="diesel")
    fuel_item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    capacity_liters = Column(Numeric(15, 3), nullable=False)
    current_stock_liters = Column(Numeric(15, 3), default=0)
    # WAC per liter in tank currency; updated on each receipt; used for internal vehicle issues (GL inventory relief).
    moving_avg_unit_cost = Column(Numeric(15, 4), nullable=True)

    fuel_item = relationship("Item")

class FuelTxn(TenantBase):
    __tablename__ = "fuel_txns"

    txn_type = Column(String, nullable=False)  # purchase, issue_internal, sale_external, adjustment
    fuel_item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    qty_liters = Column(Numeric(15, 3), nullable=False)
    unit_cost = Column(Numeric(15, 2), nullable=False)
    ref_type = Column(String, nullable=True)  # vendor_bill, sales_invoice, vehicle_fuel_issue, purchase_order_line, etc.
    ref_id = Column(Integer, nullable=True)
    date = Column(DateTime, nullable=False, index=True)
    tank_id = Column(Integer, ForeignKey("fuel_tanks.id"), nullable=True)
    po_line_id = Column(Integer, ForeignKey("purchase_order_lines.id"), nullable=True)
    journal_entry_id = Column(Integer, ForeignKey("journal_entries.id"), nullable=True)

    fuel_item = relationship("Item")
    tank = relationship("FuelTank")
    purchase_order_line = relationship("PurchaseOrderLine")
    journal_entry = relationship("JournalEntry")

class VehicleFuelIssue(TenantBase):
    __tablename__ = "vehicle_fuel_issues"

    vehicle_id = Column(Integer, ForeignKey("vehicles.id"), nullable=False)
    fuel_item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    qty_liters = Column(Numeric(15, 3), nullable=False)
    date = Column(DateTime, nullable=False)
    odometer = Column(Numeric(15, 2), nullable=True)
    notes = Column(String, nullable=True)
    ref_fuel_txn_id = Column(Integer, ForeignKey("fuel_txns.id"), nullable=True)
    cost_center_id = Column(Integer, ForeignKey("cost_centers.id"), nullable=True)

    vehicle = relationship("Vehicle")
    fuel_item = relationship("Item")
    fuel_txn = relationship("FuelTxn")
    cost_center = relationship("CostCenter")

