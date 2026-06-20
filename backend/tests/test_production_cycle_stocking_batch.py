from datetime import date
from types import SimpleNamespace

import pytest

from api.models import AquaculturePond, AquacultureProductionCycle, Company
from api.services.aquaculture_production_cycle_service import (
    ensure_destination_cycle_for_transfer,
    extract_vendor_bill_ref_from_cycle,
    link_production_cycles_to_vendor_bills,
    suggest_grow_out_batch_name,
    suggest_nursing_batch_name,
)


@pytest.mark.django_db
def test_suggest_nursing_batch_name():
    name = suggest_nursing_batch_name(
        species_label="Tilapia",
        pond_name="Nursing Pond",
        code="C01",
        start_date=date(2026, 3, 15),
    )
    assert "Tilapia" in name
    assert "C01" in name
    assert "Nursing Pond" in name
    assert "Mar 2026" in name


@pytest.mark.django_db
def test_ensure_destination_cycle_links_nursing_to_grow_out(company_tenant):
    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    co = company_tenant
    nursing = AquaculturePond.objects.create(
        company=co, name="Nursing", pond_role="nursing", code="P01"
    )
    grow = AquaculturePond.objects.create(
        company=co, name="Grow-out 1", pond_role="grow_out", code="P02"
    )
    src = AquacultureProductionCycle.objects.create(
        company=co,
        pond=nursing,
        name="Tilapia fry batch C01",
        code="C01",
        fish_species="tilapia",
        start_date=date(2026, 3, 1),
    )
    dest = ensure_destination_cycle_for_transfer(
        company_id=co.id,
        from_cycle=src,
        to_pond=grow,
        transfer_date=date(2026, 5, 17),
        fish_species="tilapia",
    )
    assert dest.pond_id == grow.id
    assert dest.source_production_cycle_id == src.id
    assert dest.fish_species == "tilapia"
    assert "fingerlings" in dest.name.lower() or "Tilapia" in dest.name

    again = ensure_destination_cycle_for_transfer(
        company_id=co.id,
        from_cycle=src,
        to_pond=grow,
        transfer_date=date(2026, 5, 20),
        fish_species="tilapia",
    )
    assert again.id == dest.id


def test_suggest_grow_out_batch_name():
    name = suggest_grow_out_batch_name(
        species_label="Tilapia",
        source_code="C02",
        source_name="",
        pond_name="Pond 3",
    )
    assert "C02" in name
    assert "Pond 3" in name


@pytest.mark.django_db
def test_non_tilapia_reuses_open_batch_on_second_bill(company_tenant):
    """Pangasius (etc.): one open batch per pond; second bill attaches instead of creating C02."""
    from api.services.aquaculture_production_cycle_service import (
        assign_auto_production_cycles_for_parsed_bill_lines,
    )

    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Pond A", pond_role="grow_out", code="P03"
    )
    bill1 = SimpleNamespace(bill_number="B-1", bill_date=date(2026, 4, 1), pk=1)
    lines1 = [
        {
            "aquaculture_pond_id": pond.id,
            "aquaculture_fish_species": "pangasius",
        }
    ]
    assign_auto_production_cycles_for_parsed_bill_lines(company_tenant.id, bill1, lines1)
    first_id = lines1[0]["aquaculture_production_cycle_id"]
    assert first_id

    bill2 = SimpleNamespace(bill_number="B-2", bill_date=date(2026, 6, 1), pk=2)
    lines2 = [
        {
            "aquaculture_pond_id": pond.id,
            "aquaculture_fish_species": "pangasius",
        }
    ]
    assign_auto_production_cycles_for_parsed_bill_lines(company_tenant.id, bill2, lines2)
    assert lines2[0]["aquaculture_production_cycle_id"] == first_id
    assert (
        AquacultureProductionCycle.objects.filter(company_id=company_tenant.id, pond_id=pond.id).count()
        == 1
    )


@pytest.mark.django_db
def test_tilapia_creates_new_batch_per_bill(company_tenant):
    from api.services.aquaculture_production_cycle_service import assign_auto_production_cycles_for_parsed_bill_lines

    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Nursing", pond_role="nursing", code="P01"
    )
    for n in (1, 2):
        bill = SimpleNamespace(bill_number=f"T-{n}", bill_date=date(2026, 3, n), pk=n)
        lines = [{"aquaculture_pond_id": pond.id, "aquaculture_fish_species": "tilapia"}]
        assign_auto_production_cycles_for_parsed_bill_lines(company_tenant.id, bill, lines)
    assert AquacultureProductionCycle.objects.filter(company_id=company_tenant.id, pond_id=pond.id).count() == 2


@pytest.mark.django_db
def test_link_production_cycles_to_vendor_bills(company_tenant):
    from api.models import Bill, BillLine, Vendor

    Company.objects.filter(pk=company_tenant.id).update(aquaculture_enabled=True, aquaculture_licensed=True)
    pond = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Mynuddin Pond", pond_role="grow_out", code="P01"
    )
    vendor = Vendor.objects.create(company_id=company_tenant.id, company_name="Hatchery")
    bill = Bill.objects.create(
        company_id=company_tenant.id,
        vendor=vendor,
        bill_number="BILL-304",
        bill_date=date(2026, 6, 20),
        status="open",
        total=100,
    )
    BillLine.objects.create(
        bill=bill,
        description="Fry",
        quantity=1,
        unit_price=100,
        amount=100,
        aquaculture_pond_id=pond.id,
    )
    cycle = AquacultureProductionCycle.objects.create(
        company_id=company_tenant.id,
        pond=pond,
        name="Mynuddin Pond — BILL-304",
        code="C01",
        fish_species="tilapia",
        start_date=date(2026, 6, 20),
        notes="Auto-created from vendor bill BILL-304.",
    )
    assert extract_vendor_bill_ref_from_cycle(cycle) == "BILL-304"

    stats = link_production_cycles_to_vendor_bills(company_tenant.id)
    assert stats["lines_linked"] == 1
    bill.lines.get().refresh_from_db()
    assert bill.lines.get().aquaculture_production_cycle_id == cycle.id
