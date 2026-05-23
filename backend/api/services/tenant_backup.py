"""
Tenant-scoped backup (export) and restore (full replace) for FSERP.

Uses Django's serialization format (python/json compatible). Restore clears the
tenant in FK-safe order (PROTECT chains), then reloads from the bundle.

Schema v2 includes full ERP + aquaculture (incl. Data Bank closes) + inventory stock/transfer
coverage, plus the tenant group (Organization) for portal settings.
Schema v1 backups restore but omit aquaculture/stock modules (legacy).

PasswordResetToken rows are intentionally excluded from backups (single-use secrets).
Tenant delete/restore purges any pending reset tokens for that company's users.
"""
from __future__ import annotations

import json
import logging
from copy import deepcopy
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any, Iterable
from uuid import UUID

from django.core import serializers
from django.db import transaction
from django.db.models import Count, Q, QuerySet
from django.utils.duration import duration_iso_string
from django.utils.functional import Promise

logger = logging.getLogger(__name__)

from api.utils.password_reset_tokens import (
    delete_password_reset_tokens_for_user_ids,
    purge_password_reset_tokens_for_company,
)

from api.models import (
    AquacultureDataBankPondClose,
    AquacultureBiomassSample,
    AquacultureExpense,
    AquacultureExpenseInventoryLine,
    AquacultureExpensePondShare,
    AquacultureFeedingAdvice,
    AquacultureFinancingAllocation,
    AquacultureFishPondTransfer,
    AquacultureFishPondTransferLine,
    AquacultureFishSale,
    AquacultureFishStockLedger,
    AquacultureLandlord,
    AquacultureLandlordLedgerEntry,
    AquacultureLandlordPondShare,
    AquaculturePond,
    AquaculturePondPlOpening,
    AquaculturePondProfitTransfer,
    AquacultureProductionCycle,
    AquacultureWarehouseGroup,
    PondWarehouseInterPondTransfer,
    PondWarehouseInterPondTransferLine,
    BankAccount,
    BankDeposit,
    Bill,
    BillLine,
    Broadcast,
    BroadcastRead,
    ChartOfAccount,
    Company,
    CompanyRole,
    Contract,
    Customer,
    Dispenser,
    Employee,
    EmployeeLedgerEntry,
    FundTransfer,
    InventoryTransfer,
    InventoryTransferLine,
    Invoice,
    InvoiceLine,
    Island,
    Item,
    ItemPondStock,
    ItemStationStock,
    JournalEntry,
    JournalEntryLine,
    Loan,
    LoanCounterparty,
    LoanDisbursement,
    LoanInterestAccrual,
    LoanRepayment,
    Meter,
    Nozzle,
    Organization,
    Payment,
    PaymentBillAllocation,
    PaymentInvoiceAllocation,
    PayrollRun,
    PayrollRunPondAllocation,
    PondWarehouseStockReceipt,
    PondWarehouseStockReceiptLine,
    ShiftSession,
    ShiftTemplate,
    Station,
    SubscriptionLedgerInvoice,
    Tank,
    TankDip,
    Tax,
    TaxRate,
    TenantPlatformReleaseEvent,
    TenantReportingCategory,
    User,
    Vendor,
)

BACKUP_SCHEMA_VERSION = 2
SUPPORTED_BACKUP_SCHEMA_VERSIONS = frozenset({1, 2})
RESTORE_CONFIRM_PHRASE = "DELETE_ALL_TENANT_DATA"

