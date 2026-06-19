"""Full tenant backup/restore coverage (schema v2, aquaculture, inventory PROTECT chains)."""

from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from api.models import (
    AquacultureDataBankPondClose,
    AquaculturePond,
    AquaculturePondPlOpening,
    Company,
    Customer,
    Employee,
    InventoryTransfer,
    Item,
    ItemStationStock,
    JournalEntryLine,
    PondWarehouseStockReturn,
    Station,
    Vendor,
)
from api.services.aquaculture_pond_go_live_service import set_company_cutover_date
from api.services.aquaculture_pond_pl_opening import sync_pond_pl_openings
from api.services.aquaculture_pond_pl_opening_gl import post_pond_pl_opening_gl
from api.services.party_opening_gl import (
    post_customer_opening_gl,
    post_employee_opening_gl,
    post_vendor_opening_gl,
)
from api.services.tenant_backup import (
    BACKUP_EXCLUDED_MODELS,
    BACKUP_SCHEMA_VERSION,
    EXPECTED_BACKUP_MODELS,
    RESTORE_CONFIRM_PHRASE,
    backup_bundle_json_bytes,
    build_backup_bundle,
    delete_tenant_company_data,
    restore_bundle,
)

pytestmark = pytest.mark.django_db


def test_backup_bundle_schema_v2(company_tenant):
    bundle = build_backup_bundle(company_tenant.id)
    assert bundle["schema_version"] == BACKUP_SCHEMA_VERSION == 2
    assert "model_labels" in bundle
    assert bundle["records"]


def test_backup_includes_aquaculture_and_inventory_models(company_tenant):
    st1 = Station.objects.create(company=company_tenant, station_name="Backup Stn A")
    st2 = Station.objects.create(company=company_tenant, station_name="Backup Stn B")
    item = Item.objects.create(company=company_tenant, name="Backup SKU")
    AquaculturePond.objects.create(company=company_tenant, name="Backup Pond Alpha")
    InventoryTransfer.objects.create(
        company=company_tenant,
        from_station=st1,
        to_station=st2,
        transfer_date=date.today(),
    )
    ItemStationStock.objects.create(
        company=company_tenant, station=st1, item=item, quantity="10"
    )

    labels = set(build_backup_bundle(company_tenant.id)["model_labels"])
    assert "api.aquaculturepond" in labels
    assert "api.inventorytransfer" in labels
    assert "api.itemstationstock" in labels


def test_pond_warehouse_stock_return_backup_restore_roundtrip(company_tenant):
    from decimal import Decimal

    from api.services.aquaculture_pond_stock_service import add_pond_stock, transfer_pond_warehouse_to_station
    from api.services.station_stock import set_station_stock

    Company.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    st = Station.objects.create(company=company_tenant, station_name="Backup Shop", is_active=True)
    pond = AquaculturePond.objects.create(company=company_tenant, name="Backup Pond Return")
    item = Item.objects.create(company=company_tenant, name="Return SKU", item_type="inventory")
    set_station_stock(company_tenant.id, st.id, item.id, Decimal("0"))
    add_pond_stock(company_tenant.id, pond.id, item.id, Decimal("10"))
    transfer_pond_warehouse_to_station(
        company_id=company_tenant.id,
        pond_id=pond.id,
        station_id=st.id,
        items=[{"item_id": item.id, "quantity": "4"}],
    )
    assert PondWarehouseStockReturn.objects.filter(company_id=company_tenant.id).count() == 1

    bundle = json.loads(backup_bundle_json_bytes(company_tenant.id).decode("utf-8"))
    assert "api.pondwarehousestockreturn" in bundle["model_labels"]
    assert "api.pondwarehousestockreturnline" in bundle["model_labels"]

    PondWarehouseStockReturn.objects.filter(company_id=company_tenant.id).delete()
    assert not PondWarehouseStockReturn.objects.filter(company_id=company_tenant.id).exists()

    restore_bundle(bundle, company_tenant.id, confirm_replace=RESTORE_CONFIRM_PHRASE)
    ret = PondWarehouseStockReturn.objects.filter(company_id=company_tenant.id).first()
    assert ret is not None
    assert ret.pond_id == pond.id
    assert ret.to_station_id == st.id
    assert ret.lines.count() == 1


