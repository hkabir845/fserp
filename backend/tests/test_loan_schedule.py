"""Loan amortization helper tests."""
from decimal import Decimal

from api.services.loan_schedule import amortized_schedule


def test_amortized_zero_rate():
    rows = amortized_schedule(Decimal("1200"), Decimal("0"), 12, 12)
    assert len(rows) == 12
    assert sum(r["principal"] for r in rows) == Decimal("1200")


def test_amortized_with_interest():
    rows = amortized_schedule(Decimal("10000"), Decimal("12"), 12, 12)
    assert len(rows) == 12
    total_prin = sum(r["principal"] for r in rows)
    total_int = sum(r["interest"] for r in rows)
    assert abs(total_prin - Decimal("10000")) < Decimal("1")
    assert total_int > 0


def test_reducing_balance_emi_matches_standard_formula():
    """Benchmark: P=1_000_000, 12% p.a., 48 months — EMI from closed form matches first payment row."""
    p = Decimal("1000000")
    annual = Decimal("12")
    n = 48
    m = Decimal("12")
    r = (annual / Decimal("100")) / m
    one_plus = (Decimal("1") + r) ** n
    emi_expected = p * r * one_plus / (one_plus - Decimal("1"))
    emi_expected = emi_expected.quantize(Decimal("0.01"))
    rows = amortized_schedule(p, annual, n, 12)
    assert len(rows) == 48
    assert rows[0]["payment"] == emi_expected
    assert rows[0]["interest"] == (p * r).quantize(Decimal("0.01"))
    assert rows[-1]["closing_balance"] == Decimal("0")
