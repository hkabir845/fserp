from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Numeric, Boolean
from sqlalchemy.orm import relationship
from app.shared.base import TenantBase

class Customer(TenantBase):
    __tablename__ = "customers"
    
    name = Column(String, nullable=False)
    phone = Column(String, nullable=True)
    email = Column(String, nullable=True)
    address = Column(String, nullable=True)
    gstin = Column(String, nullable=True)
    bank_name = Column(String, nullable=True)
    bank_account_no = Column(String, nullable=True)
    bank_branch = Column(String, nullable=True)
    bank_routing_or_ifsc = Column(String, nullable=True)
    opening_balance = Column(Numeric(15, 2), nullable=False, default=0)
    opening_balance_as_of = Column(DateTime, nullable=True)
    gl_account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True, index=True)
    is_active = Column(Boolean, default=True)

    gl_account = relationship("Account", foreign_keys=[gl_account_id])

class SalesInvoice(TenantBase):
    __tablename__ = "sales_invoices"
    
    invoice_number = Column(String, nullable=False, unique=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    source_sales_requisition_id = Column(
        Integer, ForeignKey("sales_requisitions.id"), nullable=True, index=True
    )
    status = Column(String, nullable=False, default="draft")
    invoice_date = Column(DateTime, nullable=False)
    due_date = Column(DateTime, nullable=True)
    total_amount = Column(Numeric(15, 2), nullable=False)
    
    customer = relationship("Customer")
    lines = relationship("SalesInvoiceLine", back_populates="sales_invoice", cascade="all, delete-orphan")

class SalesInvoiceLine(TenantBase):
    __tablename__ = "sales_invoice_lines"
    
    invoice_id = Column(Integer, ForeignKey("sales_invoices.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    qty = Column(Numeric(15, 3), nullable=False)
    unit_price = Column(Numeric(15, 2), nullable=False)
    total = Column(Numeric(15, 2), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=True)
    
    sales_invoice = relationship("SalesInvoice", back_populates="lines")
    item = relationship("Item")
    warehouse = relationship("Warehouse")

class Receipt(TenantBase):
    __tablename__ = "receipts"
    
    receipt_number = Column(String, nullable=False, unique=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    ref_invoice_id = Column(Integer, ForeignKey("sales_invoices.id"), nullable=True)
    amount = Column(Numeric(15, 2), nullable=False)
    method = Column(String, nullable=False)  # cash, bank, cheque
    receipt_date = Column(DateTime, nullable=False)
    
    customer = relationship("Customer")
    invoice = relationship("SalesInvoice")

