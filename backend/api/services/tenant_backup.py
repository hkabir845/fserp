"""
Tenant-scoped backup (export) and restore (full replace) for FSERP.

Uses Django's serialization format (python/json compatible). Restore clears the
tenant in FK-safe order (PROTECT chains), then reloads from the bundle.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from django.core import serializers
from django.db import transaction
from django.db.models import Count

from api.models import (
    BankAccount,
    BankDeposit,
    Bill,
    BillLine,
    ChartOfAccount,
    Company,
    Contract,
    Customer,
    Dispenser,
    Employee,
    EmployeeLedgerEntry,
    FundTransfer,
    Invoice,
    InvoiceLine,
    Island,
    Item,
    JournalEntry,
    JournalEntryLine,
    Loan,
    LoanCounterparty,
    LoanDisbursement,
    LoanInterestAccrual,
    LoanRepayment,
    Meter,
    Nozzle,
    Payment,
    PaymentBillAllocation,
    PaymentInvoiceAllocation,
    PayrollRun,
    ShiftSession,
    ShiftTemplate,
    Station,
    SubscriptionLedgerInvoice,
    Tank,
    TankDip,
    Tax,
    TaxRate,
    User,
    Vendor,
)

BACKUP_SCHEMA_VERSION = 1
RESTORE_CONFIRM_PHRASE = "DELETE_ALL_TENANT_DATA"


def delete_tenant_company_data(company_id: int) -> None:
    """
    Remove all ERP rows for a company in FK-safe order (PROTECT chains break Company.delete()).
    """
    cid = company_id

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
    BankDeposit.objects.filter(company_id=cid).delete()
    SubscriptionLedgerInvoice.objects.filter(company_id=cid).delete()
    BankAccount.objects.filter(company_id=cid).delete()
    LoanCounterparty.objects.filter(company_id=cid).delete()
    PayrollRun.objects.filter(company_id=cid).delete()
    ShiftTemplate.objects.filter(company_id=cid).delete()
    Tax.objects.filter(company_id=cid).delete()
    Employee.objects.filter(company_id=cid).delete()
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

    User.objects.filter(company_id=cid).delete()
    Contract.objects.filter(company_id=cid).delete()
    Company.objects.filter(pk=cid).delete()


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


def _serialize_many(records: list[dict[str, Any]], iterable) -> None:
    records.extend(serializers.serialize("python", iterable))


def build_backup_bundle(company_id: int) -> dict[str, Any]:
    """Return a JSON-serializable dict for one company."""
    company = Company.objects.filter(pk=company_id, is_deleted=False).first()
    if not company:
        raise ValueError("Company not found.")

    records: list[dict[str, Any]] = []

    _serialize_many(records, Company.objects.filter(pk=company_id))
    _serialize_many(records, Contract.objects.filter(company_id=company_id))
    _serialize_many(records, User.objects.filter(company_id=company_id))
    _serialize_many(records, _topo_chart_accounts(company_id))
    _serialize_many(records, Station.objects.filter(company_id=company_id).order_by("id"))
    _serialize_many(records, Item.objects.filter(company_id=company_id).order_by("id"))
    _serialize_many(records, Customer.objects.filter(company_id=company_id).order_by("id"))
    _serialize_many(records, Vendor.objects.filter(company_id=company_id).order_by("id"))
    _serialize_many(records, Employee.objects.filter(company_id=company_id).order_by("id"))
    _serialize_many(records, Tax.objects.filter(company_id=company_id).order_by("id"))
    _serialize_many(records, ShiftTemplate.objects.filter(company_id=company_id).order_by("id"))
    _serialize_many(records, PayrollRun.objects.filter(company_id=company_id).order_by("id"))
    _serialize_many(records, LoanCounterparty.objects.filter(company_id=company_id).order_by("id"))
    _serialize_many(records, BankAccount.objects.filter(company_id=company_id).order_by("id"))
    _serialize_many(
        records, SubscriptionLedgerInvoice.objects.filter(company_id=company_id).order_by("id")
    )
    _serialize_many(records, BankDeposit.objects.filter(company_id=company_id).order_by("id"))
    _serialize_many(records, Tank.objects.filter(company_id=company_id).order_by("id"))
    _serialize_many(records, Island.objects.filter(company_id=company_id).order_by("id"))
    _serialize_many(records, Dispenser.objects.filter(company_id=company_id).order_by("id"))
    _serialize_many(records, Meter.objects.filter(company_id=company_id).order_by("id"))
    _serialize_many(records, Nozzle.objects.filter(company_id=company_id).order_by("id"))
    _serialize_many(records, JournalEntry.objects.filter(company_id=company_id).order_by("id"))
    _serialize_many(records, FundTransfer.objects.filter(company_id=company_id).order_by("id"))
    _serialize_many(records, ShiftSession.objects.filter(company_id=company_id).order_by("id"))
    _serialize_many(records, Invoice.objects.filter(company_id=company_id).order_by("id"))
    _serialize_many(records, Bill.objects.filter(company_id=company_id).order_by("id"))
    _serialize_many(records, Payment.objects.filter(company_id=company_id).order_by("id"))
    _serialize_many(records, TankDip.objects.filter(company_id=company_id).order_by("id"))
    _serialize_many(records, _topo_loans(company_id))
    _serialize_many(records, LoanDisbursement.objects.filter(loan__company_id=company_id).order_by("id"))
    _serialize_many(records, LoanRepayment.objects.filter(loan__company_id=company_id).order_by("id"))
    _serialize_many(
        records, LoanInterestAccrual.objects.filter(loan__company_id=company_id).order_by("id")
    )
    _serialize_many(
        records,
        JournalEntryLine.objects.filter(journal_entry__company_id=company_id).order_by("id"),
    )
    _serialize_many(records, InvoiceLine.objects.filter(invoice__company_id=company_id).order_by("id"))
    _serialize_many(records, BillLine.objects.filter(bill__company_id=company_id).order_by("id"))
    _serialize_many(
        records,
        PaymentInvoiceAllocation.objects.filter(payment__company_id=company_id).order_by("id"),
    )
    _serialize_many(
        records, PaymentBillAllocation.objects.filter(payment__company_id=company_id).order_by("id")
    )
    _serialize_many(
        records,
        EmployeeLedgerEntry.objects.filter(employee__company_id=company_id).order_by("id"),
    )
    _serialize_many(records, TaxRate.objects.filter(tax__company_id=company_id).order_by("id"))

    return {
        "schema_version": BACKUP_SCHEMA_VERSION,
        "app": "fserp-tenant-backup",
        "company_id": company_id,
        "company_name": company.name,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "records": records,
    }


def backup_bundle_json_bytes(company_id: int) -> bytes:
    bundle = build_backup_bundle(company_id)
    return json.dumps(bundle, indent=2).encode("utf-8")


def _parse_bundle(raw: bytes | str) -> dict[str, Any]:
    if isinstance(raw, bytes):
        text = raw.decode("utf-8")
    else:
        text = raw
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("Backup file is not a JSON object.")
    if int(data.get("schema_version") or 0) != BACKUP_SCHEMA_VERSION:
        raise ValueError("Unsupported or missing backup schema_version.")
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

    records = data["records"]
    with transaction.atomic():
        delete_tenant_company_data(target_company_id)
        for obj in serializers.deserialize("python", records):
            obj.save()

    return {
        "ok": True,
        "company_id": target_company_id,
        "restored_objects": len(records),
    }
