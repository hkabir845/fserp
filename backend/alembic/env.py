from logging.config import fileConfig
from sqlalchemy import engine_from_config
from sqlalchemy import pool
from alembic import context
import os
import sys

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.db.session import Base
from app.core.config import settings

# Import all models
from app.modules.tenancy.models import Tenant, User, Role
from app.modules.catalog.models import UOM, Item, ItemCategory
from app.modules.inventory.models import Warehouse, StockLedger
from app.modules.procurement.models import Supplier, PurchaseOrder, PurchaseOrderLine, GoodsReceipt, GoodsReceiptLine, VendorBill, VendorBillLine
from app.modules.sales.models import Customer, SalesInvoice, SalesInvoiceLine, Receipt
from app.modules.manufacturing.models import (
    Bom,
    BomLine,
    ProductionBatch,
    ProductionConsumption,
    ManufacturingProductionOutput,
    Scrap,
)
from app.modules.feed_manufacturing.models import FeedProduct, Ingredient, FeedBom, FeedBomLine, ProductionOrder, ProductionOrderLine, BatchQC, Silo, SiloTransaction
from app.modules.livestock.models import Species, HerdFlock, AnimalEvent
from app.modules.transport.models import Vehicle, Driver, Trip, DeliveryNote, TripExpense
from app.modules.fuel_station.models import FuelTank, FuelTxn, VehicleFuelIssue
from app.modules.accounting.models import Account, JournalEntry, JournalLine
from app.modules.payroll.models import Employee, SalaryStructure, PayrollRun, Payslip
from app.modules.platform.models import PlatformUser, SubscriptionPlan, TenantSubscription, SubscriptionInvoice, PlatformAccount, PlatformJournalEntry, PlatformJournalLine, TenantActivity
from app.modules.loans.models import Loan, LoanScheduleLine, LoanPayment
from app.modules.lc.models import LetterOfCredit, LCAmendment
from app.modules.hr.models import LeaveRequest, AttendanceDay
from app.modules.crm.models import CrmActivity
from app.modules.workshop.models import WorkshopJob, WorkshopJobAssignment
from app.modules.lab.models import LabParameter, LabSpecification, LabSpecificationLine, LabSample, LabResult

config = context.config
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

