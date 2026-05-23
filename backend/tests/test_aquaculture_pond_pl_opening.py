"""Aquaculture pond P&L opening balances by category."""
from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquaculturePond,
    AquaculturePondPlOpening,
    ChartOfAccount,
    Customer,
    Employee,
    JournalEntryLine,
    Vendor,
)
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.aquaculture_pond_go_live_service import set_company_cutover_date
from api.services.aquaculture_pond_opening_summary import (
    build_all_pond_opening_summaries,
    build_pond_opening_summary,
)
from api.services.aquaculture_pond_pl_opening import sync_pond_pl_openings
from api.services.party_opening_gl import post_customer_opening_gl, post_vendor_opening_gl


@pytest.mark.django_db
def test_sync_pl_opening_and_summary(company_tenant):
    set_company_cutover_date(company_tenant.id, date(2025, 1, 1))
    pond = AquaculturePond.objects.create(company=company_tenant, name="P1", code="P01")
    err = sync_pond_pl_openings(
        company_tenant.id,
        pond.id,
        income=[{"category_code": "fish_harvest_sale", "amount": "1000", "as_of_date": "2025-01-01"}],
        expense=[{"category_code": "feed_purchase", "amount": "400", "as_of_date": "2025-01-01"}],
    )
    assert err is None
    assert AquaculturePondPlOpening.objects.filter(pond=pond, pl_kind="income").count() == 1
    summary = build_pond_opening_summary(company_tenant.id, pond)
    assert Decimal(summary["totals"]["pl_income_signed"]) == Decimal("1000.00")
    assert Decimal(summary["totals"]["pl_expense_signed"]) == Decimal("400.00")
    assert Decimal(summary["totals"]["net_pl_signed"]) == Decimal("600.00")


@pytest.mark.django_db
def test_sync_rejects_lease_expense_category(company_tenant):
    set_company_cutover_date(company_tenant.id, date(2025, 1, 1))
    pond = AquaculturePond.objects.create(company=company_tenant, name="P2", code="P02")
    err = sync_pond_pl_openings(
        company_tenant.id,
        pond.id,
        expense=[{"category_code": "lease", "amount": "100", "as_of_date": "2025-01-01"}],
    )
    assert err is not None
    assert "lease" in err.lower() or "Unknown" in err


@pytest.mark.django_db
def test_summary_includes_employee_linked_to_pond(company_tenant):
    pond = AquaculturePond.objects.create(company=company_tenant, name="P3", code="P03")
    Employee.objects.create(
        company=company_tenant,
        home_aquaculture_pond=pond,
        first_name="Sam",
        last_name="Worker",
        opening_balance=Decimal("50"),
        opening_balance_date="2025-01-01",
    )
    summaries = build_all_pond_opening_summaries(company_tenant.id)
    assert len(summaries) == 1
    emp_lines = [ln for ln in summaries[0]["balance_sheet_lines"] if ln["kind"] == "employee"]
    assert len(emp_lines) == 1
    assert emp_lines[0]["name"] == "Sam Worker"


@pytest.mark.django_db
def test_summary_lists_linked_vendor_with_zero_opening(company_tenant):
    pond = AquaculturePond.objects.create(company=company_tenant, name="P4", code="P04")
    Vendor.objects.create(
        company=company_tenant,
        company_name="Feed Co",
        default_aquaculture_pond=pond,
        opening_balance=Decimal("0"),
    )
    summary = build_pond_opening_summary(company_tenant.id, pond)
    vendor_lines = [ln for ln in summary["balance_sheet_lines"] if ln["kind"] == "vendor"]
    assert len(vendor_lines) == 1
    assert vendor_lines[0]["name"] == "Feed Co"


@pytest.mark.django_db
def test_sync_pl_opening_rejects_as_of_not_equal_cutover(company_tenant):
    set_company_cutover_date(company_tenant.id, date(2026, 5, 22))
    pond = AquaculturePond.objects.create(company=company_tenant, name="Cut", code="C01")
    err = sync_pond_pl_openings(
        company_tenant.id,
        pond.id,
        income=[{"category_code": "fish_harvest_sale", "amount": "100", "as_of_date": "2026-05-21"}],
    )
    assert err is not None
    assert "cutover" in err.lower()


@pytest.mark.django_db
def test_pl_summary_includes_prior_pl_openings(company_tenant):
    set_company_cutover_date(company_tenant.id, date(2026, 5, 22))
    pond = AquaculturePond.objects.create(company=company_tenant, name="PL", code="PL1", is_active=True)
    sync_pond_pl_openings(
        company_tenant.id,
        pond.id,
        income=[{"category_code": "fish_harvest_sale", "amount": "500", "as_of_date": "2026-05-22"}],
        expense=[{"category_code": "feed_purchase", "amount": "200", "as_of_date": "2026-05-22"}],
    )
    payload = compute_aquaculture_pl_summary_dict(
        company_tenant.id,
        date(2026, 1, 1),
        date(2026, 12, 31),
        None,
        None,
        None,
        False,
    )
    row = next(r for r in payload["ponds"] if r["pond_id"] == pond.id)
    assert Decimal(row["prior_pl_opening_income"]) == Decimal("500.00")
    assert Decimal(row["prior_pl_opening_expense"]) == Decimal("200.00")
    assert Decimal(row["revenue"]) == Decimal("500.00")
    assert Decimal(row["operating_expenses"]) == Decimal("200.00")
    assert Decimal(row["profit"]) == Decimal("300.00")


