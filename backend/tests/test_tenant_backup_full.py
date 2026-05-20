"""Full tenant backup/restore coverage (schema v2, aquaculture, inventory PROTECT chains)."""

from __future__ import annotations

import json
from datetime import date

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from api.models import (
    AquaculturePond,
    Company,
    Customer,
    InventoryTransfer,
    Item,
    ItemStationStock,
    Station,
)
from api.services.tenant_backup import (
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
