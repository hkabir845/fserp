"""Entity P&L reports: fuel stations, shop hubs (no fuel), and ponds as separate groups."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from django.utils import timezone

from api.models import AquaculturePond, ChartOfAccount, JournalEntry, JournalEntryLine, Station
from api.services.reporting import (
    report_entities_pl_summary,
    report_fuel_stations_pl_summary,
    report_ponds_pl_summary,
    report_shop_hubs_pl_summary,
    report_stations_financial_summary,
)

pytestmark = pytest.mark.django_db


def _post_station_income(company_id: int, station_id: int, amount: str, tag: str):
    income = ChartOfAccount.objects.get(company_id=company_id, account_code="4200")
    cash = ChartOfAccount.objects.get(company_id=company_id, account_code="1010")
    je = JournalEntry.objects.create(
        company_id=company_id,
        entry_number=f"ENT-SPLIT-{tag}",
        entry_date=date(2026, 8, 15),
        station_id=station_id,
        is_posted=True,
        posted_at=timezone.now(),
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=income,
        station_id=station_id,
        debit=Decimal("0"),
        credit=Decimal(amount),
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=cash,
        station_id=station_id,
        debit=Decimal(amount),
        credit=Decimal("0"),
    )


def _post_pond_income(company_id: int, pond_id: int, amount: str, tag: str):
    income = ChartOfAccount.objects.get(company_id=company_id, account_code="4200")
    cash = ChartOfAccount.objects.get(company_id=company_id, account_code="1010")
    je = JournalEntry.objects.create(
        company_id=company_id,
        entry_number=f"POND-SPLIT-{tag}",
        entry_date=date(2026, 8, 15),
        is_posted=True,
        posted_at=timezone.now(),
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=income,
        aquaculture_pond_id=pond_id,
        debit=Decimal("0"),
        credit=Decimal(amount),
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=cash,
        aquaculture_pond_id=pond_id,
        debit=Decimal(amount),
        credit=Decimal("0"),
    )


def test_entity_pl_splits_fuel_shop_and_pond(company_tenant_with_gl):
    cid = company_tenant_with_gl.id
    fuel = Station.objects.create(
        company_id=cid,
        station_name="Fuel Site",
        operates_fuel_retail=True,
        is_active=True,
    )
    shop = Station.objects.create(
        company_id=cid,
        station_name="Premium Agro Shop",
        operates_fuel_retail=False,
        is_active=True,
    )
    pond = AquaculturePond.objects.create(company_id=cid, name="Pond One", is_active=True)

    _post_station_income(cid, fuel.id, "100", "FUEL")
    _post_station_income(cid, shop.id, "50", "SHOP")
    _post_pond_income(cid, pond.id, "30", "P1")

    start, end = date(2026, 8, 1), date(2026, 8, 31)
    pl = report_entities_pl_summary(cid, start, end)

    assert len(pl["by_fuel_station"]) == 1
    assert len(pl["by_shop_hub"]) == 1
    assert len(pl["by_pond"]) == 1
    assert pl["by_fuel_station"][0]["station_id"] == fuel.id
    assert pl["by_shop_hub"][0]["station_id"] == shop.id
    assert pl["by_shop_hub"][0]["business_kind"] == "shop_hub"

    seg = pl["segment_totals"]
    assert Decimal(str(seg["fuel_stations"]["income"])) == Decimal("100.00")
    assert Decimal(str(seg["shop_hubs"]["income"])) == Decimal("50.00")
    assert Decimal(str(seg["ponds"]["income"])) == Decimal("30.00")

    fuel_only = report_fuel_stations_pl_summary(cid, start, end)
    assert fuel_only["report_id"] == "fuel-stations-pl-summary"
    assert len(fuel_only["fuel_stations"]) == 1
    assert Decimal(str(fuel_only["category_total"]["income"])) == Decimal("100.00")

    shop_only = report_shop_hubs_pl_summary(cid, start, end)
    assert shop_only["report_id"] == "shop-hubs-pl-summary"
    assert len(shop_only["shop_hubs"]) == 1
    assert Decimal(str(shop_only["category_total"]["income"])) == Decimal("50.00")

    stations = report_stations_financial_summary(cid, start, end)
    assert len(stations["fuel_stations"]) == 1
    assert len(stations["shop_hubs"]) == 1

    ponds = report_ponds_pl_summary(cid, start, end)
    assert len(ponds["ponds"]) == 1
    assert Decimal(str(ponds["ponds_total"]["income"])) == Decimal("30.00")
