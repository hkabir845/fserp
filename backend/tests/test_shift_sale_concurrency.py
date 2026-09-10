from decimal import Decimal

import pytest
from django.utils import timezone

from api.exceptions import StockBusinessError
from api.models import ShiftSession, Station
from api.services.shift_sales import record_invoice_on_shift


pytestmark = pytest.mark.django_db


def test_sale_is_rejected_when_shift_closed_before_rollup(company_tenant):
    shift = ShiftSession.objects.create(
        company=company_tenant,
        opened_at=timezone.now(),
        closed_at=timezone.now(),
    )

    with pytest.raises(StockBusinessError, match="shift closed"):
        record_invoice_on_shift(
            company_tenant.id,
            shift.id,
            Decimal("100.00"),
            "cash",
        )

    shift.refresh_from_db()
    assert shift.total_sales_amount == Decimal("0")
    assert shift.expected_cash_total == Decimal("0")


def test_open_shift_sale_increments_expected_cash(company_tenant):
    st = Station.objects.create(company=company_tenant, station_name="Shift Site A")
    shift = ShiftSession.objects.create(
        company=company_tenant,
        station=st,
        opened_at=timezone.now(),
    )
    record_invoice_on_shift(company_tenant.id, shift.id, Decimal("250.50"), "cash")
    shift.refresh_from_db()
    assert shift.total_sales_amount == Decimal("250.50")
    assert shift.expected_cash_total == Decimal("250.50")


def test_two_open_shifts_same_station_still_allowed_until_constraint(company_tenant):
    """Until a partial unique index lands, two open shifts on one station remain possible."""
    st = Station.objects.create(company=company_tenant, station_name="Shift Site B")
    ShiftSession.objects.create(
        company=company_tenant, station=st, opened_at=timezone.now()
    )
    ShiftSession.objects.create(
        company=company_tenant, station=st, opened_at=timezone.now()
    )
    assert (
        ShiftSession.objects.filter(
            company=company_tenant, station=st, closed_at__isnull=True
        ).count()
        == 2
    )
