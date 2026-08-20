"""Auto sampling rows when fish change hands: vendor purchases and pond-to-pond transfers."""
from __future__ import annotations

import json
from decimal import Decimal

import pytest

from api.models import (
    AquacultureBiomassSample,
    AquacultureFishStockLedger,
    AquaculturePond,
    Company,
    Item,
)


def _seed_pond_fish(company_id: int, pond, *, heads: int, kg: str, entry_date: str) -> None:
    """Give the source pond stock so an outbound transfer passes the stock guard."""
    AquacultureFishStockLedger.objects.create(
        company_id=company_id,
        pond=pond,
        entry_date=entry_date,
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=heads,
        weight_kg_delta=Decimal(kg),
        memo="Opening fingerlings for sampling test",
    )


def _enable(c: Company) -> None:
    Company.objects.filter(pk=c.id).update(aquaculture_enabled=True, aquaculture_licensed=True)


def _headers(base: dict, company_id: int) -> dict:
    return {**base, "HTTP_X_COMPANY_ID": str(company_id)}


def _fry_item(company_id: int, name: str = "Tilapia Fry") -> Item:
    return Item.objects.create(
        company_id=company_id,
        name=name,
        item_type="inventory",
        pos_category="fish",
        unit="kg",
        category="Aquaculture",
        pieces_per_kg=Decimal("400"),
    )


def _vendor(api_client, headers, name: str) -> int:
    r = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": name}),
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 201, r.content.decode()
    return json.loads(r.content)["id"]


def _fry_bill_body(vendor_id: int, item_id: int, pond_id: int, status: str) -> dict:
    return {
        "vendor_id": vendor_id,
        "bill_date": "2026-05-16",
        "subtotal": "5000.00",
        "tax_total": "0",
        "total": "5000.00",
        "status": status,
        "lines": [
            {
                "description": "Tilapia Fry",
                "item_id": item_id,
                "quantity": "12.5",
                "unit_cost": "400.00",
                "amount": "5000.00",
                "aquaculture_pond_id": pond_id,
                "aquaculture_fish_species": "tilapia",
                "aquaculture_fish_weight_kg": "12.5",
                "aquaculture_fish_count": 5000,
            }
        ],
    }


