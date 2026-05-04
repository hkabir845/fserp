"""Business line quarterly interest preview."""
from datetime import date
from decimal import Decimal

from api.services.loan_business_line import quarterly_interest_schedule_rows


def test_quarterly_rows_count_and_q1_2025_days():
    rows = quarterly_interest_schedule_rows(
        Decimal("100000"),
        Decimal("12"),
        "annual_act_365",
        date(2025, 2, 15),
        4,
    )
    assert len(rows) == 4
    assert rows[0]["period_label"] == "2025 Q1"
    assert rows[0]["days_in_period"] == 90  # Jan 1 – Mar 31
    assert rows[0]["principal"] == "0.00"
    assert Decimal(rows[0]["interest"]) > Decimal("0")


def test_zero_rate_quarterly():
    rows = quarterly_interest_schedule_rows(
        Decimal("50000"), Decimal("0"), "zero", date(2025, 6, 1), 2
    )
    assert all(r["interest"] == "0.00" for r in rows)
