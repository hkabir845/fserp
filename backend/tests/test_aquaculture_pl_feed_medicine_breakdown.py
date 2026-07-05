"""Pond P&L includes feed/medicine consumption columns and reconciling totals."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from django.utils import timezone

from api.models import (
    AquacultureExpense,
    AquacultureExpenseInventoryLine,
    AquacultureFishSale,
    AquaculturePond,
    ChartOfAccount,
    Company,
    Item,
    JournalEntry,
    JournalEntryLine,
    Station,
)
from api.services.aquaculture_constants import (
    AQUACULTURE_EXPENSE_CATEGORY_CHOICES,
    AQUACULTURE_INCOME_TYPE_CHOICES,
)
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict


def _enable(c: Company) -> None:
    Company.objects.filter(pk=c.id).update(aquaculture_enabled=True, aquaculture_licensed=True)


@pytest.mark.django_db
def test_pl_breaks_out_feed_medicine_and_other_expenses(company_tenant):
    _enable(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="PL Pond", is_active=True)

    AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_category="feed_consumed",
        expense_date=date(2026, 5, 4),
        amount=Decimal("1200.00"),
        feed_weight_kg=Decimal("25.0000"),
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_category="medicine_consumed",
        expense_date=date(2026, 5, 6),
        amount=Decimal("300.00"),
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_category="day_labor",
        expense_date=date(2026, 5, 8),
        amount=Decimal("500.00"),
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_category="lease",
        expense_date=date(2026, 5, 9),
        amount=Decimal("400.00"),
    )

    AquacultureFishSale.objects.create(
        company_id=cid,
        pond=pond,
        sale_date=date(2026, 5, 10),
        income_type="fish_harvest_sale",
        weight_kg=Decimal("100"),
        total_amount=Decimal("50000.00"),
    )
    AquacultureFishSale.objects.create(
        company_id=cid,
        pond=pond,
        sale_date=date(2026, 5, 11),
        income_type="empty_feed_sack_sale",
        weight_kg=Decimal("5"),
        total_amount=Decimal("250.00"),
    )

    payload = compute_aquaculture_pl_summary_dict(
        cid,
        date(2026, 5, 1),
        date(2026, 5, 31),
        pond_filter_id=None,
        cycle_filter_id=None,
        scoped_cycle=None,
        include_cycle_breakdown=False,
    )
    row = next(r for r in payload["ponds"] if r["pond_id"] == pond.id)
    assert row["feed_consumption_cost"] == "1200.00"
    assert row["medicine_consumption_cost"] == "300.00"
    assert row["lease_cost"] == "400.00"
    assert row["revenue_fish_sales"] == "50000.00"
    assert row["revenue_empty_sack_sales"] == "250.00"
    assert Decimal(row["revenue"]) == Decimal("50250.00")
    assert Decimal(row["other_operating_expenses"]) >= Decimal("500.00")

    totals = payload["totals"]
    assert totals["feed_consumption_cost"] == "1200.00"
    assert totals["medicine_consumption_cost"] == "300.00"
    assert totals["lease_cost"] == "400.00"
    assert totals["revenue_fish_sales"] == "50000.00"
    assert totals["revenue_empty_sack_sales"] == "250.00"
    assert (
        Decimal(totals["feed_consumption_cost"])
        + Decimal(totals["medicine_consumption_cost"])
        + Decimal(totals["fry_fingerling_cost"])
        + Decimal(totals["lease_cost"])
        + Decimal(totals["other_operating_expenses"])
        == Decimal(totals["operating_expenses"])
    )
    assert (
        Decimal(totals["revenue_fish_sales"])
        + Decimal(totals["revenue_empty_sack_sales"])
        + Decimal(totals["revenue_other_income"])
        == Decimal(totals["revenue"])
    )

    income_cats = {c["category"]: c["amount"] for c in payload["income_by_category"]}
    assert income_cats.get("fish_harvest_sale") == "50000.00"
    assert income_cats.get("empty_feed_sack_sale") == "250.00"
    assert len(payload["income_by_pond"]) >= 1
    exp_cats = {c["category"]: c["amount"] for c in payload["expenses_by_category"]}
    assert exp_cats.get("feed_consumed") == "1200.00"
    assert exp_cats.get("medicine_consumed") == "300.00"
    assert exp_cats.get("lease") == "400.00"
    assert exp_cats.get("day_labor") == "500.00"

    expense_codes = {c["code"] for c in payload["pl_expense_columns"]}
    for required in (
        "feed_consumed",
        "medicine_consumed",
        "pond_care_products",
        "worker_salary",
        "payroll_allocated",
        "lease",
        "equipment",
        "other",
    ):
        assert required in expense_codes, f"missing P&L expense column {required}"

    assert row["salaries_and_payroll_cost"] == "0.00"
    assert row["pond_care_products_cost"] == "0.00"
    assert row["equipment_cost"] == "0.00"
    assert Decimal(row["income_total"]) == Decimal(row["revenue"])
    assert Decimal(row["expense_total"]) == Decimal(row["total_costs"])
    assert Decimal(row["net_profit"]) == Decimal(row["income_total"]) - Decimal(row["expense_total"])

    gt = payload["pl_grand_totals"]
    assert Decimal(gt["net_profit"]) == Decimal(gt["total_income"]) - Decimal(gt["total_costs_and_expenses"])

    assert payload["pl_show_full_catalog"] is True
    assert len(payload["pl_income_columns"]) == len(AQUACULTURE_INCOME_TYPE_CHOICES)
    assert len(payload["pl_expense_columns"]) >= len(AQUACULTURE_EXPENSE_CATEGORY_CHOICES)
    pond_exp = next(g for g in payload["expenses_by_pond"] if g["pond_id"] == pond.id)
    soilcut_row = next(c for c in pond_exp["categories"] if c["category"] == "soilcut")
    assert soilcut_row["amount"] == "0.00"


@pytest.mark.django_db
def test_pl_shop_feed_issue_rolls_into_feed_consumed_column(company_tenant):
    _enable(company_tenant)
    cid = company_tenant.id
    pond = AquaculturePond.objects.create(company_id=cid, name="Shop Pond", is_active=True)
    station = Station.objects.create(company_id=cid, station_name="Main Shop", is_active=True)
    item = Item.objects.create(
        company_id=cid,
        name="Grower Feed",
        item_type="inventory",
        unit="kg",
        cost=Decimal("10"),
        unit_price=Decimal("10"),
        quantity_on_hand=Decimal("0"),
        is_active=True,
    )
    exp = AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_category="feed_purchase",
        expense_date=date(2026, 5, 7),
        amount=Decimal("450.00"),
        source_station=station,
    )
    AquacultureExpenseInventoryLine.objects.create(
        expense=exp,
        item=item,
        quantity=Decimal("45.0000"),
        source_station=station,
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_category="medicine_purchase",
        expense_date=date(2026, 5, 8),
        amount=Decimal("120.00"),
        source_station=station,
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=pond,
        expense_category="pond_care_products",
        expense_date=date(2026, 5, 9),
        amount=Decimal("80.00"),
        source_station=station,
    )

    payload = compute_aquaculture_pl_summary_dict(
        cid,
        date(2026, 5, 1),
        date(2026, 5, 31),
        pond_filter_id=None,
        cycle_filter_id=None,
        scoped_cycle=None,
        include_cycle_breakdown=False,
    )
    row = next(r for r in payload["ponds"] if r["pond_id"] == pond.id)
    assert row["feed_consumption_cost"] == "450.00"
    assert row["medicine_consumption_cost"] == "120.00"
    assert row["other_consumption_cost"] == "80.00"

    exp_cats = {c["category"]: c["amount"] for c in payload["expenses_by_category"]}
    assert exp_cats.get("feed_consumed") == "450.00"
    assert exp_cats.get("medicine_consumed") == "120.00"
    assert exp_cats.get("pond_care_products") == "80.00"
    assert exp_cats.get("feed_purchase", "0.00") == "0.00"
    assert exp_cats.get("medicine_purchase", "0.00") == "0.00"


@pytest.mark.django_db
def test_pl_pond_filter_includes_feed_consumption_in_matrix(company_tenant):
    _enable(company_tenant)
    cid = company_tenant.id
    p1 = AquaculturePond.objects.create(company_id=cid, name="Filtered Pond", is_active=True)
    p2 = AquaculturePond.objects.create(company_id=cid, name="Other Pond", is_active=True)

    AquacultureExpense.objects.create(
        company_id=cid,
        pond=p1,
        expense_category="feed_consumed",
        expense_date=date(2026, 5, 4),
        amount=Decimal("1200.00"),
        feed_weight_kg=Decimal("25.0000"),
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=p2,
        expense_category="feed_consumed",
        expense_date=date(2026, 5, 4),
        amount=Decimal("900.00"),
    )

    payload = compute_aquaculture_pl_summary_dict(
        cid,
        date(2026, 5, 1),
        date(2026, 5, 31),
        pond_filter_id=p1.id,
        cycle_filter_id=None,
        scoped_cycle=None,
        include_cycle_breakdown=False,
    )
    assert len(payload["ponds"]) == 1
    row = payload["ponds"][0]
    assert row["pond_id"] == p1.id
    assert row["feed_consumption_cost"] == "1200.00"

    exp_cats = {c["category"]: c["amount"] for c in payload["expenses_by_category"]}
    assert exp_cats.get("feed_consumed") == "1200.00"
    assert payload["totals"]["feed_consumption_cost"] == "1200.00"

    pond_exp = payload["expenses_by_pond"][0]
    feed_row = next(c for c in pond_exp["categories"] if c["category"] == "feed_consumed")
    assert feed_row["amount"] == "1200.00"


@pytest.mark.django_db
def test_pl_vendor_bill_pond_lines_break_out_by_category(company_tenant_with_gl):
    _enable(company_tenant_with_gl)
    cid = company_tenant_with_gl.id
    pond = AquaculturePond.objects.create(company_id=cid, name="Bill Pond", is_active=True)
    expense = ChartOfAccount.objects.get(company_id=cid, account_code="6900")
    cash = ChartOfAccount.objects.get(company_id=cid, account_code="1010")

    je = JournalEntry.objects.create(
        company_id=cid,
        entry_number="AUTO-BILL-TEST-PL-1",
        entry_date=date(2026, 6, 10),
        is_posted=True,
        posted_at=timezone.now(),
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=expense,
        aquaculture_pond_id=pond.id,
        aquaculture_cost_bucket="electricity",
        debit=Decimal("600.00"),
        credit=Decimal("0"),
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=expense,
        aquaculture_pond_id=pond.id,
        aquaculture_cost_bucket="day_labor",
        debit=Decimal("350.00"),
        credit=Decimal("0"),
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=cash,
        aquaculture_pond_id=pond.id,
        debit=Decimal("0"),
        credit=Decimal("950.00"),
    )

    payload = compute_aquaculture_pl_summary_dict(
        cid,
        date(2026, 6, 1),
        date(2026, 6, 30),
        pond_filter_id=pond.id,
        cycle_filter_id=None,
        scoped_cycle=None,
        include_cycle_breakdown=False,
    )
    exp_cats = {c["category"]: c["amount"] for c in payload["expenses_by_category"]}
    assert exp_cats.get("electricity") == "600.00"
    assert exp_cats.get("day_labor") == "350.00"
    assert exp_cats.get("vendor_bill_pond", "0.00") == "0.00"
    row = payload["ponds"][0]
    assert Decimal(row["other_operating_expenses"]) >= Decimal("950.00")