def test_aquaculture_pond_backup_restore_roundtrip(company_tenant):
    AquaculturePond.objects.create(company=company_tenant, name="Roundtrip Pond Z9")
    raw = backup_bundle_json_bytes(company_tenant.id)
    bundle = json.loads(raw)

    restore_bundle(bundle, company_tenant.id, confirm_replace=RESTORE_CONFIRM_PHRASE)

    assert AquaculturePond.objects.filter(
        company_id=company_tenant.id, name="Roundtrip Pond Z9"
    ).exists()


def test_customer_api_backup_restore_roundtrip(api_client, auth_admin_headers, company_tenant):
    Customer.objects.create(
        company_id=company_tenant.id,
        display_name="API Roundtrip Customer",
        customer_number="API-RTC-1",
    )
    dl = api_client.get("/api/company/backup/", **auth_admin_headers)
    assert dl.status_code == 200
    assert dl["X-Backup-Schema-Version"] == str(BACKUP_SCHEMA_VERSION)
    blob = dl.content

    Customer.objects.filter(company_id=company_tenant.id).delete()
    assert not Customer.objects.filter(display_name="API Roundtrip Customer").exists()

    up = api_client.post(
        "/api/company/restore/",
        data={
            "confirm_replace": RESTORE_CONFIRM_PHRASE,
            "file": SimpleUploadedFile("backup.json", blob, content_type="application/json"),
        },
        **auth_admin_headers,
    )
    assert up.status_code == 200, up.content.decode()
    out = json.loads(up.content)
    assert out.get("ok") is True
    assert out.get("schema_version") == BACKUP_SCHEMA_VERSION
    assert Customer.objects.filter(display_name="API Roundtrip Customer").exists()


def test_payroll_employee_allocation_backup_restore_roundtrip(company_tenant):
    from api.models import PayrollRun, PayrollRunEmployeeAllocation
    from api.services.employee_payroll_allocations import replace_payroll_employee_allocations

    emp = Employee.objects.create(
        company_id=company_tenant.id,
        employee_code="BK-EMP-1",
        employee_number="BK-EMP-1",
        first_name="Backup",
        last_name="Worker",
        salary=Decimal("34000.00"),
        is_active=True,
    )
    pr = PayrollRun.objects.create(
        company_id=company_tenant.id,
        pay_period_start=date(2026, 6, 1),
        pay_period_end=date(2026, 6, 30),
        payment_date=date(2026, 6, 30),
        total_gross=Decimal("34000.00"),
        total_deductions=Decimal("0"),
        total_net=Decimal("34000.00"),
    )
    replace_payroll_employee_allocations(pr.id, [(emp, Decimal("34000.00"))])
    assert PayrollRunEmployeeAllocation.objects.filter(payroll_run_id=pr.id).count() == 1

    bundle = json.loads(backup_bundle_json_bytes(company_tenant.id).decode("utf-8"))
    assert "api.payrollrunemployeeallocation" in bundle["model_labels"]

    PayrollRunEmployeeAllocation.objects.filter(payroll_run__company_id=company_tenant.id).delete()
    PayrollRun.objects.filter(company_id=company_tenant.id).delete()
    assert not PayrollRunEmployeeAllocation.objects.filter(payroll_run_id=pr.id).exists()

    restore_bundle(bundle, company_tenant.id, confirm_replace=RESTORE_CONFIRM_PHRASE)
    row = PayrollRunEmployeeAllocation.objects.filter(
        payroll_run__company_id=company_tenant.id, employee_id=emp.id
    ).first()
    assert row is not None
    assert row.amount == Decimal("34000.00")


def test_delete_tenant_succeeds_with_inventory_transfer(company_tenant):
    st1 = Station.objects.create(company=company_tenant, station_name="Del Stn 1")
    st2 = Station.objects.create(company=company_tenant, station_name="Del Stn 2")
    Item.objects.create(company=company_tenant, name="Del Item")
    InventoryTransfer.objects.create(
        company=company_tenant,
        from_station=st1,
        to_station=st2,
        transfer_date=date.today(),
    )
    cid = company_tenant.id
    delete_tenant_company_data(cid)
    assert not Company.objects.filter(pk=cid).exists()
    assert not InventoryTransfer.objects.filter(company_id=cid).exists()


