"""Same physical site: nursing ↔ grow-out phase ponds."""

from __future__ import annotations

import pytest

from api.models import AquaculturePond, BillLine, Item
from api.services.aquaculture_pond_display import (
    bill_line_pond_display_name,
    pond_grow_out_display_name,
    pond_nursing_display_name,
)
from api.services.aquaculture_pond_site import (
    default_grow_out_name_for_site,
    default_nursing_name_for_site,
    same_site_grow_out_pond,
    same_site_nursing_pond,
    validate_nursing_grow_out_link,
)


@pytest.mark.django_db
def test_mynuddin_site_phase_names(company_tenant):
    grow = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Mynuddin Pond",
        pond_role="grow_out",
        physical_site_name="Mynuddin",
        is_active=True,
    )
    nursing = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Mynuddin",
        pond_role="nursing",
        physical_site_name="Mynuddin",
        linked_grow_out_pond=grow,
        is_active=True,
    )
    assert pond_nursing_display_name(nursing) == "Mynuddin Nursing Pond"
    assert pond_grow_out_display_name(grow) == "Mynuddin Pond"
    assert same_site_grow_out_pond(nursing).id == grow.id
    assert same_site_nursing_pond(grow).id == nursing.id


@pytest.mark.django_db
def test_fry_bill_shows_nursing_pond_label(company_tenant):
    grow = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Mynuddin Pond",
        pond_role="grow_out",
        physical_site_name="Mynuddin",
        is_active=True,
    )
    nursing = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Mynuddin Nursing Pond",
        pond_role="nursing",
        physical_site_name="Mynuddin",
        linked_grow_out_pond=grow,
        is_active=True,
    )
    fry = Item.objects.create(
        company_id=company_tenant.id,
        name="Tilapia Fry",
        item_type="inventory",
        pos_category="fish",
        unit="piece",
    )
    line = BillLine(
        item=fry,
        aquaculture_fish_count=500_000,
        aquaculture_fish_species="tilapia",
    )
    assert bill_line_pond_display_name(nursing, line) == "Mynuddin Nursing Pond"


@pytest.mark.django_db
def test_default_site_pair_names():
    assert default_nursing_name_for_site("Mynuddin") == "Mynuddin Nursing Pond"
    assert default_grow_out_name_for_site("Mynuddin") == "Mynuddin"


@pytest.mark.django_db
def test_link_requires_matching_site(company_tenant):
    nursing = AquaculturePond(
        company_id=company_tenant.id,
        name="A Nursing",
        pond_role="nursing",
        physical_site_name="Alpha",
    )
    grow = AquaculturePond(
        company_id=company_tenant.id,
        name="B Pond",
        pond_role="grow_out",
        physical_site_name="Beta",
    )
    assert validate_nursing_grow_out_link(nursing, grow) is not None
