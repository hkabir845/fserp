"""Manual employee ledger entries must post a balanced journal (A0-10)."""
from __future__ import annotations

import json
from decimal import Decimal

import pytest

from api.models import ChartOfAccount, Employee, EmployeeLedgerEntry, JournalEntry, JournalEntryLine

pytestmark = pytest.mark.django_db


def _employee(cid: int) -> Employee:
    return Employee.objects.create(
        company_id=cid,
        first_name="Ledger",
        last_name="Staff",
        employee_code="EMP-LE-1",
        is_active=True,
    )


def _coa_net(company_id: int, code: str) -> Decimal:
    acc = ChartOfAccount.objects.get(company_id=company_id, account_code=code)
    debit = Decimal("0")
    credit = Decimal("0")
    for ln in JournalEntryLine.objects.filter(
        journal_entry__company_id=company_id,
        journal_entry__is_posted=True,
        account_id=acc.id,
    ):
        debit += ln.debit or Decimal("0")
        credit += ln.credit or Decimal("0")
    return debit - credit


def test_salary_debit_posts_expense_and_payable(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    cid = company_tenant_with_gl.id
    emp = _employee(cid)
    r = api_client.post(
        f"/api/employees/{emp.id}/ledger/entries/",
        data=json.dumps(
            {
                "entry_date": "2026-07-15",
                "entry_type": "salary",
                "memo": "July wages",
                "debit": "1000.00",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    body = json.loads(r.content)
    assert body["journal_entry_number"].startswith("AUTO-EMP-LE-")
    entry = EmployeeLedgerEntry.objects.get(pk=body["id"])
    assert entry.journal_entry_id
    je = JournalEntry.objects.get(pk=entry.journal_entry_id)
    assert je.is_posted is True
    lines = list(je.lines.all())
    assert sum((ln.debit for ln in lines), Decimal("0")) == sum(
        (ln.credit for ln in lines), Decimal("0")
    )
    assert _coa_net(cid, "6400") == Decimal("1000.00")
    assert _coa_net(cid, "2200") == Decimal("-1000.00")
    emp.refresh_from_db()
    assert emp.current_balance == Decimal("1000.00")


def test_advance_credit_posts_to_1150(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    cid = company_tenant_with_gl.id
    emp = _employee(cid)
    r = api_client.post(
        f"/api/employees/{emp.id}/ledger/entries/",
        data=json.dumps(
            {
                "entry_date": "2026-07-16",
                "entry_type": "advance",
                "memo": "Cash advance",
                "credit": "500.00",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    assert _coa_net(cid, "1150") == Decimal("500.00")
    assert _coa_net(cid, "1010") == Decimal("-500.00")
    emp.refresh_from_db()
    assert emp.current_balance == Decimal("-500.00")


def test_payment_credit_clears_salaries_payable(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    cid = company_tenant_with_gl.id
    emp = _employee(cid)
    r = api_client.post(
        f"/api/employees/{emp.id}/ledger/entries/",
        data=json.dumps(
            {
                "entry_date": "2026-07-17",
                "entry_type": "salary",
                "debit": "800.00",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    r = api_client.post(
        f"/api/employees/{emp.id}/ledger/entries/",
        data=json.dumps(
            {
                "entry_date": "2026-07-18",
                "entry_type": "repayment",
                "credit": "800.00",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 201, r.content.decode()
    assert _coa_net(cid, "2200") == Decimal("0.00")
    assert _coa_net(cid, "1010") == Decimal("-800.00")
    emp.refresh_from_db()
    assert emp.current_balance == Decimal("0.00")


def test_both_debit_and_credit_rejected(
    api_client, company_tenant_with_gl, auth_admin_headers
):
    emp = _employee(company_tenant_with_gl.id)
    r = api_client.post(
        f"/api/employees/{emp.id}/ledger/entries/",
        data=json.dumps(
            {
                "entry_date": "2026-07-19",
                "entry_type": "adjustment",
                "debit": "10.00",
                "credit": "4.00",
            }
        ),
        content_type="application/json",
        **auth_admin_headers,
    )
    assert r.status_code == 400
    assert EmployeeLedgerEntry.objects.filter(employee_id=emp.id).count() == 0