def test_restore_legacy_schema_v1_still_accepted(company_tenant):
    """v1 backups remain restorable (may omit aquaculture — warning in response)."""
    cust = Customer.objects.create(
        company_id=company_tenant.id,
        display_name="Legacy v1 Customer",
        customer_number="V1-1",
    )
    bundle = {
        "schema_version": 1,
        "company_id": company_tenant.id,
        "records": json.loads(
            backup_bundle_json_bytes(company_tenant.id).decode("utf-8")
        )["records"][:50],
    }
    # Keep only customer + company slice for minimal v1 simulation
    bundle["records"] = [
        r
        for r in bundle["records"]
        if r["model"] in ("api.company", "api.customer", "api.user")
    ]
    Customer.objects.filter(pk=cust.pk).delete()
    result = restore_bundle(
        bundle, company_tenant.id, confirm_replace=RESTORE_CONFIRM_PHRASE
    )
    assert result["ok"] is True
    assert result.get("warning")


def test_expected_backup_model_list_matches_django_labels():
    """Guardrail: EXPECTED_BACKUP_MODELS uses real app labels."""
    from django.apps import apps

    for label in EXPECTED_BACKUP_MODELS:
        app_label, model_name = label.split(".", 1)
        assert apps.get_model(app_label, model_name) is not None


def test_backup_includes_organization_and_data_bank_closes(company_tenant):
    pond = AquaculturePond.objects.create(company=company_tenant, name="Backup Close Pond")
    AquacultureDataBankPondClose.objects.create(
        company=company_tenant,
        pond=pond,
        label="FY 2025",
        period_start=date(2024, 7, 1),
        period_end=date(2025, 6, 30),
    )
    labels = set(build_backup_bundle(company_tenant.id)["model_labels"])
    assert "api.organization" in labels
    assert "api.aquaculturedatabankpondclose" in labels
    org_ids = {
        r["pk"]
        for r in build_backup_bundle(company_tenant.id)["records"]
        if r["model"] == "api.organization"
    }
    assert company_tenant.organization_id in org_ids


def test_data_bank_pond_close_backup_restore_roundtrip(company_tenant):
    pond = AquaculturePond.objects.create(company=company_tenant, name="Close Roundtrip Pond")
    AquacultureDataBankPondClose.objects.create(
        company=company_tenant,
        pond=pond,
        label="FY 2024",
        period_start=date(2023, 7, 1),
        period_end=date(2024, 6, 30),
    )
    bundle = json.loads(backup_bundle_json_bytes(company_tenant.id).decode("utf-8"))
    restore_bundle(bundle, company_tenant.id, confirm_replace=RESTORE_CONFIRM_PHRASE)
    assert AquacultureDataBankPondClose.objects.filter(
        company_id=company_tenant.id, label="FY 2024"
    ).exists()


def test_all_company_scoped_models_in_expected_backup_list():
    """Every api model with a direct Company FK must be in EXPECTED_BACKUP_MODELS (or documented exclusion)."""
    from django.apps import apps

    excluded = set(BACKUP_EXCLUDED_MODELS)
    company_model = apps.get_model("api", "Company")
    missing: list[str] = []
    for model in apps.get_app_config("api").get_models():
        for field in model._meta.get_fields():
            if getattr(field, "related_model", None) is company_model and getattr(field, "many_to_one", False):
                label = model._meta.label_lower
                if label not in EXPECTED_BACKUP_MODELS and label not in excluded:
                    missing.append(label)
                break
    assert not missing, f"Add to tenant backup: {', '.join(sorted(missing))}"


def _seed_opening_gl_accounts(company):
    from api.models import ChartOfAccount

    for code, name, atype, sub in [
        ("1100", "AR", "asset", ""),
        ("2000", "AP", "liability", ""),
        ("2200", "Payroll", "liability", ""),
        ("3200", "OBE", "equity", "opening_balance_equity"),
        ("4240", "Fish sales", "income", ""),
        ("6716", "Feed", "expense", ""),
    ]:
        ChartOfAccount.objects.create(
            company=company,
            account_code=code,
            account_name=name,
            account_type=atype,
            account_sub_type=sub,
            is_active=True,
        )