# Django app labels present in every serialized record (for coverage checks / tests).
EXPECTED_BACKUP_MODELS: tuple[str, ...] = (
    "api.organization",
    "api.company",
    "api.contract",
    "api.companyrole",
    "api.tenantplatformreleaseevent",
    "api.user",
    "api.broadcast",
    "api.broadcastread",
    "api.chartofaccount",
    "api.tenantreportingcategory",
    "api.station",
    "api.item",
    "api.customer",
    "api.vendor",
    "api.employee",
    "api.tax",
    "api.shifttemplate",
    "api.payrollrun",
    "api.payrollrunpondallocation",
    "api.loancounterparty",
    "api.bankaccount",
    "api.subscriptionledgerinvoice",
    "api.bankdeposit",
    "api.aquaculturewarehousegroup",
    "api.aquaculturepond",
    "api.aquaculturepondplopening",
    "api.aquaculturelandlord",
    "api.aquacultureproductioncycle",
    "api.itemstationstock",
    "api.itempondstock",
    "api.aquaculturelandlordpondshare",
    "api.tank",
    "api.island",
    "api.dispenser",
    "api.meter",
    "api.nozzle",
    "api.journalentry",
    "api.fundtransfer",
    "api.shiftsession",
    "api.inventorytransfer",
    "api.inventorytransferline",
    "api.pondwarehousestockreceipt",
    "api.pondwarehousestockreceiptline",
    "api.pondwarehouseinterpondtransfer",
    "api.pondwarehouseinterpondtransferline",
    "api.invoice",
    "api.invoiceline",
    "api.bill",
    "api.billline",
    "api.payment",
    "api.paymentinvoiceallocation",
    "api.paymentbillallocation",
    "api.tankdip",
    "api.loan",
    "api.loandisbursement",
    "api.loanrepayment",
    "api.loaninterestaccrual",
    "api.journalentryline",
    "api.aquacultureexpense",
    "api.aquacultureexpenseinventoryline",
    "api.aquacultureexpensepondshare",
    "api.aquaculturefishsale",
    "api.aquaculturebiomasssample",
    "api.aquaculturefishpondtransfer",
    "api.aquaculturefishpondtransferline",
    "api.aquaculturefishstockledger",
    "api.aquaculturepondprofittransfer",
    "api.aquaculturefinancingallocation",
    "api.aquaculturefeedingadvice",
    "api.aquaculturedatabankpondclose",
    "api.aquaculturelandlordledgerentry",
    "api.taxrate",
    "api.employeeledgerentry",
)

# Nullable FKs to JournalEntry that may appear before journal rows in the backup stream.
_DEFERRED_JOURNAL_ENTRY_FKS: dict[str, tuple[str, ...]] = {
    "api.customer": ("opening_balance_journal",),
    "api.vendor": ("opening_balance_journal",),
    "api.employee": ("opening_balance_journal",),
    "api.payrollrun": ("salary_journal",),
    "api.loancounterparty": ("opening_balance_journal",),
    "api.aquaculturepond": ("pl_opening_journal",),
    "api.aquaculturelandlord": ("opening_balance_journal",),
    "api.loandisbursement": ("journal_entry",),
    "api.loanrepayment": ("journal_entry", "reversal_journal_entry"),
    "api.loaninterestaccrual": ("journal_entry", "reversal_journal_entry"),
    "api.aquaculturefishstockledger": ("journal_entry",),
    "api.aquaculturelandlordledgerentry": ("journal_entry",),
    "api.aquaculturepondprofittransfer": ("journal_entry",),
}

DeferredJournalFkPatch = tuple[str, int, str, int]


def _prepare_restore_records(
    records: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[DeferredJournalFkPatch]]:
    """
    Strip nullable JournalEntry FKs before deserialize so parent rows can load
    before their journal entries, then patch links after the full bundle is saved.
    """
    restore_records = deepcopy(records)
    patches: list[DeferredJournalFkPatch] = []
    for rec in restore_records:
        for field in _DEFERRED_JOURNAL_ENTRY_FKS.get(rec["model"], ()):
            je_pk = rec["fields"].pop(field, None)
            if je_pk is not None:
                patches.append((rec["model"], int(rec["pk"]), field, int(je_pk)))
    return restore_records, patches


