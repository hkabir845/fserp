from decimal import Decimal

from api.utils.measured_quantity import (
    format_measured_quantity_for_api,
    quantize_measured_quantity,
)


def test_quantize_measured_quantity_half_up():
    assert quantize_measured_quantity(Decimal("1.234")) == Decimal("1.23")
    assert quantize_measured_quantity(Decimal("1.235")) == Decimal("1.24")
    assert quantize_measured_quantity(None) is None


def test_format_measured_quantity_for_api_always_two_fraction_digits():
    assert format_measured_quantity_for_api(Decimal("10")) == "10.00"
    assert format_measured_quantity_for_api(Decimal("1.2")) == "1.20"
    assert format_measured_quantity_for_api(Decimal("0.005")) == "0.01"
    assert format_measured_quantity_for_api(None) is None