def test_go_live_opening_journal_fk_backup_restore_roundtrip(company_tenant):
    """Opening-balance journal links survive backup even though parties serialize before journals."""
    cutover = date(2026, 5, 22)
    set_company_cutover_date(company_tenant.id, cutover)
    _seed_opening_gl_accounts(company_tenant)

    cust = Customer.objects.create(
        company=company_tenant,
        display_name="Backup OB Customer",
        customer_number="BK-C1",
        opening_balance=Decimal("1000"),
        opening_balance_date=cutover,
    )
    vend = Vendor.objects.create(
        company=company_tenant,
        display_name="Backup OB Vendor",
        vendor_number="BK-V1",
        opening_balance=Decimal("800"),
        opening_balance_date=cutover,
    )
    emp = Employee.objects.create(
        company=company_tenant,
        first_name="Backup",
        last_name="Worker",
        opening_balance=Decimal("500"),
        opening_balance_date=cutover,
    )
    pond = AquaculturePond.objects.create(company=company_tenant, name="Backup OB Pond", code="BK-P1")

    assert post_customer_opening_gl(company_tenant.id, cust)
    assert post_vendor_opening_gl(company_tenant.id, vend)
    assert post_employee_opening_gl(company_tenant.id, emp)
    sync_pond_pl_openings(
        company_tenant.id,
        pond.id,
        income=[{"category_code": "fish_harvest_sale", "amount": "300", "as_of_date": cutover.isoformat()}],
        expense=[{"category_code": "feed_purchase", "amount": "100", "as_of_date": cutover.isoformat()}],
    )
    assert post_pond_pl_opening_gl(company_tenant.id, pond.id)

    cust.refresh_from_db()
    vend.refresh_from_db()
    emp.refresh_from_db()
    pond.refresh_from_db()
    company_tenant.refresh_from_db()
    cust_je = cust.opening_balance_journal_id
    vend_je = vend.opening_balance_journal_id
    emp_je = emp.opening_balance_journal_id
    pond_je = pond.pl_opening_journal_id
    assert all([cust_je, vend_je, emp_je, pond_je])

    bundle = json.loads(backup_bundle_json_bytes(company_tenant.id).decode("utf-8"))
    labels = set(bundle["model_labels"])
    assert "api.aquaculturepondplopening" in labels

    restore_bundle(bundle, company_tenant.id, confirm_replace=RESTORE_CONFIRM_PHRASE)

    company_tenant.refresh_from_db()
    cust = Customer.objects.get(company_id=company_tenant.id, customer_number="BK-C1")
    vend = Vendor.objects.get(company_id=company_tenant.id, vendor_number="BK-V1")
    emp = Employee.objects.get(company_id=company_tenant.id, last_name="Worker")
    pond = AquaculturePond.objects.get(company_id=company_tenant.id, code="BK-P1")

    assert company_tenant.aquaculture_go_live_cutover_date == cutover
    assert cust.opening_balance_journal_id == cust_je
    assert vend.opening_balance_journal_id == vend_je
    assert emp.opening_balance_journal_id == emp_je
    assert pond.pl_opening_journal_id == pond_je
    assert AquaculturePondPlOpening.objects.filter(company_id=company_tenant.id, pond_id=pond.id).exists()
    assert JournalEntryLine.objects.filter(journal_entry_id=cust_je).exists()


def test_journal_line_station_and_pond_backup_restore_roundtrip(company_tenant_with_gl):
    """Entity tags on manual journal lines survive backup/restore."""
    from api.models import ChartOfAccount, JournalEntry, JournalEntryLine

    cid = company_tenant_with_gl.id
    st = Station.objects.create(company_id=cid, station_name="Backup JE Site", is_active=True)
    pond = AquaculturePond.objects.create(company_id=cid, name="Backup JE Pond", is_active=True)
    expense = ChartOfAccount.objects.get(company_id=cid, account_code="6900")
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")
    je = JournalEntry.objects.create(
        company_id=cid,
        entry_number="JE-BK-ENTITY",
        entry_date=date(2026, 11, 10),
        station_id=st.id,
        is_posted=False,
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=expense,
        station_id=st.id,
        aquaculture_pond_id=pond.id,
        debit=Decimal("25"),
        credit=Decimal("0"),
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=cash,
        debit=Decimal("0"),
        credit=Decimal("25"),
    )

    bundle = json.loads(backup_bundle_json_bytes(cid).decode("utf-8"))
    restore_bundle(bundle, cid, confirm_replace=RESTORE_CONFIRM_PHRASE)

    line = JournalEntryLine.objects.get(
        journal_entry__company_id=cid,
        journal_entry__entry_number="JE-BK-ENTITY",
        account=expense,
    )
    assert line.station_id == st.id
    assert line.aquaculture_pond_id == pond.id


def test_restore_rejects_unknown_model_in_bundle(company_tenant):
    bundle = json.loads(backup_bundle_json_bytes(company_tenant.id).decode("utf-8"))
    bundle["records"].append(
        {"model": "api.notarealmodel", "pk": 1, "fields": {}},
    )
    with pytest.raises(ValueError, match="unrecognized model"):
        restore_bundle(bundle, company_tenant.id, confirm_replace=RESTORE_CONFIRM_PHRASE)
