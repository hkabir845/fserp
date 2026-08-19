"""Each pond gets a buying face (POS customer) and a selling face (internal vendor)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import AquaculturePond, Bill, Customer, Invoice, Vendor
from api.services.aquaculture_pond_internal_vendor import (
    mark_pond_pos_customer_internal,
    maybe_provision_auto_internal_vendor,
    on_pond_deleted_internal_vendor,
    pond_internal_vendor_ids,
    provision_missing_pond_internal_vendors,
    provision_pond_internal_parties,
    sync_auto_internal_vendor_from_pond,
    vendor_is_linked_pond_internal,
)
from api.services.aquaculture_pond_pos_customer import maybe_provision_auto_pos_customer
from api.services.reporting import (
    report_customer_balances,
    report_party_balances,
    report_vendor_balances,
)


def _pond(cid: int, name: str = "Nursing P-01") -> AquaculturePond:
    return AquaculturePond.objects.create(company_id=cid, name=name, is_active=True)


@pytest.mark.django_db
def test_pond_gets_an_internal_vendor_named_like_its_customer(company_tenant):
    cid = company_tenant.id
    pond = _pond(cid)
    assert maybe_provision_auto_pos_customer(company_id=cid, pond=pond, skip_auto=False) is None
    assert provision_pond_internal_parties(company_id=cid, pond=pond) is None

    pond.refresh_from_db()
    assert pond.internal_vendor_id is not None
    assert pond.auto_internal_vendor is True

    vendor = Vendor.objects.get(pk=pond.internal_vendor_id)
    assert vendor.is_internal is True
    assert vendor.internal_pond_id == pond.id
    assert vendor.company_name == "Aquaculture — Nursing P-01"
    assert vendor.vendor_number  # auto-assigned

    # The buying face is flagged internal too.
    customer = Customer.objects.get(pk=pond.pos_customer_id)
    assert customer.is_internal is True
    assert customer.internal_pond_id == pond.id

    assert vendor_is_linked_pond_internal(cid, vendor.id) is True
    assert pond_internal_vendor_ids(cid) == [vendor.id]


@pytest.mark.django_db
def test_provisioning_is_idempotent(company_tenant):
    cid = company_tenant.id
    pond = _pond(cid)
    maybe_provision_auto_pos_customer(company_id=cid, pond=pond, skip_auto=False)
    provision_pond_internal_parties(company_id=cid, pond=pond)
    first = AquaculturePond.objects.get(pk=pond.pk).internal_vendor_id

    pond.refresh_from_db()
    provision_pond_internal_parties(company_id=cid, pond=pond)
    provision_missing_pond_internal_vendors(company_id=cid)

    pond.refresh_from_db()
    assert pond.internal_vendor_id == first
    assert Vendor.objects.filter(company_id=cid, is_internal=True).count() == 1


@pytest.mark.django_db
def test_rename_and_deactivate_follow_the_pond(company_tenant):
    cid = company_tenant.id
    pond = _pond(cid)
    provision_pond_internal_parties(company_id=cid, pond=pond)

    pond.refresh_from_db()
    pond.name = "Grow-out G-09"
    pond.is_active = False
    pond.save(update_fields=["name", "is_active"])
    sync_auto_internal_vendor_from_pond(pond)

    vendor = Vendor.objects.get(pk=pond.internal_vendor_id)
    assert vendor.company_name == "Aquaculture — Grow-out G-09"
    assert vendor.display_name == "Aquaculture — Grow-out G-09"
    assert vendor.is_active is False


@pytest.mark.django_db
def test_deleting_a_pond_retires_an_unused_internal_vendor(company_tenant):
    cid = company_tenant.id
    pond = _pond(cid)
    provision_pond_internal_parties(company_id=cid, pond=pond)
    pond.refresh_from_db()
    vid = pond.internal_vendor_id

    on_pond_deleted_internal_vendor(company_id=cid, pond=pond)
    assert Vendor.objects.get(pk=vid).is_active is False


@pytest.mark.django_db
def test_a_manually_chosen_outside_customer_stays_external(company_tenant):
    """Only auto-provisioned POS customers are internal; a real customer keeps counting as A/R."""
    cid = company_tenant.id
    real = Customer.objects.create(
        company_id=cid,
        display_name="Chittagong Fish Market",
        customer_number="C-EXT-1",
        current_balance=Decimal("0"),
    )
    pond = AquaculturePond.objects.create(
        company_id=cid,
        name="Pond with real buyer",
        is_active=True,
        pos_customer=real,
        auto_pos_customer=False,
    )

    assert mark_pond_pos_customer_internal(pond) == 0
    real.refresh_from_db()
    assert real.is_internal is False
    assert real.internal_pond_id is None


@pytest.mark.django_db
def test_internal_parties_are_split_out_of_headline_balances(company_tenant):
    cid = company_tenant.id
    pond = _pond(cid)
    maybe_provision_auto_pos_customer(company_id=cid, pond=pond, skip_auto=False)
    provision_pond_internal_parties(company_id=cid, pond=pond)
    pond.refresh_from_db()

    # Internal: another profit centre owes this pond 50,000.
    Invoice.objects.create(
        company_id=cid,
        customer_id=pond.pos_customer_id,
        invoice_number="INV-INT-1",
        invoice_date=date(2026, 1, 5),
        due_date=date(2026, 1, 20),
        status="sent",
        total=Decimal("50000.00"),
    )
    # Internal: a bill raised against the pond's selling identity.
    Bill.objects.create(
        company_id=cid,
        vendor_id=pond.internal_vendor_id,
        bill_number="BILL-INT-1",
        bill_date=date(2026, 1, 5),
        due_date=date(2026, 1, 20),
        status="open",
        total=Decimal("50000.00"),
    )
    # External: a genuine outside customer.
    outside = Customer.objects.create(
        company_id=cid,
        display_name="Chittagong Fish Market",
        customer_number="C-EXT-9",
        current_balance=Decimal("0"),
    )
    Invoice.objects.create(
        company_id=cid,
        customer=outside,
        invoice_number="INV-EXT-1",
        invoice_date=date(2026, 1, 6),
        due_date=date(2026, 1, 21),
        status="sent",
        total=Decimal("12000.00"),
    )

    cb = report_customer_balances(cid, date(2026, 1, 1), date(2026, 1, 31))
    assert cb["total_ar"] == 62000.0            # unchanged: still every customer
    assert cb["total_ar_external"] == 12000.0   # only the real buyer
    assert cb["total_ar_internal"] == 50000.0

    vb = report_vendor_balances(cid, date(2026, 1, 1), date(2026, 1, 31))
    assert vb["total_ap_internal"] == 50000.0
    assert vb["total_ap_external"] == 0.0

    pb = report_party_balances(cid, date(2026, 1, 1), date(2026, 1, 31))
    keys = [s["key"] for s in pb["sections"]]
    assert keys == [
        "customers",
        "vendors",
        "bank_accounts",
        "loans",
        "internal_customers",
        "internal_vendors",
    ]
    by_key = {s["key"]: s for s in pb["sections"]}
    assert by_key["customers"]["count"] == 1            # outside buyer only
    assert by_key["internal_customers"]["count"] == 1
    assert by_key["internal_vendors"]["count"] == 1

    summary = pb["summary"]
    # Headline totals see only real outside parties.
    assert summary["customer_receivable"] == 12000.0
    assert summary["vendor_payable"] == 0.0
    assert summary["net_position"] == 12000.0
    # Internal trade is reported apart, and nets to zero once both sides are booked.
    assert summary["internal_receivable"] == 50000.0
    assert summary["internal_payable"] == 50000.0
    assert summary["internal_net_position"] == 0.0
