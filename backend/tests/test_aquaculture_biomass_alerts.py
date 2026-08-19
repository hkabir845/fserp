"""
Pond biomass load alert.

A pond is stressed by the weight of fish it carries, not the head count, so the alert is driven
by kg per decimal against the pond's comfort band. `severity` is always green / yellow / red so
the UI can switch on it exhaustively.
"""
from decimal import Decimal

import pytest

from api.services.aquaculture_partial_harvest import (
    compute_biomass_load_advice_dict,
    pond_biomass_alert_summary,
)

SEVERITIES = {"green", "yellow", "red"}


def test_overloaded_pond_is_red_and_says_how_much_to_remove():
    alert = pond_biomass_alert_summary(
        {
            "load_level": "high_risk",
            "stock_density_kg_per_decimal": "60",
            "water_area_decimal": "10",
            "partial_harvest_applicable": True,
            "partial_harvest_suggested_kg": "500",
            "partial_harvest_rationale": "Biomass is above the comfort band.",
        }
    )
    assert alert["severity"] == "red"
    assert "reduce fish" in alert["action"].lower()
    assert alert["suggested_reduction_kg"] == "500"


def test_pond_at_full_capacity_is_yellow_before_it_becomes_a_problem():
    alert = pond_biomass_alert_summary(
        {
            "load_level": "full",
            "stock_density_kg_per_decimal": "38",
            "water_area_decimal": "10",
            "partial_harvest_applicable": True,
            "partial_harvest_suggested_kg": "180",
        }
    )
    assert alert["severity"] == "yellow"
    assert "harvest" in alert["action"].lower() or "transfer" in alert["action"].lower()


def test_understocked_pond_is_green_with_nothing_to_remove():
    alert = pond_biomass_alert_summary(
        {
            "load_level": "understocked",
            "stock_density_kg_per_decimal": "4",
            "water_area_decimal": "10",
        }
    )
    assert alert["severity"] == "green"
    assert alert["suggested_reduction_kg"] is None


def test_missing_pond_area_asks_for_it_instead_of_claiming_the_pond_is_safe():
    """Every band is kg per decimal, so with no area a green light would be a false all-clear."""
    alert = pond_biomass_alert_summary(
        {"load_level": "high_risk", "stock_density_kg_per_decimal": None, "water_area_decimal": None}
    )
    assert alert["severity"] == "yellow"
    assert "area" in alert["action"].lower()


def test_no_row_at_all_does_not_raise():
    alert = pond_biomass_alert_summary(None)
    assert alert["severity"] == "green"
    assert alert["suggested_reduction_kg"] is None


@pytest.mark.parametrize(
    "load_level", ["understocked", "moderate", "full", "high_risk", "unknown", ""]
)
def test_every_load_level_yields_a_usable_alert(load_level):
    """The vocabulary is understocked|moderate|full|high_risk|unknown - none may fall through."""
    alert = pond_biomass_alert_summary(
        {
            "load_level": load_level,
            "stock_density_kg_per_decimal": "20",
            "water_area_decimal": "10",
        }
    )
    assert alert["severity"] in SEVERITIES, alert
    assert alert["action"] and alert["reason"]


@pytest.mark.parametrize(
    "biomass,expected",
    [(Decimal("40"), "green"), (Decimal("2000"), "red")],
)
def test_the_alert_is_produced_by_the_real_advice_row(biomass, expected):
    """
    Guards against the alert being dead code: computing load advice must emit it, so every
    caller of the advice row gets the alert without asking for it.
    """
    row = compute_biomass_load_advice_dict(
        biomass_kg=biomass,
        fish_count=1000,
        water_area_decimal=Decimal("10"),
        water_volume_cu_ft=None,
        pond_role="grow_out",
        fish_per_kg=None,
    )
    assert "biomass_alert" in row, "the advice row no longer carries the alert"
    alert = row["biomass_alert"]
    assert alert["severity"] in SEVERITIES
    assert alert["severity"] == expected, (
        f"{biomass} kg over 10 decimal read as {alert['severity']}: {alert['reason']}"
    )
