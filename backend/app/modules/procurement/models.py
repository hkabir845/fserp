from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Numeric, Boolean
from sqlalchemy.orm import relationship
from app.shared.base import TenantBase

class Supplier(TenantBase):
    __tablename__ = "suppliers"
    
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

class PurchaseOrder(TenantBase):
    __tablename__ = "purchase_orders"
    
    po_number = Column(String, nullable=False, unique=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False)
    source_purchase_requisition_id = Column(
        Integer, ForeignKey("purchase_requisitions.id"), nullable=True, index=True
    )
    status = Column(String, nullable=False, default="draft")  # draft, posted, cancelled
    order_date = Column(DateTime, nullable=False)
    expected_date = Column(DateTime, nullable=True)
    total_amount = Column(Numeric(15, 2), default=0)
    
    supplier = relationship("Supplier")
    lines = relationship("PurchaseOrderLine", back_populates="purchase_order", cascade="all, delete-orphan")

class PurchaseOrderLine(TenantBase):
    __tablename__ = "purchase_order_lines"
    
    po_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    qty = Column(Numeric(15, 3), nullable=False)
    qty_received = Column(Numeric(15, 3), nullable=False, default=0)
    unit_price = Column(Numeric(15, 2), nullable=False)
    total = Column(Numeric(15, 2), nullable=False)
    
    purchase_order = relationship("PurchaseOrder", back_populates="lines")
    item = relationship("Item")

class GoodsReceipt(TenantBase):
    __tablename__ = "goods_receipts"
    
    grn_number = Column(String, nullable=False, unique=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    ref_po_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=True)
    status = Column(String, nullable=False, default="draft")
    receipt_date = Column(DateTime, nullable=False)
    
    supplier = relationship("Supplier")
    warehouse = relationship("Warehouse")
    purchase_order = relationship("PurchaseOrder")
    lines = relationship("GoodsReceiptLine", back_populates="goods_receipt", cascade="all, delete-orphan")

class GoodsReceiptLine(TenantBase):
    __tablename__ = "goods_receipt_lines"
    
    grn_id = Column(Integer, ForeignKey("goods_receipts.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    qty = Column(Numeric(15, 3), nullable=False)
    unit_cost = Column(Numeric(15, 2), nullable=False)
    total = Column(Numeric(15, 2), nullable=False)
    batch_no = Column(String, nullable=True)
    
    goods_receipt = relationship("GoodsReceipt", back_populates="lines")
    item = relationship("Item")

class VendorBill(TenantBase):
    __tablename__ = "vendor_bills"
    
    bill_number = Column(String, nullable=False, unique=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False)
    ref_grn_id = Column(Integer, ForeignKey("goods_receipts.id"), nullable=True)
    status = Column(String, nullable=False, default="draft")
    bill_date = Column(DateTime, nullable=False)
    due_date = Column(DateTime, nullable=True)
    total_amount = Column(Numeric(15, 2), nullable=False)
    
    supplier = relationship("Supplier")
    goods_receipt = relationship("GoodsReceipt")
    lines = relationship("VendorBillLine", back_populates="vendor_bill", cascade="all, delete-orphan")

class VendorBillLine(TenantBase):
    __tablename__ = "vendor_bill_lines"
    
    bill_id = Column(Integer, ForeignKey("vendor_bills.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    qty = Column(Numeric(15, 3), nullable=False)
    unit_price = Column(Numeric(15, 2), nullable=False)
    total = Column(Numeric(15, 2), nullable=False)
    
    vendor_bill = relationship("VendorBill", back_populates="lines")
    item = relationship("Item")

