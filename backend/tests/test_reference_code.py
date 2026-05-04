"""Unit tests for gap-aware reference code helpers."""
import pytest

from api.services import reference_code as rc


def test_parse_suffix():
    assert rc.parse_suffix("NZL-12", "NZL") == 12
    assert rc.parse_suffix("nzl-1", "NZL") == 1
    assert rc.parse_suffix("CUST-99", "CUST") == 99
    assert rc.parse_suffix("X-1", "NZL") is None
    assert rc.parse_suffix("", "NZL") is None


def test_format_code():
    assert rc.format_code("NZL", 4) == "NZL-4"
    assert rc.format_code("EMP", 1, 5) == "EMP-00001"


def test_first_free_suffix():
    assert rc.first_free_suffix(set()) == 1
    assert rc.first_free_suffix({3}) == 1
    assert rc.first_free_suffix({1, 2, 3}) == 4
    assert rc.first_free_suffix({1, 3}) == 2


def test_choice_suffixes():
    assert rc.choice_suffixes(set()) == [1]
    assert rc.choice_suffixes({3}) == [1, 2, 4]
    assert rc.choice_suffixes({1, 2, 3}) == [4]


def test_suggest_payload_choice_codes(db, company_tenant):
    from api.models import Nozzle, Meter, Tank, Item, Station, Island, Dispenser

    cid = company_tenant.id
    st = Station.objects.create(
        company_id=cid, station_name="S", station_number="S1", is_active=True
    )
    isl = Island.objects.create(
        company_id=cid, station_id=st.id, island_name="I", island_code="I1", is_active=True
    )
    d = Dispenser.objects.create(
        company_id=cid, island_id=isl.id, dispenser_name="D", dispenser_code="D1", is_active=True
    )
    m1 = Meter.objects.create(
        company_id=cid, dispenser_id=d.id, meter_name="M1", meter_number="M-1", is_active=True
    )
    m2 = Meter.objects.create(
        company_id=cid, dispenser_id=d.id, meter_name="M2", meter_number="M-2", is_active=True
    )
    prod = Item.objects.create(company_id=cid, name="Fuel", item_type="inventory")
    tank = Tank.objects.create(
        company_id=cid, station_id=st.id, product_id=prod.id, tank_name="T1", is_active=True
    )
    Nozzle.objects.create(
        company_id=cid,
        meter_id=m1.id,
        tank_id=tank.id,
        product_id=prod.id,
        nozzle_name="N",
        nozzle_number="NZL-1",
    )
    Nozzle.objects.create(
        company_id=cid,
        meter_id=m2.id,
        tank_id=tank.id,
        product_id=prod.id,
        nozzle_name="N2",
        nozzle_number="NZL-3",
    )

    p = rc.suggest_payload(cid, Nozzle, "nozzle_number", "NZL", None)
    assert p["default_suffix"] == 2
    assert p["default_code"] == "NZL-2"
    assert p["choice_suffixes"] == [2, 4]
    assert p["choice_codes"] == ["NZL-2", "NZL-4"]