def _apply_deferred_journal_entry_fks(patches: list[DeferredJournalFkPatch]) -> None:
    from django.apps import apps

    for model_label, pk, field, je_pk in patches:
        app_label, model_name = model_label.split(".", 1)
        model = apps.get_model(app_label, model_name)
        updated = model.objects.filter(pk=pk).update(**{field: je_pk})
        if updated != 1:
            logger.warning(
                "restore deferred journal FK: %s pk=%s field=%s je_pk=%s updated=%s",
                model_label,
                pk,
                field,
                je_pk,
                updated,
            )


def _sanitize_for_json(obj: Any) -> Any:
    """
    Recursively convert the bundle to JSON-safe primitives (dict/list/str/number/bool/null).
    """
    if obj is None:
        return None
    if isinstance(obj, (bool, str, int, float)):
        return obj
    if isinstance(obj, dict):
        return {str(k): _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize_for_json(v) for v in obj]
    if isinstance(obj, datetime):
        r = obj.isoformat()
        if obj.microsecond:
            r = r[:23] + r[26:]
        if r.endswith("+00:00"):
            r = r[:-6] + "Z"
        return r
    if isinstance(obj, date):
        return obj.isoformat()
    if isinstance(obj, time):
        return obj.isoformat()
    if isinstance(obj, timedelta):
        return duration_iso_string(obj)
    if isinstance(obj, Decimal):
        return str(obj)
    if isinstance(obj, UUID):
        return str(obj)
    if isinstance(obj, (set, frozenset)):
        return [_sanitize_for_json(v) for v in obj]
    if isinstance(obj, Promise):
        return str(obj)
    if isinstance(obj, bytes):
        try:
            return obj.decode("utf-8")
        except UnicodeDecodeError:
            logger.warning("backup JSON: non-UTF8 bytes, using repr")
            return repr(obj)
    if isinstance(obj, memoryview):
        return _sanitize_for_json(bytes(obj))

    logger.warning("backup JSON sanitize str() fallback: %s", type(obj).__name__)
    return str(obj)


def _tenant_user_ids(company_id: int) -> list[int]:
    return list(User.objects.filter(company_id=company_id).values_list("id", flat=True))


def _tenant_broadcast_reads_qs(company_id: int) -> QuerySet[BroadcastRead]:
    user_ids = _tenant_user_ids(company_id)
    if not user_ids:
        return BroadcastRead.objects.none()
    return BroadcastRead.objects.filter(user_id__in=user_ids)


