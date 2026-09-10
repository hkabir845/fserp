"""Controls: audit events, void reasons, meter rollover, unique masters."""
from __future__ import annotations

import json
from decimal import Decimal

import pytest
from django.test import Client

from api.models import FinancialAuditEvent, Meter
from api.services.meter_reading import meter_quantity_from_readings

pytestmark = pytest.mark.django_db


def _login(api_client: Client, username: str, password: str = "AuditTest#99") -> dict:
    r = api_client.post(
        "/api/auth/login/",
        data=json.dumps({"username": username, "password": password}),
        content_type="application/json",
    )
    assert r.status_code == 200, r.content.decode()
    token = json.loads(r.content)["access_token"]
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _admin(company):
    from api.models import User

    u = User(
        username="ctrl_admin@test.com",
        email="ctrl_admin@test.com",
        full_name="Ctrl Admin",
        role="admin",
        is_active=True,
        company_id=company.id,
    )
    u.set_password("AuditTest#99")
    u.save()
    return u


def test_meter_rollover_quantity():
    assert meter_quantity_from_readings(
        Decimal("9998"), Decimal("2"), max_reading=Decimal("9999")
    ) == Decimal("4")
    assert meter_quantity_from_readings(
        Decimal("10"), Decimal("15"), max_reading=Decimal("9999")
    ) == Decimal("5")


def test_invoice_void_requires_reason(api_client: Client, company_tenant):
    from api.models import Customer, Invoice
    from tests.conftest import seed_min_gl_accounts

    seed_min_gl_accounts(company_tenant)
    _admin(company_tenant)
    headers = _login(api_client, "ctrl_admin@test.com")
    cust = Customer.objects.create(
        company=company_tenant, display_name="Void Cust", customer_number="VC-1"
    )
    inv = Invoice.objects.create(
        company=company_tenant,
        customer=cust,
        invoice_number="INV-VOID-1",
        invoice_date="2026-01-15",
        status="sent",
        subtotal=Decimal("100"),
        tax_total=Decimal("0"),
        total=Decimal("100"),
    )
    bad = api_client.put(
        f"/api/invoices/{inv.id}/",
        data=json.dumps({"status": "void", "invoice_date": "2026-01-15", "total": "100"}),
        content_type="application/json",
        **headers,
    )
    assert bad.status_code == 400
    assert "reason" in (bad.json().get("detail") or "").lower()

    ok = api_client.put(
        f"/api/invoices/{inv.id}/",
        data=json.dumps(
            {
                "status": "void",
                "reason": "Customer cancelled order",
                "invoice_date": "2026-01-15",
                "total": "100",
            }
        ),
        content_type="application/json",
        **headers,
    )
    assert ok.status_code == 200, ok.content.decode()
    assert FinancialAuditEvent.objects.filter(
        company_id=company_tenant.id, entity_type="invoice", action="void"
    ).exists()


def test_financial_audit_event_append_only(company_tenant):
    ev = FinancialAuditEvent.objects.create(
        company=company_tenant,
        action="test",
        entity_type="probe",
        reason="n/a",
    )
    with pytest.raises(ValueError):
        ev.reason = "changed"
        ev.save()
    with pytest.raises(ValueError):
        ev.delete()


def test_employee_delete_blocked_with_ledger(api_client: Client, company_tenant):
    from datetime import date

    from api.models import Employee, EmployeeLedgerEntry

    _admin(company_tenant)
    headers = _login(api_client, "ctrl_admin@test.com")
    emp = Employee.objects.create(
        company=company_tenant,
        first_name="Has",
        last_name="Ledger",
        employee_code="EMP-LED-1",
    )
    EmployeeLedgerEntry.objects.create(
        employee=emp,
        entry_date=date(2026, 1, 1),
        debit=Decimal("10.00"),
        credit=Decimal("0"),
        entry_type="adjustment",
    )
    res = api_client.delete(f"/api/employees/{emp.id}/", **headers)
    assert res.status_code == 409


def test_invoice_void_via_status_endpoint_requires_reason(api_client: Client, company_tenant):
    """PUT /invoices/{id}/status/ is a second door onto the same void — it must be gated too."""
    from api.models import Customer, Invoice
    from tests.conftest import seed_min_gl_accounts

    seed_min_gl_accounts(company_tenant)
    _admin(company_tenant)
    headers = _login(api_client, "ctrl_admin@test.com")
    cust = Customer.objects.create(
        company=company_tenant, display_name="Void Cust 2", customer_number="VC-2"
    )
    inv = Invoice.objects.create(
        company=company_tenant,
        customer=cust,
        invoice_number="INV-VOID-2",
        invoice_date="2026-01-15",
        status="sent",
        subtotal=Decimal("100"),
        tax_total=Decimal("0"),
        total=Decimal("100"),
    )
    bad = api_client.put(
        f"/api/invoices/{inv.id}/status/",
        data=json.dumps({"new_status": "void"}),
        content_type="application/json",
        **headers,
    )
    assert bad.status_code == 400
    assert "reason" in (bad.json().get("detail") or "").lower()
    inv.refresh_from_db()
    assert inv.status == "sent", "a rejected void must not change the invoice"

    ok = api_client.put(
        f"/api/invoices/{inv.id}/status/",
        data=json.dumps({"new_status": "void", "reason": "Duplicate entry"}),
        content_type="application/json",
        **headers,
    )
    assert ok.status_code == 200, ok.content.decode()
    inv.refresh_from_db()
    assert inv.status == "void"
    assert FinancialAuditEvent.objects.filter(
        company_id=company_tenant.id,
        entity_type="invoice",
        entity_id=inv.id,
        action="void",
        reason="Duplicate entry",
    ).exists()


