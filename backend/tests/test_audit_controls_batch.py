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