@pytest.mark.django_db
def test_posted_fry_purchase_creates_sampling_row_for_the_buying_pond(
    api_client, company_tenant, auth_admin_headers
):
    _enable(company_tenant)
    cid = company_tenant.id
    h = _headers(auth_admin_headers, cid)
    pond = AquaculturePond.objects.create(
        company_id=cid, name="Nursing Buy", pond_role="nursing", is_active=True
    )
    fry = _fry_item(cid)
    vendor_id = _vendor(api_client, h, "Hatchery Sampling Test")

    r = api_client.post(
        "/api/bills/",
        data=json.dumps(_fry_bill_body(vendor_id, fry.id, pond.id, "open")),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()

    sample = AquacultureBiomassSample.objects.filter(company_id=cid, pond_id=pond.id).first()
    assert sample is not None
    assert sample.source_bill_line_id is not None
    assert sample.sample_date.isoformat() == "2026-05-16"
    assert sample.sample_time is not None
    assert sample.estimated_fish_count == 5000
    assert sample.estimated_total_weight_kg == Decimal("12.5000")
    # 12.5 kg over 5000 heads = 0.0025 kg each = 400 pcs/kg
    assert sample.avg_weight_kg == Decimal("0.002500")
    assert "400" in sample.notes and "pcs/kg" in sample.notes
    assert sample.fish_species == "tilapia"


@pytest.mark.django_db
def test_draft_fry_purchase_makes_no_sampling_row_until_it_posts(
    api_client, company_tenant, auth_admin_headers
):
    _enable(company_tenant)
    cid = company_tenant.id
    h = _headers(auth_admin_headers, cid)
    pond = AquaculturePond.objects.create(
        company_id=cid, name="Nursing Draft", pond_role="nursing", is_active=True
    )
    fry = _fry_item(cid)
    vendor_id = _vendor(api_client, h, "Hatchery Draft Test")

    created = api_client.post(
        "/api/bills/",
        data=json.dumps(_fry_bill_body(vendor_id, fry.id, pond.id, "draft")),
        content_type="application/json",
        **h,
    )
    assert created.status_code == 201, created.content.decode()
    bill_id = json.loads(created.content)["id"]
    assert not AquacultureBiomassSample.objects.filter(company_id=cid, pond_id=pond.id).exists()

    body = _fry_bill_body(vendor_id, fry.id, pond.id, "open")
    upd = api_client.put(
        f"/api/bills/{bill_id}/",
        data=json.dumps(body),
        content_type="application/json",
        **h,
    )
    assert upd.status_code == 200, upd.content.decode()

    samples = AquacultureBiomassSample.objects.filter(company_id=cid, pond_id=pond.id)
    assert samples.count() == 1
    assert samples.first().estimated_fish_count == 5000


@pytest.mark.django_db
def test_pond_transfer_samples_both_the_selling_and_the_buying_pond(
    api_client, company_tenant, auth_admin_headers
):
    _enable(company_tenant)
    cid = company_tenant.id
    h = _headers(auth_admin_headers, cid)
    nursing = AquaculturePond.objects.create(
        company_id=cid, name="Nursing Sell", pond_role="nursing", is_active=True
    )
    grow_a = AquaculturePond.objects.create(
        company_id=cid, name="Grow A", pond_role="grow_out", is_active=True
    )
    grow_b = AquaculturePond.objects.create(
        company_id=cid, name="Grow B", pond_role="grow_out", is_active=True
    )
    _seed_pond_fish(cid, nursing, heads=20000, kg="400", entry_date="2026-05-01")

    r = api_client.post(
        "/api/aquaculture/fish-pond-transfers/",
        data=json.dumps(
            {
                "from_pond_id": nursing.id,
                "transfer_date": "2026-05-17",
                "fish_species": "tilapia",
                "lines": [
                    {"to_pond_id": grow_a.id, "weight_kg": "120", "fish_count": 6000},
                    {"to_pond_id": grow_b.id, "weight_kg": "80", "fish_count": 4000},
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    transfer_id = json.loads(r.content)["transfer"]["id"]

    sell = AquacultureBiomassSample.objects.filter(source_fish_pond_transfer_id=transfer_id).first()
    assert sell is not None
    assert sell.pond_id == nursing.id
    assert sell.estimated_fish_count == 10000
    assert sell.estimated_total_weight_kg == Decimal("200.0000")
    assert sell.avg_weight_kg == Decimal("0.020000")  # 200 kg / 10000 heads
    assert sell.sample_date.isoformat() == "2026-05-17"
    assert sell.sample_time is not None

    buys = list(
        AquacultureBiomassSample.objects.filter(
            source_fish_pond_transfer_line__isnull=False
        ).order_by("pond_id")
    )
    assert len(buys) == 2
    by_pond = {s.pond_id: s for s in buys}
    assert by_pond[grow_a.id].estimated_fish_count == 6000
    assert by_pond[grow_a.id].estimated_total_weight_kg == Decimal("120.0000")
    assert by_pond[grow_b.id].estimated_fish_count == 4000
    assert by_pond[grow_b.id].estimated_total_weight_kg == Decimal("80.0000")

    # Re-saving the transfer updates its rows instead of piling up duplicates.
    upd = api_client.put(
        f"/api/aquaculture/fish-pond-transfers/{transfer_id}/",
        data=json.dumps(
            {
                "from_pond_id": nursing.id,
                "transfer_date": "2026-05-17",
                "fish_species": "tilapia",
                "lines": [
                    {"to_pond_id": grow_a.id, "weight_kg": "150", "fish_count": 6000},
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert upd.status_code == 200, upd.content.decode()

    assert AquacultureBiomassSample.objects.filter(
        source_fish_pond_transfer_line__isnull=False
    ).count() == 1
    sell.refresh_from_db()
    assert sell.estimated_fish_count == 6000
    assert sell.estimated_total_weight_kg == Decimal("150.0000")
    assert not AquacultureBiomassSample.objects.filter(pond_id=grow_b.id).exists()

    # Deleting the transfer takes its sampling rows with it.
    dele = api_client.delete(f"/api/aquaculture/fish-pond-transfers/{transfer_id}/", **h)
    assert dele.status_code == 200, dele.content.decode()
    assert not AquacultureBiomassSample.objects.filter(company_id=cid).exists()


@pytest.mark.django_db
def test_transfer_line_without_head_count_derives_it_from_pcs_per_kg(
    company_tenant,
):
    """The API requires fish_count, but older rows may only carry pcs/kg — derive head from it."""
    from api.models import AquacultureFishPondTransfer, AquacultureFishPondTransferLine
    from api.services.aquaculture_auto_biomass_sample import (
        sync_biomass_samples_from_fish_pond_transfer,
    )

    _enable(company_tenant)
    cid = company_tenant.id
    nursing = AquaculturePond.objects.create(
        company_id=cid, name="Nursing Derive", pond_role="nursing", is_active=True
    )
    grow = AquaculturePond.objects.create(
        company_id=cid, name="Grow Derive", pond_role="grow_out", is_active=True
    )
    xfer = AquacultureFishPondTransfer.objects.create(
        company_id=cid,
        from_pond=nursing,
        transfer_date="2026-05-18",
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=xfer,
        to_pond=grow,
        weight_kg=Decimal("50"),
        fish_count=None,
        pcs_per_kg=Decimal("40"),
    )

    sync_biomass_samples_from_fish_pond_transfer(cid, xfer)

    buy = AquacultureBiomassSample.objects.filter(pond_id=grow.id).first()
    assert buy is not None
    assert buy.estimated_fish_count == 2000  # 50 kg x 40 pcs/kg
    assert buy.avg_weight_kg == Decimal("0.025000")


@pytest.mark.django_db
def test_sell_side_sample_is_not_treated_as_stock_left_in_the_pond(
    api_client, company_tenant, auth_admin_headers
):
    """A transfer-out row must not stand in for remaining fish (it measures fish that left)."""
    from api.services.aquaculture_biomass_sample_reference_service import (
        last_biomass_sample_reference_for_ledger,
    )

    _enable(company_tenant)
    cid = company_tenant.id
    h = _headers(auth_admin_headers, cid)
    nursing = AquaculturePond.objects.create(
        company_id=cid, name="Nursing Ref", pond_role="nursing", is_active=True
    )
    grow = AquaculturePond.objects.create(
        company_id=cid, name="Grow Ref", pond_role="grow_out", is_active=True
    )
    _seed_pond_fish(cid, nursing, heads=10000, kg="200", entry_date="2026-05-01")

    r = api_client.post(
        "/api/aquaculture/fish-pond-transfers/",
        data=json.dumps(
            {
                "from_pond_id": nursing.id,
                "transfer_date": "2026-05-19",
                "fish_species": "tilapia",
                "lines": [{"to_pond_id": grow.id, "weight_kg": "200", "fish_count": 10000}],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    assert AquacultureBiomassSample.objects.filter(pond_id=nursing.id).exists()

    ref = last_biomass_sample_reference_for_ledger(
        cid, pond_id=nursing.id, production_cycle_id=None, fish_species="tilapia"
    )
    assert ref is None, "transfer-out sampling must not be used as the pond's stock reference"


@pytest.mark.django_db
def test_manual_sample_accepts_a_clock_time(api_client, company_tenant, auth_admin_headers):
    _enable(company_tenant)
    cid = company_tenant.id
    h = _headers(auth_admin_headers, cid)
    pond = AquaculturePond.objects.create(
        company_id=cid, name="Manual Time", pond_role="grow_out", is_active=True
    )

    r = api_client.post(
        "/api/aquaculture/samples/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "sample_date": "2026-05-20",
                "sample_time": "06:45",
                "fish_species": "tilapia",
                "estimated_fish_count": 120,
                "estimated_total_weight_kg": "36",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    assert json.loads(r.content)["sample_time"] == "06:45"

    bad = api_client.post(
        "/api/aquaculture/samples/",
        data=json.dumps(
            {
                "pond_id": pond.id,
                "sample_date": "2026-05-20",
                "sample_time": "quarter to seven",
                "fish_species": "tilapia",
                "estimated_fish_count": 120,
                "estimated_total_weight_kg": "36",
            }
        ),
        content_type="application/json",
        **h,
    )
    assert bad.status_code == 400
    assert "sample_time" in bad.content.decode()
