"""Permanent Aquaculture tenants (Adib Filling Station)."""

from types import SimpleNamespace

from api.services.aquaculture_company_flags import (
    effective_aquaculture_enabled,
    effective_aquaculture_licensed,
    ensure_permanent_aquaculture_db_flags,
    is_permanent_aquaculture_company,
)


def test_adib_by_company_code_is_permanent():
    c = SimpleNamespace(company_code="FS-000002", name="Other", aquaculture_enabled=False, aquaculture_licensed=False)
    assert is_permanent_aquaculture_company(c) is True
    assert effective_aquaculture_enabled(c) is True
    assert effective_aquaculture_licensed(c) is True


def test_adib_by_name_is_permanent():
    c = SimpleNamespace(company_code="", name="Adib Filling Station", aquaculture_enabled=False, aquaculture_licensed=False)
    assert is_permanent_aquaculture_company(c) is True
    assert effective_aquaculture_enabled(c) is True


def test_other_company_uses_db_flags():
    off = SimpleNamespace(company_code="FS-009999", name="Fuel Only", aquaculture_enabled=False, aquaculture_licensed=False)
    on = SimpleNamespace(company_code="FS-009999", name="Fuel Only", aquaculture_enabled=True, aquaculture_licensed=True)
    assert is_permanent_aquaculture_company(off) is False
    assert effective_aquaculture_enabled(off) is False
    assert effective_aquaculture_enabled(on) is True


def test_ensure_permanent_flags_mutates_adib():
    c = SimpleNamespace(company_code="FS-000002", name="Adib Filling Station", aquaculture_enabled=False, aquaculture_licensed=False)
    assert ensure_permanent_aquaculture_db_flags(c) is True
    assert c.aquaculture_enabled is True
    assert c.aquaculture_licensed is True
    assert ensure_permanent_aquaculture_db_flags(c) is False