def delete_tenant_company_data(company_id: int) -> None:
    """
    Remove all ERP rows for a company in FK-safe order (PROTECT chains break Company.delete()).
    """
    cid = company_id

    # --- Deepest children (lines, allocations, rates) ---
    TaxRate.objects.filter(tax__company_id=cid).delete()
    EmployeeLedgerEntry.objects.filter(employee__company_id=cid).delete()
    PaymentInvoiceAllocation.objects.filter(payment__company_id=cid).delete()
    PaymentBillAllocation.objects.filter(payment__company_id=cid).delete()
    BillLine.objects.filter(bill__company_id=cid).delete()
    InvoiceLine.objects.filter(invoice__company_id=cid).delete()
    JournalEntryLine.objects.filter(journal_entry__company_id=cid).delete()
    LoanInterestAccrual.objects.filter(loan__company_id=cid).delete()
    LoanRepayment.objects.filter(loan__company_id=cid).delete()
    LoanDisbursement.objects.filter(loan__company_id=cid).delete()
    PondWarehouseStockReceiptLine.objects.filter(receipt__company_id=cid).delete()
    PondWarehouseInterPondTransferLine.objects.filter(transfer__company_id=cid).delete()
    InventoryTransferLine.objects.filter(transfer__company_id=cid).delete()
    AquacultureExpenseInventoryLine.objects.filter(expense__company_id=cid).delete()
    AquacultureExpensePondShare.objects.filter(expense__company_id=cid).delete()
    AquacultureFishPondTransferLine.objects.filter(transfer__company_id=cid).delete()
    AquacultureLandlordLedgerEntry.objects.filter(landlord__company_id=cid).delete()
    AquacultureLandlordPondShare.objects.filter(landlord__company_id=cid).delete()
    PayrollRunPondAllocation.objects.filter(payroll_run__company_id=cid).delete()

    tenant_user_ids = _tenant_user_ids(cid)
    if tenant_user_ids:
        BroadcastRead.objects.filter(user_id__in=tenant_user_ids).delete()
        delete_password_reset_tokens_for_user_ids(tenant_user_ids)

    # --- Documents that PROTECT stations, items, COA, or loans ---
    AquacultureFinancingAllocation.objects.filter(company_id=cid).delete()
    PondWarehouseStockReceipt.objects.filter(company_id=cid).delete()
    PondWarehouseInterPondTransfer.objects.filter(company_id=cid).delete()
    InventoryTransfer.objects.filter(company_id=cid).delete()
    BankDeposit.objects.filter(company_id=cid).delete()
    AquacultureFeedingAdvice.objects.filter(company_id=cid).delete()
    AquaculturePondProfitTransfer.objects.filter(company_id=cid).delete()
    AquacultureBiomassSample.objects.filter(company_id=cid).delete()
    AquacultureFishSale.objects.filter(company_id=cid).delete()
    AquacultureFishPondTransfer.objects.filter(company_id=cid).delete()
    AquacultureFishStockLedger.objects.filter(company_id=cid).delete()
    AquacultureExpense.objects.filter(company_id=cid).delete()
    AquacultureProductionCycle.objects.filter(company_id=cid).delete()
    AquacultureDataBankPondClose.objects.filter(company_id=cid).delete()

    while Loan.objects.filter(company_id=cid).exists():
        leaf = (
            Loan.objects.filter(company_id=cid)
            .annotate(_nchild=Count("child_loans"))
            .filter(_nchild=0)
        )
        if not leaf.exists():
            raise ValueError("Loan hierarchy could not be cleared (unexpected cycle).")
        leaf.delete()

    TankDip.objects.filter(company_id=cid).delete()
    Payment.objects.filter(company_id=cid).delete()
    Bill.objects.filter(company_id=cid).delete()
    Invoice.objects.filter(company_id=cid).delete()
    ShiftSession.objects.filter(company_id=cid).delete()
    FundTransfer.objects.filter(company_id=cid).delete()
    JournalEntry.objects.filter(company_id=cid).delete()
    Nozzle.objects.filter(company_id=cid).delete()
    Meter.objects.filter(company_id=cid).delete()
    Dispenser.objects.filter(company_id=cid).delete()
    Island.objects.filter(company_id=cid).delete()
    Tank.objects.filter(company_id=cid).delete()
    SubscriptionLedgerInvoice.objects.filter(company_id=cid).delete()
    BankAccount.objects.filter(company_id=cid).delete()
    LoanCounterparty.objects.filter(company_id=cid).delete()
    PayrollRun.objects.filter(company_id=cid).delete()
    ShiftTemplate.objects.filter(company_id=cid).delete()
    Tax.objects.filter(company_id=cid).delete()
    Employee.objects.filter(company_id=cid).delete()
    ItemStationStock.objects.filter(company_id=cid).delete()
    ItemPondStock.objects.filter(company_id=cid).delete()
    AquaculturePondPlOpening.objects.filter(company_id=cid).delete()
    AquaculturePond.objects.filter(company_id=cid).delete()
    AquacultureWarehouseGroup.objects.filter(company_id=cid).delete()
    AquacultureLandlord.objects.filter(company_id=cid).delete()
    Vendor.objects.filter(company_id=cid).delete()
    Customer.objects.filter(company_id=cid).delete()
    Station.objects.filter(company_id=cid).delete()
    Item.objects.filter(company_id=cid).delete()

    while ChartOfAccount.objects.filter(company_id=cid).exists():
        leaf = (
            ChartOfAccount.objects.filter(company_id=cid)
            .annotate(_nch=Count("children"))
            .filter(_nch=0)
        )
        if not leaf.exists():
            raise ValueError("Chart of accounts could not be cleared (unexpected cycle).")
        leaf.delete()

    Broadcast.objects.filter(company_id=cid).delete()
    User.objects.filter(company_id=cid).delete()
    Contract.objects.filter(company_id=cid).delete()
    CompanyRole.objects.filter(company_id=cid).delete()
    TenantReportingCategory.objects.filter(company_id=cid).delete()
    TenantPlatformReleaseEvent.objects.filter(company_id=cid).delete()
    Company.objects.filter(pk=cid).delete()