@pytest.mark.django_db
def test_customer_opening_gl_posts_ar_and_equity(company_tenant):
    ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code="1100",
        account_name="AR",
        account_type="asset",
        is_active=True,
    )
    ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code="3200",
        account_name="OBE",
        account_type="equity",
        account_sub_type="opening_balance_equity",
        is_active=True,
    )
    cust = Customer.objects.create(
        company=company_tenant,
        company_name="Pond buyer",
        opening_balance=Decimal("1500"),
        opening_balance_date=date(2026, 5, 22),
    )
    assert post_customer_opening_gl(company_tenant.id, cust)
    lines = JournalEntryLine.objects.filter(journal_entry_id=cust.opening_balance_journal_id)
    assert lines.filter(account__account_code="1100", debit=Decimal("1500.00")).exists()
    assert lines.filter(account__account_code="3200", credit=Decimal("1500.00")).exists()


@pytest.mark.django_db
def test_vendor_opening_gl_posts_ap_and_equity(company_tenant):
    ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code="2000",
        account_name="AP",
        account_type="liability",
        is_active=True,
    )
    ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code="3200",
        account_name="OBE",
        account_type="equity",
        account_sub_type="opening_balance_equity",
        is_active=True,
    )
    vend = Vendor.objects.create(
        company=company_tenant,
        company_name="Feed supplier",
        opening_balance=Decimal("800"),
        opening_balance_date=date(2026, 5, 22),
    )
    assert post_vendor_opening_gl(company_tenant.id, vend)
    lines = JournalEntryLine.objects.filter(journal_entry_id=vend.opening_balance_journal_id)
    assert lines.filter(account__account_code="2000", credit=Decimal("800.00")).exists()
    assert lines.filter(account__account_code="3200", debit=Decimal("800.00")).exists()


@pytest.mark.django_db
def test_sync_requires_cutover_when_configured(company_tenant):
    pond = AquaculturePond.objects.create(company=company_tenant, name="NC", code="NC1")
    err = sync_pond_pl_openings(
        company_tenant.id,
        pond.id,
        income=[{"category_code": "fish_harvest_sale", "amount": "100", "as_of_date": "2026-05-22"}],
    )
    assert err is not None
    assert "cutover" in err.lower()


@pytest.mark.django_db
def test_pond_pl_opening_gl_posts_per_category(company_tenant):
    from api.services.aquaculture_pond_pl_opening_gl import post_pond_pl_opening_gl

    set_company_cutover_date(company_tenant.id, date(2026, 5, 22))
    for code, name, atype in [
        ("4240", "Fish sales", "income"),
        ("6716", "Feed", "expense"),
        ("3200", "OBE", "equity"),
    ]:
        ChartOfAccount.objects.create(
            company_id=company_tenant.id,
            account_code=code,
            account_name=name,
            account_type=atype,
            account_sub_type="opening_balance_equity" if code == "3200" else "",
            is_active=True,
        )
    pond = AquaculturePond.objects.create(company=company_tenant, name="GL", code="GL1")
    sync_pond_pl_openings(
        company_tenant.id,
        pond.id,
        income=[{"category_code": "fish_harvest_sale", "amount": "300", "as_of_date": "2026-05-22"}],
        expense=[{"category_code": "feed_purchase", "amount": "100", "as_of_date": "2026-05-22"}],
    )
    assert post_pond_pl_opening_gl(company_tenant.id, pond.id)
    pond.refresh_from_db()
    lines = JournalEntryLine.objects.filter(journal_entry_id=pond.pl_opening_journal_id)
    assert lines.filter(account__account_code="4240", credit=Decimal("300.00")).exists()
    assert lines.filter(account__account_code="6716", debit=Decimal("100.00")).exists()


@pytest.mark.django_db
def test_employee_opening_gl_posts_payable(company_tenant):
    ChartOfAccount.objects.create(
        company_id=company_tenant.id, account_code="2200", account_name="Payroll", account_type="liability", is_active=True
    )
    ChartOfAccount.objects.create(
        company_id=company_tenant.id,
        account_code="3200",
        account_name="OBE",
        account_type="equity",
        account_sub_type="opening_balance_equity",
        is_active=True,
    )
    from api.models import Employee
    from api.services.party_opening_gl import post_employee_opening_gl

    emp = Employee.objects.create(
        company=company_tenant,
        first_name="A",
        last_name="Worker",
        opening_balance=Decimal("500"),
        opening_balance_date=date(2026, 5, 22),
    )
    assert post_employee_opening_gl(company_tenant.id, emp)
    lines = JournalEntryLine.objects.filter(journal_entry_id=emp.opening_balance_journal_id)
    assert lines.filter(account__account_code="2200", credit=Decimal("500.00")).exists()
