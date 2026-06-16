"""Purchase and sales requisitions with multi-step approval."""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Numeric, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.shared.base import TenantBase


class PurchaseRequisition(TenantBase):
    __tablename__ = "purchase_requisitions"
    __table_args__ = (UniqueConstraint("tenant_id", "doc_number", name="uq_pr_tenant_doc"),)

    doc_number = Column(String(64), nullable=False, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True, index=True)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=True, index=True)
    needed_by = Column(DateTime, nullable=True)
    purpose = Column(Text, nullable=True)
    status = Column(String(32), nullable=False, default="draft", index=True)
    converted_po_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=True, index=True)

    supplier = relationship("Supplier", foreign_keys=[supplier_id])
    warehouse = relationship("Warehouse", foreign_keys=[warehouse_id])
    converted_po = relationship("PurchaseOrder", foreign_keys=[converted_po_id])
    lines = relationship(
        "PurchaseRequisitionLine",
        back_populates="purchase_requisition",
        cascade="all, delete-orphan",
    )


class PurchaseRequisitionLine(TenantBase):
    __tablename__ = "purchase_requisition_lines"

    pr_id = Column(Integer, ForeignKey("purchase_requisitions.id"), nullable=False, index=True)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    qty = Column(Numeric(15, 3), nullable=False)
    est_unit_price = Column(Numeric(15, 2), nullable=False, default=0)

    purchase_requisition = relationship("PurchaseRequisition", back_populates="lines")
    item = relationship("Item")


class SalesRequisition(TenantBase):
    __tablename__ = "sales_requisitions"
    __table_args__ = (UniqueConstraint("tenant_id", "doc_number", name="uq_sr_tenant_doc"),)

    doc_number = Column(String(64), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    requested_delivery = Column(DateTime, nullable=True)
    purpose = Column(Text, nullable=True)
    status = Column(String(32), nullable=False, default="draft", index=True)
    converted_invoice_id = Column(Integer, ForeignKey("sales_invoices.id"), nullable=True, index=True)

    customer = relationship("Customer", foreign_keys=[customer_id])
    converted_invoice = relationship("SalesInvoice", foreign_keys=[converted_invoice_id])
    lines = relationship(
        "SalesRequisitionLine",
        back_populates="sales_requisition",
        cascade="all, delete-orphan",
    )


class SalesRequisitionLine(TenantBase):
    __tablename__ = "sales_requisition_lines"

    sr_id = Column(Integer, ForeignKey("sales_requisitions.id"), nullable=False, index=True)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    qty = Column(Numeric(15, 3), nullable=False)
    unit_price = Column(Numeric(15, 2), nullable=False, default=0)

    sales_requisition = relationship("SalesRequisition", back_populates="lines")
    item = relationship("Item")


class RequisitionApprovalLog(TenantBase):
    """Append-only audit trail for purchase or sales requisitions."""

    __tablename__ = "requisition_approval_logs"

    requisition_kind = Column(String(16), nullable=False, index=True)  # purchase | sales
    requisition_id = Column(Integer, nullable=False, index=True)
    action = Column(String(32), nullable=False)  # submit | approve_dept | approve_exec | reject
    notes = Column(Text, nullable=True)
    actor_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    actor = relationship("User", foreign_keys=[actor_user_id])