def delete_station_operational_data(
    company_id: int,
    station_id: int,
    *,
    remove_station_record: bool = True,
) -> dict[str, int]:
    """
    Remove forecourt / operations data for a single station within a tenant.

    Does **not** delete company-wide accounting (invoices, payments, GL, customers, items, etc.).
    """
    cid = company_id
    sid = station_id

    st = Station.objects.filter(pk=sid, company_id=cid).first()
    if not st:
        raise ValueError("Station not found for this company.")

    counts: dict[str, int] = {}

    def _del(label: str, qs):
        n, _ = qs.delete()
        counts[label] = counts.get(label, 0) + int(n)

    InventoryTransfer.objects.filter(company_id=cid).filter(
        Q(from_station_id=sid) | Q(to_station_id=sid)
    ).delete()
    PondWarehouseStockReceipt.objects.filter(company_id=cid, from_station_id=sid).delete()

    _del("shift_sessions", ShiftSession.objects.filter(company_id=cid, station_id=sid))
    _del("tank_dips", TankDip.objects.filter(company_id=cid, tank__station_id=sid))
    _del("nozzles", Nozzle.objects.filter(company_id=cid, tank__station_id=sid))
    _del("meters", Meter.objects.filter(company_id=cid, dispenser__island__station_id=sid))
    _del("dispensers", Dispenser.objects.filter(company_id=cid, island__station_id=sid))
    _del("islands", Island.objects.filter(company_id=cid, station_id=sid))
    _del("tanks", Tank.objects.filter(company_id=cid, station_id=sid))
    ItemStationStock.objects.filter(company_id=cid, station_id=sid).delete()

    if remove_station_record:
        _del("stations", Station.objects.filter(pk=sid, company_id=cid))

    return counts


def _topo_chart_accounts(company_id: int) -> list[ChartOfAccount]:
    qs = ChartOfAccount.objects.filter(company_id=company_id)
    by_id = {o.id: o for o in qs}
    remaining = set(by_id.keys())
    ordered: list[ChartOfAccount] = []
    while remaining:
        batch = [
            pk
            for pk in remaining
            if by_id[pk].parent_id is None or by_id[pk].parent_id not in remaining
        ]
        if not batch:
            raise ValueError("Chart of accounts has a circular parent reference.")
        for pk in sorted(batch):
            ordered.append(by_id[pk])
            remaining.discard(pk)
    return ordered


def _topo_loans(company_id: int) -> list[Loan]:
    qs = Loan.objects.filter(company_id=company_id)
    by_id = {o.id: o for o in qs}
    remaining = set(by_id.keys())
    ordered: list[Loan] = []
    while remaining:
        batch = [
            pk
            for pk in remaining
            if by_id[pk].parent_loan_id is None or by_id[pk].parent_loan_id not in remaining
        ]
        if not batch:
            raise ValueError("Loans have a circular parent_loan reference.")
        for pk in sorted(batch):
            ordered.append(by_id[pk])
            remaining.discard(pk)
    return ordered


def _serialize_many(records: list[dict[str, Any]], iterable: Iterable) -> None:
    records.extend(serializers.serialize("python", iterable))


