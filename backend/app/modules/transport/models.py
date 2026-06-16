from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Numeric, Boolean
from sqlalchemy.orm import relationship
from app.shared.base import TenantBase

class Vehicle(TenantBase):
    __tablename__ = "vehicles"
    
    reg_no = Column(String, nullable=False, unique=True, index=True)
    type = Column(String, nullable=False)  # suv, sedan, truck, van, etc. (free text / UI list)
    capacity = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)

class Driver(TenantBase):
    __tablename__ = "drivers"
    
    name = Column(String, nullable=False)
    phone = Column(String, nullable=True)
    license_number = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)

class Trip(TenantBase):
    __tablename__ = "trips"
    
    trip_number = Column(String, nullable=False, unique=True, index=True)
    trip_type = Column(String, nullable=False)  # own_delivery, third_party
    vehicle_id = Column(Integer, ForeignKey("vehicles.id"), nullable=False)
    driver_id = Column(Integer, ForeignKey("drivers.id"), nullable=False)
    origin = Column(String, nullable=True)
    destination = Column(String, nullable=True)
    start_date = Column(DateTime, nullable=True)
    end_date = Column(DateTime, nullable=True)
    status = Column(String, nullable=False, default="draft")  # draft, in_progress, completed, cancelled
    
    vehicle = relationship("Vehicle")
    driver = relationship("Driver")
    delivery_notes = relationship("DeliveryNote", back_populates="trip", cascade="all, delete-orphan")
    expenses = relationship("TripExpense", back_populates="trip", cascade="all, delete-orphan")

class DeliveryNote(TenantBase):
    __tablename__ = "delivery_notes"
    
    dn_number = Column(String, nullable=False, unique=True, index=True)
    trip_id = Column(Integer, ForeignKey("trips.id"), nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    ref_invoice_id = Column(Integer, ForeignKey("sales_invoices.id"), nullable=True)
    status = Column(String, nullable=False, default="draft")
    
    trip = relationship("Trip", back_populates="delivery_notes")
    customer = relationship("Customer", foreign_keys=[customer_id])
    invoice = relationship("SalesInvoice", foreign_keys=[ref_invoice_id])

class TripExpense(TenantBase):
    __tablename__ = "trip_expenses"
    
    trip_id = Column(Integer, ForeignKey("trips.id"), nullable=False)
    expense_type = Column(String, nullable=False)  # fuel, toll, maintenance, allowance, other
    amount = Column(Numeric(15, 2), nullable=False)
    date = Column(DateTime, nullable=False)
    notes = Column(String, nullable=True)
    
    trip = relationship("Trip", back_populates="expenses")

