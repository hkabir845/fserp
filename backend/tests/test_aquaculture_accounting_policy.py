"""Unit tests for locked aquaculture accounting policy helpers."""
from decimal import Decimal

from api.services.aquaculture_accounting_policy import (
    BIO_CAP_SHARE_WARN_THRESHOLD,
    bio_cap_needs_ops_warning,
    bio_cap_unrelieved_share,
    biomass_divergence_ratio,
    classify_biomass_band,
)


def test_bio_cap_share_none_when_fully_relieved():
    assert bio_cap_unrelieved_share(100, 100) is None
    assert bio_cap_unrelieved_share(100, 120) is None
    assert bio_cap_unrelieved_share(0, 0) is None


def test_bio_cap_share_and_ops_warning_threshold():
    share = bio_cap_unrelieved_share(Decimal("373103.24"), Decimal("202824.66"))
    assert share is not None
    assert share > BIO_CAP_SHARE_WARN_THRESHOLD
    warn, got = bio_cap_needs_ops_warning(Decimal("373103.24"), Decimal("202824.66"))
    assert warn is True
    assert got == share

    warn_small, share_small = bio_cap_needs_ops_warning(Decimal("44118.45"), Decimal("43878.45"))
    assert warn_small is False
    assert share_small is not None
    assert share_small < BIO_CAP_SHARE_WARN_THRESHOLD


def test_biomass_bands():
    assert classify_biomass_band(100, 90) == "normal"  # 10%
    assert classify_biomass_band(100, 80) == "review"  # 20%
    assert classify_biomass_band(100, 70) == "investigate"  # 30%
    assert classify_biomass_band(100, 125) == "investigate"  # eff/book > 1.20
    assert classify_biomass_band(0, 0) == "skip"
    assert biomass_divergence_ratio(100, 80) == Decimal("0.2000")