def _append_tenant_records(records: list[dict[str, Any]], company_id: int) -> None:
    """Serialize all tenant tables in FK-safe order for restore."""
    cid = company_id
    company = Company.objects.filter(pk=cid).select_related("organization").first()
    if not company:
        raise ValueError("Company not found.")
    org_id = company.organization_id

    _serialize_many(records, Organization.objects.filter(pk=org_id))
    _serialize_many(records, Company.objects.filter(pk=cid))
    _serialize_many(records, Contract.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, CompanyRole.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, TenantPlatformReleaseEvent.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, User.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, Broadcast.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, _tenant_broadcast_reads_qs(cid).order_by("id"))
    _serialize_many(records, _topo_chart_accounts(cid))
    _serialize_many(records, TenantReportingCategory.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, Station.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, Item.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, Customer.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, Vendor.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, Employee.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, Tax.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, ShiftTemplate.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, PayrollRun.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, PayrollRunPondAllocation.objects.filter(payroll_run__company_id=cid).order_by("id"))
    _serialize_many(records, LoanCounterparty.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, BankAccount.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(
        records, SubscriptionLedgerInvoice.objects.filter(company_id=cid).order_by("id")
    )
    _serialize_many(records, BankDeposit.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, AquacultureWarehouseGroup.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, AquaculturePond.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, AquaculturePondPlOpening.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, AquacultureLandlord.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, AquacultureProductionCycle.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, ItemStationStock.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, ItemPondStock.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, AquacultureLandlordPondShare.objects.filter(landlord__company_id=cid).order_by("id"))
    _serialize_many(records, Tank.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, Island.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, Dispenser.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, Meter.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, Nozzle.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, JournalEntry.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, FundTransfer.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, ShiftSession.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, InventoryTransfer.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, InventoryTransferLine.objects.filter(transfer__company_id=cid).order_by("id"))
    _serialize_many(records, PondWarehouseStockReceipt.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(
        records, PondWarehouseStockReceiptLine.objects.filter(receipt__company_id=cid).order_by("id")
    )
    _serialize_many(records, PondWarehouseInterPondTransfer.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(
        records,
        PondWarehouseInterPondTransferLine.objects.filter(transfer__company_id=cid).order_by("id"),
    )
    _serialize_many(records, Invoice.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, Bill.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, Payment.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, TankDip.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, _topo_loans(cid))
    _serialize_many(records, LoanDisbursement.objects.filter(loan__company_id=cid).order_by("id"))
    _serialize_many(records, LoanRepayment.objects.filter(loan__company_id=cid).order_by("id"))
    _serialize_many(
        records, LoanInterestAccrual.objects.filter(loan__company_id=cid).order_by("id")
    )
    _serialize_many(
        records,
        JournalEntryLine.objects.filter(journal_entry__company_id=cid).order_by("id"),
    )
    _serialize_many(records, InvoiceLine.objects.filter(invoice__company_id=cid).order_by("id"))
    _serialize_many(records, BillLine.objects.filter(bill__company_id=cid).order_by("id"))
    _serialize_many(
        records,
        PaymentInvoiceAllocation.objects.filter(payment__company_id=cid).order_by("id"),
    )
    _serialize_many(
        records, PaymentBillAllocation.objects.filter(payment__company_id=cid).order_by("id")
    )
    _serialize_many(records, AquacultureExpense.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(
        records, AquacultureExpenseInventoryLine.objects.filter(expense__company_id=cid).order_by("id")
    )
    _serialize_many(
        records, AquacultureExpensePondShare.objects.filter(expense__company_id=cid).order_by("id")
    )
    _serialize_many(records, AquacultureFishSale.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, AquacultureBiomassSample.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, AquacultureFishPondTransfer.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(
        records, AquacultureFishPondTransferLine.objects.filter(transfer__company_id=cid).order_by("id")
    )
    _serialize_many(records, AquacultureFishStockLedger.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, AquaculturePondProfitTransfer.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, AquacultureFinancingAllocation.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(records, AquacultureFeedingAdvice.objects.filter(company_id=cid).order_by("id"))
    _serialize_many(
        records, AquacultureDataBankPondClose.objects.filter(company_id=cid).order_by("id")
    )
    _serialize_many(
        records, AquacultureLandlordLedgerEntry.objects.filter(landlord__company_id=cid).order_by("id")
    )
    _serialize_many(
        records,
        EmployeeLedgerEntry.objects.filter(employee__company_id=cid).order_by("id"),
    )
    _serialize_many(records, TaxRate.objects.filter(tax__company_id=cid).order_by("id"))


def build_backup_bundle(company_id: int) -> dict[str, Any]:
    """Return a JSON-serializable dict for one company."""
    company = Company.objects.filter(pk=company_id, is_deleted=False).first()
    if not company:
        raise ValueError("Company not found.")

    records: list[dict[str, Any]] = []
    _append_tenant_records(records, company_id)

    model_labels = sorted({r["model"] for r in records})
    missing = [m for m in EXPECTED_BACKUP_MODELS if m not in model_labels]
    if missing:
        logger.warning(
            "backup company_id=%s missing serialized models (empty tenant?): %s",
            company_id,
            ", ".join(missing),
        )

    return {
        "schema_version": BACKUP_SCHEMA_VERSION,
        "app": "fserp-tenant-backup",
        "company_id": company_id,
        "company_name": company.name,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "records": records,
        "model_labels": model_labels,
    }


def backup_bundle_json_bytes(company_id: int) -> bytes:
    bundle = build_backup_bundle(company_id)
    safe = _sanitize_for_json(bundle)
    return json.dumps(safe, indent=2, ensure_ascii=False).encode("utf-8")


def _parse_bundle(raw: bytes | str) -> dict[str, Any]:
    if isinstance(raw, bytes):
        text = raw.decode("utf-8")
    else:
        text = raw
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("Backup file is not a JSON object.")
    schema = int(data.get("schema_version") or 0)
    if schema not in SUPPORTED_BACKUP_SCHEMA_VERSIONS:
        raise ValueError(
            f"Unsupported backup schema_version={schema}. "
            f"Supported: {sorted(SUPPORTED_BACKUP_SCHEMA_VERSIONS)}."
        )
    records = data.get("records")
    if not isinstance(records, list):
        raise ValueError("Backup is missing records array.")
    cid = data.get("company_id")
    if cid is None:
        raise ValueError("Backup is missing company_id.")
    return data


def restore_bundle(
    bundle: dict[str, Any],
    target_company_id: int,
    *,
    confirm_replace: str,
) -> dict[str, Any]:
    """
    Replace all data for target_company_id with bundle contents.
    Bundle's company_id must match target_company_id.
    """
    if confirm_replace != RESTORE_CONFIRM_PHRASE:
        raise ValueError("Invalid confirmation phrase for destructive restore.")

    data = bundle
    cid = int(data["company_id"])
    if cid != int(target_company_id):
        raise ValueError(
            f"Backup is for company_id={cid}; cannot restore into company_id={target_company_id}."
        )

    schema = int(data.get("schema_version") or 0)
    restore_records, journal_fk_patches = _prepare_restore_records(data["records"])
    with transaction.atomic():
        delete_tenant_company_data(target_company_id)
        for obj in serializers.deserialize("python", restore_records):
            obj.save()
        _apply_deferred_journal_entry_fks(journal_fk_patches)
        # Belt-and-suspenders: never leave pre-restore reset links/OTPs valid after reload.
        purge_password_reset_tokens_for_company(target_company_id)

    result: dict[str, Any] = {
        "ok": True,
        "company_id": target_company_id,
        "restored_objects": len(restore_records),
        "schema_version": schema,
    }
    if schema < BACKUP_SCHEMA_VERSION:
        result["warning"] = (
            "Backup uses an older schema; aquaculture, Data Bank closes, inventory transfers, "
            "stock tables, and organization portal settings may not have been included in this file."
        )
    return result
