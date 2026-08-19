"""Market rate per kg for inter-pond fish movements, priced off arm's-length sales only."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.models import AquaculturePond, Customer, Invoice
from api.models import AquacultureFishSale
from api.services.aquaculture_transfer_price import (
    quote_inter_pond_transfer,
    resolve_market_rate_per_kg,
)


def _pond(cid: int, name: str = "Grow-out G-01") -> AquaculturePond:
    return AquaculturePond.objects.create(company_id=cid, name=name, is_active=True)


def _sale(
    cid: int,
    pond: AquaculturePond,
    *,
    when: date,
    kg: str,
    amount: str,
    species: str = "tilapia",
    invoice: Invoice | None = None,
) -> AquacultureFishSale:
    return AquacultureFishSale.objects.create(
        company_id=cid,
        pond=pond,
        income_type="fish_harvest_sale",
        fish_species=species,
        sale_date=when,
        weight_kg=Decimal(kg),
        total_amount=Decimal(amount),
        invoice=invoice,
    )


@pytest.mark.django_db
def test_rate_is_weighted_by_kilo_not_a_plain_average(company_tenant):
    cid = company_tenant.id
    pond = _pond(cid)
    # 100 kg @ 200 and 900 kg @ 100 → weighted 110, plain average would be 150.
    _sale(cid, pond, when=date(2026, 1, 10), kg="100", amount="20000")
    _sale(cid, pond, when=date(2026, 1, 20), kg="900", amount="90000")

    rate, basis = resolve_market_rate_per_kg(
        cid, species="tilapia", as_of=date(2026, 2, 1)
    )
    assert rate == Decimal("110.0000")
    assert "2 external tilapia sale" in basis


@pytest.mark.django_db
def test_internal_sales_never_set_the_market_rate(company_tenant):
    """An inter-pond invoice must not become evidence for the next inter-pond price."""
    cid = company_tenant.id
    pond = _pond(cid)
    internal = Customer.objects.create(
        company_id=cid,
        display_name="Aquaculture — Pond 4",
        customer_number="C-INT-1",
        is_internal=True,
        internal_pond=pond,
    )
    internal_inv = Invoice.objects.create(
        company_id=cid,
        customer=internal,
        invoice_number="INV-INT-9",
        invoice_date=date(2026, 1, 15),
        due_date=date(2026, 1, 30),
        status="sent",
        total=Decimal("999000.00"),
    )
    # Wildly off-market internal sale, plus one real outside sale.
    _sale(cid, pond, when=date(2026, 1, 15), kg="1000", amount="999000", invoice=internal_inv)
    _sale(cid, pond, when=date(2026, 1, 16), kg="100", amount="15000")

    rate, basis = resolve_market_rate_per_kg(
        cid, species="tilapia", as_of=date(2026, 2, 1)
    )
    assert rate == Decimal("150.0000")
    assert "1 external tilapia sale" in basis


@pytest.mark.django_db
def test_falls_back_to_older_history_then_to_other_species(company_tenant):
    cid = company_tenant.id
    pond = _pond(cid)
    _sale(cid, pond, when=date(2025, 1, 5), kg="200", amount="24000")  # old tilapia @ 120

    rate, basis = resolve_market_rate_per_kg(
        cid, species="tilapia", as_of=date(2026, 6, 1)
    )
    assert rate == Decimal("120.0000")
    assert "all 1 external tilapia sale" in basis

    # A species with no history of its own borrows the recent all-species rate.
    _sale(cid, pond, when=date(2026, 5, 20), kg="100", amount="18000", species="tilapia")
    rate2, basis2 = resolve_market_rate_per_kg(
        cid, species="pangas", as_of=date(2026, 6, 1)
    )
    assert rate2 == Decimal("180.0000")
    assert "all species" in basis2


@pytest.mark.django_db
def test_no_history_refuses_to_invent_a_price(company_tenant):
    cid = company_tenant.id
    rate, basis = resolve_market_rate_per_kg(
        cid, species="tilapia", as_of=date(2026, 2, 1)
    )
    assert rate is None
    assert "manually" in basis


@pytest.mark.django_db
def test_quote_prices_a_movement_and_respects_a_manual_override(company_tenant):
    cid = company_tenant.id
    pond = _pond(cid, "Nursing P-01")
    _sale(cid, pond, when=date(2026, 1, 10), kg="100", amount="15000")  # 150/kg

    q = quote_inter_pond_transfer(
        cid,
        from_pond_id=pond.id,
        species="tilapia",
        as_of=date(2026, 2, 1),
        weight_kg=Decimal("40"),
    )
    assert q["priceable"] is True
    assert q["rate_source"] == "market"
    assert q["rate_per_kg"] == "150.0000"
    assert q["amount"] == "6000.00"
    assert q["from_pond_name"] == "Nursing P-01"

    forced = quote_inter_pond_transfer(
        cid,
        from_pond_id=pond.id,
        species="tilapia",
        as_of=date(2026, 2, 1),
        weight_kg=Decimal("40"),
        override_rate_per_kg=Decimal("200"),
    )
    assert forced["rate_source"] == "manual"
    assert forced["amount"] == "8000.00"
    assert "manually" in forced["basis_note"]


@pytest.mark.django_db
def test_unpriceable_movement_reports_zero_rather_than_guessing(company_tenant):
    cid = company_tenant.id
    pond = _pond(cid)
    q = quote_inter_pond_transfer(
        cid,
        from_pond_id=pond.id,
        species="tilapia",
        as_of=date(2026, 2, 1),
        weight_kg=Decimal("40"),
    )
    assert q["priceable"] is False
    assert q["rate_per_kg"] is None
    assert q["amount"] == "0.00"
