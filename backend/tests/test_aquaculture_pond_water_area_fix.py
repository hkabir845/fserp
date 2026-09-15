"""Extra trailing zero on named pond water areas (4000/13200/8000 → 400/1320/800)."""
from __future__ import annotations

from decimal import Decimal

import pytest

from api.models import AquaculturePond
from api.services.aquaculture_pond_water_area_fix import (
    apply_extra_zero_water_area_corrections,
    canonical_water_area_decimal,
    is_extra_zero_water_area,
    normalize_pond_area_name,
)


def test_name_normalization_matches_live_adib_labels():
    assert normalize_pond_area_name("Digonto Pond") == "digonto pond"
    assert normalize_pond_area_name("Ashari - 2 Pond") == "ashari 2 pond"
    assert normalize_pond_area_name("Ashari-2") == "ashari 2"
    assert normalize_pond_area_name("Mynuddin Nursing Pond") == "mynuddin nursing pond"
    assert canonical_water_area_decimal("Digonta") == Decimal("400.00")
    assert canonical_water_area_decimal("Ashari - 2 Pond") == Decimal("1320.00")
    assert canonical_water_area_decimal("Mynuddin Nursing Pond") == Decimal("800.00")
    assert canonical_water_area_decimal("Mynuddin Nursing Pond - 2") is None
    assert canonical_water_area_decimal("Digonto Nursing Pond") is None
    assert canonical_water_area_decimal("Ashari - 1 Pond") is None


def test_extra_zero_predicate():
    assert is_extra_zero_water_area(Decimal("4000.00"), Decimal("400.00"))
    assert is_extra_zero_water_area(Decimal("13200"), Decimal("1320"))
    assert is_extra_zero_water_area(Decimal("8000"), Decimal("800"))
    assert not is_extra_zero_water_area(Decimal("400.00"), Decimal("400.00"))
    assert not is_extra_zero_water_area(Decimal("750.00"), Decimal("400.00"))
    assert not is_extra_zero_water_area(None, Decimal("400.00"))


@pytest.mark.django_db
def test_apply_strips_extra_zero_and_is_idempotent(company_tenant):
    cid = company_tenant.id
    digonta = AquaculturePond.objects.create(
        company_id=cid, name="Digonto Pond", water_area_decimal=Decimal("4000.00")
    )
    ashari2 = AquaculturePond.objects.create(
        company_id=cid, name="Ashari - 2 Pond", water_area_decimal=Decimal("13200.00")
    )
    nursing = AquaculturePond.objects.create(
        company_id=cid, name="Mynuddin Nursing Pond", water_area_decimal=Decimal("8000.00")
    )
    other = AquaculturePond.objects.create(
        company_id=cid, name="Mynuddin Pond", water_area_decimal=Decimal("750.00")
    )
    already_ok = AquaculturePond.objects.create(
        company_id=cid, name="Digonta", water_area_decimal=Decimal("400.00")
    )
    sibling = AquaculturePond.objects.create(
        company_id=cid, name="Mynuddin Nursing Pond - 2", water_area_decimal=Decimal("8000.00")
    )

    first = apply_extra_zero_water_area_corrections(company_id=cid)
    names = {row["name"] for row in first}
    assert names == {"Digonto Pond", "Ashari - 2 Pond", "Mynuddin Nursing Pond"}

    digonta.refresh_from_db()
    ashari2.refresh_from_db()
    nursing.refresh_from_db()
    other.refresh_from_db()
    already_ok.refresh_from_db()
    sibling.refresh_from_db()
    assert digonta.water_area_decimal == Decimal("400.00")
    assert ashari2.water_area_decimal == Decimal("1320.00")
    assert nursing.water_area_decimal == Decimal("800.00")
    assert other.water_area_decimal == Decimal("750.00")
    assert already_ok.water_area_decimal == Decimal("400.00")
    assert sibling.water_area_decimal == Decimal("8000.00")

    second = apply_extra_zero_water_area_corrections(company_id=cid)
    assert second == []