def test_deleting_an_invoice_leaves_an_audit_row(api_client: Client, company_tenant):
    """The journals go with the document, so the audit row is the only surviving evidence."""
    from api.models import Customer, Invoice
    from tests.conftest import seed_min_gl_accounts

    seed_min_gl_accounts(company_tenant)
    _admin(company_tenant)
    headers = _login(api_client, "ctrl_admin@test.com")
    cust = Customer.objects.create(
        company=company_tenant, display_name="Del Cust", customer_number="DC-1"
    )
    inv = Invoice.objects.create(
        company=company_tenant,
        customer=cust,
        invoice_number="INV-DEL-1",
        invoice_date="2026-01-15",
        status="draft",
        subtotal=Decimal("250"),
        tax_total=Decimal("0"),
        total=Decimal("250"),
    )
    inv_id = inv.id
    res = api_client.delete(f"/api/invoices/{inv_id}/", **headers)
    assert res.status_code == 204, res.content.decode()
    assert not Invoice.objects.filter(id=inv_id).exists()

    ev = FinancialAuditEvent.objects.filter(
        company_id=company_tenant.id, entity_type="invoice", entity_id=inv_id, action="delete"
    ).first()
    assert ev is not None, "deleting an invoice must leave an audit trail"
    assert ev.entity_ref == "INV-DEL-1"
    assert ev.before_json.get("total") == "250.00"


def test_moving_the_books_lock_leaves_an_audit_row(
    api_client: Client, company_tenant, auth_super_headers
):
    """Reopening a closed period is the most consequential switch in the ledger."""
    # Only a platform administrator may move the close line, so this runs as one.
    headers = dict(auth_super_headers, HTTP_X_SELECTED_COMPANY_ID=str(company_tenant.id))

    res = api_client.put(
        f"/api/companies/{company_tenant.id}/",
        data=json.dumps({"books_locked_through": "2026-03-31", "reason": "Q1 close"}),
        content_type="application/json",
        **headers,
    )
    assert res.status_code == 200, res.content.decode()
    company_tenant.refresh_from_db()
    assert str(company_tenant.books_locked_through) == "2026-03-31"

    ev = FinancialAuditEvent.objects.filter(
        company_id=company_tenant.id, entity_type="company", action="books_lock_change"
    ).first()
    assert ev is not None, "closing the books must leave an audit trail"
    assert ev.before_json.get("books_locked_through") is None
    assert ev.after_json.get("books_locked_through") == "2026-03-31"
    assert ev.reason == "Q1 close"

    # Reopening must be trailed too — that is the direction that permits restatement.
    res = api_client.put(
        f"/api/companies/{company_tenant.id}/",
        data=json.dumps({"books_locked_through": "", "reason": "audit adjustment"}),
        content_type="application/json",
        **headers,
    )
    assert res.status_code == 200, res.content.decode()
    reopen = FinancialAuditEvent.objects.filter(
        company_id=company_tenant.id, entity_type="company", action="books_lock_change"
    ).order_by("-id").first()
    assert reopen.before_json.get("books_locked_through") == "2026-03-31"
    assert reopen.after_json.get("books_locked_through") is None


def test_rejected_void_leaves_no_audit_row(api_client: Client, company_tenant):
    """
    An audit row for a void that was then rolled back is worse than no row at all.

    The reason is validated before the transaction, but the event is written inside it, so a
    posting that is refused takes the row down with the status change.
    """
    from datetime import date

    from api.models import Customer, Invoice, InvoiceLine, Station
    from tests.conftest import seed_min_gl_accounts

    seed_min_gl_accounts(company_tenant)
    _admin(company_tenant)
    headers = _login(api_client, "ctrl_admin@test.com")
    site = Station.objects.create(
        company=company_tenant, station_name="Lock Site", is_active=True
    )
    cust = Customer.objects.create(
        company=company_tenant, display_name="Locked Cust", customer_number="LC-1"
    )
    inv = Invoice.objects.create(
        company=company_tenant,
        customer=cust,
        station=site,
        invoice_number="INV-LOCK-1",
        invoice_date=date(2026, 1, 15),
        status="sent",
        subtotal=Decimal("100"),
        tax_total=Decimal("0"),
        total=Decimal("100"),
    )
    InvoiceLine.objects.create(
        invoice=inv,
        description="Goods",
        quantity=Decimal("1"),
        unit_price=Decimal("100"),
        amount=Decimal("100"),
    )
    from api.services.gl_posting import sync_invoice_gl

    sync_invoice_gl(company_tenant.id, inv)

    # Close the books over the invoice date: unposting it must now be refused.
    company_tenant.books_locked_through = date(2026, 6, 30)
    company_tenant.save(update_fields=["books_locked_through"])

    res = api_client.put(
        f"/api/invoices/{inv.id}/status/",
        data=json.dumps({"new_status": "void", "reason": "should be refused"}),
        content_type="application/json",
        **headers,
    )
    assert res.status_code in (400, 409), res.content.decode()
    inv.refresh_from_db()
    assert inv.status == "sent", "the refused void must not change the invoice"
    assert not FinancialAuditEvent.objects.filter(
        company_id=company_tenant.id, entity_type="invoice", entity_id=inv.id, action="void"
    ).exists(), "a void that was rolled back must not leave an audit row behind"
