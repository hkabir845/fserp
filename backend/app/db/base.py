from app.db.session import Base
from app.db.session import engine

# Import all models so Alembic can detect them
from app.modules.tenancy.models import Tenant, User, Role
from app.modules.catalog.models import UOM, Item, ItemCategory
from app.modules.inventory.models import Warehouse, StockLedger
from app.modules.procurement.models import Supplier, PurchaseOrder, PurchaseOrderLine, GoodsReceipt, GoodsReceiptLine, VendorBill, VendorBillLine
from app.modules.requisitions.models import (
    PurchaseRequisition,
    PurchaseRequisitionLine,
    SalesRequisition,
    SalesRequisitionLine,
    RequisitionApprovalLog,
)
from app.modules.sales.models import Customer, SalesInvoice, SalesInvoiceLine, Receipt
from app.modules.manufacturing.models import (
    Bom,
    BomLine,
    ProductionBatch,
    ProductionConsumption,
    ManufacturingProductionOutput,
    Scrap,
)
from app.modules.feed_manufacturing.models import (
    FeedProduct, Ingredient, FeedBom, FeedBomLine, 
    ProductionOrder, ProductionOrderLine, ProductionStep, ProductionOutput, PackingOperation,
    BatchQC, QCTarget, AuditLog
)
from app.modules.feed_manufacturing.preformulation_models import PreFormulation, PreFormulationLine
from app.modules.inventory.models import Warehouse, InventoryLot, StockLedger, StockBalance
from app.modules.livestock.models import Species, HerdFlock, AnimalEvent
from app.modules.transport.models import Vehicle, Driver, Trip, DeliveryNote, TripExpense
from app.modules.fuel_station.models import FuelTank, FuelTxn, VehicleFuelIssue
from app.modules.accounting.models import Account, JournalEntry, JournalLine, CostCenter
from app.modules.payroll.models import Employee, SalaryStructure, PayrollRun, Payslip
from app.modules.platform.models import PlatformUser, SubscriptionPlan, TenantSubscription, SubscriptionInvoice, PlatformAccount, PlatformJournalEntry, PlatformJournalLine, TenantActivity, PlatformSettings, Currency, UnitOfMeasure, PlatformBroadcast
from app.modules.tenancy.settings_models import TenantSettings, TenantCurrency, TenantUOM
from app.modules.crm.models import CrmActivity, CrmLead
from app.modules.loans.models import Loan, LoanPayment, LoanScheduleLine
from app.modules.lc.models import LetterOfCredit, LCAmendment
from app.modules.hr.models import AttendanceDay, LeaveRequest
from app.modules.expenses.models import ExpenseClaim, ExpenseClaimLine
from app.modules.cards.models import EmployeeBusinessCard
from app.modules.workshop.models import WorkshopJob, WorkshopJobAssignment
from app.modules.lab.models import LabParameter, LabResult, LabSample, LabSpecification, LabSpecificationLine
from app.modules.reports.models import CustomReport

def init_db():
    """Initialize database - create all tables"""
    Base.metadata.create_all(bind=engine)

