"""Pond load bands and partial-harvest advice against standard stocking rules.

Load is judged on two metrics — kg per decimal and standing fish per decimal — and the overall
band is the worse of the two. These pin the cases where the two disagree, which is where the
advice used to send the manager to the wrong lever.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from api.services.aquaculture_partial_harvest import (
    compute_biomass_load_advice_dict,
    compute_partial_harvest_suggestion,
)
from api.services.aquaculture_units import compute_stocking_load_advice


def _nursing_crowded_by_count() -> dict:
    """10 decimals, 45,000 fry at ~2 g: 4,500 pcs/dec (over the 3,500 band) but 9 kg/dec."""
    return compute_biomass_load_advice_dict(
        biomass_kg=Decimal("90"),
        fish_count=45000,
        water_area_decimal=Decimal("10"),
        pond_role="nursing",
    )


def test_count_driven_load_is_not_reported_as_a_biomass_problem():
    r = _nursing_crowded_by_count()
    assert r["load_level_kg"] == "moderate", "9 kg/dec is below the nursing comfort band of 18"
    assert r["load_level_pcs"] == "high_risk"
    assert r["load_level"] == "high_risk", "overall band is the worse of the two"
    assert r["load_driver"] == "count"

    alert = r["biomass_alert"]
    assert alert["severity"] == "red"
    reason = alert["reason"]
    assert "4500.00 pcs/decimal" in reason
    assert "by numbers, not weight" in reason
    assert "9.00 kg/decimal, above" not in reason, (
        "the alert must not claim a below-comfort biomass is above the comfort band"
    )
    assert alert["suggested_reduction_kg"] is None, (
        "there is no weight to remove — a kg figure here would be invented"
    )


def test_count_driven_load_does_not_read_as_no_thinning_needed():
    """``monitor`` renders as 'No thinning needed' on the sampling screen — a red pond must not."""
    r = _nursing_crowded_by_count()
    assert r["owner_decision_recommended"] is True
    assert r["owner_action"] == "thin_by_count"
    assert r["owner_action"] not in ("monitor", "grow")
    assert "split the pond" in r["owner_decision_summary"].lower()


def test_comfort_target_survives_a_count_driven_breach():
    """The less severe 'no thinning needed' path reports the target; the worse one must too."""
    r = compute_partial_harvest_suggestion(
        Decimal("90"),
        45000,
        water_area_decimal=Decimal("10"),
        pond_role="nursing",
        load_level="high_risk",
    )
    assert r["partial_harvest_applicable"] is False
    assert r["partial_harvest_target_kg_per_decimal"] == "18"


def test_suggested_harvest_never_exceeds_the_fish_in_the_pond():
    """
    pcs/kg comes from the latest size sample, biomass and head count from the stock position, so
    the two can disagree. A stale fingerling-size sample against a grown-out pond produced
    "remove 20,000 fish" from a pond holding 12,000.
    """
    r = compute_partial_harvest_suggestion(
        Decimal("6000"),
        12000,
        water_area_decimal=Decimal("100"),
        pond_role="grow_out",
        current_fish_per_kg=Decimal("10"),  # stale: the pond is really ~2 pcs/kg
        load_level="high_risk",
    )
    assert r["partial_harvest_applicable"] is True
    assert int(r["partial_harvest_suggested_fish_count"]) <= 12000


def test_genuine_biomass_overload_still_advises_a_partial_harvest():
    """Guard against the count-driven fix swallowing the case it must not touch."""
    r = compute_biomass_load_advice_dict(
        biomass_kg=Decimal("6000"),
        fish_count=12000,
        water_area_decimal=Decimal("100"),
        pond_role="grow_out",
    )
    assert r["load_driver"] == "biomass"
    assert r["owner_action"] == "partial_harvest"
    # 60 kg/dec down to the 40 kg/dec comfort band over 100 decimals.
    assert Decimal(r["partial_harvest_suggested_kg"]) == Decimal("2000.00")
    assert r["partial_harvest_post_load_kg_per_decimal"] == "40.000"
    assert r["biomass_alert"]["severity"] == "red"
    assert "kg/decimal, above the pond's safe comfort band" in r["biomass_alert"]["reason"]


def test_load_bands_match_the_documented_hectare_rates():
    """Grow-out comfort of 40 kg/dec is ~9.9 t/ha, inside the documented 8–12 t/ha range."""
    r = compute_stocking_load_advice(
        Decimal("4000"),
        water_area_decimal=Decimal("100"),
        water_volume_cu_ft=None,
        pond_role="grow_out",
        fish_count=20000,
    )
    assert r["load_band_kg_comfort"] == "40"
    # 1 hectare = 247.105 Bangladesh decimals.
    t_per_ha = Decimal("40") * Decimal("247.105") / Decimal("1000")
    assert Decimal("8") <= t_per_ha <= Decimal("12")


def test_area_unit_mistake_is_flagged_rather_than_advised_on():
    """Water area entered in acres instead of decimals makes kg/dec ~100x too high."""
    r = compute_stocking_load_advice(
        Decimal("6000"),
        water_area_decimal=Decimal("1"),  # 1 acre typed where 100 decimals belong
        water_volume_cu_ft=None,
        pond_role="grow_out",
        fish_count=12000,
    )
    assert r["load_area_unit_warning"] is not None
    assert "1 acre = 100 Bangladesh decimals" in r["load_area_unit_warning"]


@pytest.mark.django_db
def test_load_density_uses_sampled_biomass_not_book_weight(company_tenant):
    """
    Characterisation guard, not a bug fix: ``enrich_position_row_with_fish_metrics`` recomputes
    the whole load block from sampled biomass, overwriting the book-derived values the row is
    first built with. Book net weight is wrong both ways — fry transfers understate growth, a bad
    transfer kg overstates mass — so if that overwrite is ever dropped the load band silently
    starts reading the untrustworthy number. This pins it.

    Here 100,000 fry are billed in at 33.33 kg and 80,000 are transferred out at 4,000 kg, which
    drives book weight negative while 20,000 fingerlings at 50 g really sit in 100 decimals.
    """
    from api.models import (
        AquacultureBiomassSample,
        AquacultureFishPondTransfer,
        AquacultureFishPondTransferLine,
        AquaculturePond,
        Bill,
        BillLine,
        Item,
        Vendor,
    )
    from api.services.aquaculture_stock_service import compute_fish_stock_position_rows

    src = AquaculturePond.objects.create(
        company_id=company_tenant.id,
        name="Load Nursing",
        pond_role="nursing",
        water_area_decimal=Decimal("100"),
        is_active=True,
    )
    dst = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Load Grow", pond_role="grow_out", is_active=True
    )
    vendor = Vendor.objects.create(company_id=company_tenant.id, company_name="Load Fry V")
    fish_item = Item.objects.create(
        company_id=company_tenant.id,
        name="Load Tilapia Fry",
        pos_category="fish",
        unit="kg",
        unit_price=Decimal("100"),
        cost=Decimal("80"),
    )
    bill = Bill.objects.create(
        company_id=company_tenant.id,
        vendor=vendor,
        bill_number="B-LOAD-1",
        bill_date=date(2026, 4, 1),
        status="posted",
        stock_receipt_applied=True,
        total=Decimal("5000"),
    )
    BillLine.objects.create(
        bill=bill,
        item=fish_item,
        quantity=Decimal("1"),
        amount=Decimal("5000"),
        aquaculture_pond=src,
        aquaculture_fish_count=100000,
        aquaculture_fish_weight_kg=Decimal("33.3333"),
        aquaculture_fish_species="tilapia",
    )
    tr = AquacultureFishPondTransfer.objects.create(
        company_id=company_tenant.id,
        from_pond=src,
        transfer_date=date(2026, 6, 1),
        fish_species="tilapia",
    )
    AquacultureFishPondTransferLine.objects.create(
        transfer=tr, to_pond=dst, fish_count=80000, weight_kg=Decimal("4000")
    )
    AquacultureBiomassSample.objects.create(
        company_id=company_tenant.id,
        pond=src,
        fish_species="tilapia",
        sample_date=date(2026, 6, 15),
        estimated_fish_count=100,
        estimated_total_weight_kg=Decimal("5"),
        avg_weight_kg=Decimal("0.05"),
        stock_reference_fish_count=20000,
        extrapolated_biomass_kg=Decimal("1000"),
    )

    row = compute_fish_stock_position_rows(company_tenant.id, pond_id=src.id)[0]
    assert Decimal(str(row["implied_net_weight_kg"])) < 0, "book weight is the untrustworthy input"
    assert int(row["implied_net_fish_count"]) == 20000

    # 20,000 fish × 50 g = 1,000 kg over 100 decimals = 10 kg/decimal.
    assert Decimal(row["stock_density_kg_per_decimal"]) == Decimal("10.00")
    assert row["load_level_kg"] == "moderate", "nursing comfort is 18 kg/dec; 10 is moderate"


def test_area_unit_audit_threshold_matches_the_in_app_warning():
    """
    The audit command and the in-app load warning must flag the same ponds.

    Broodstock was absent from the command's role list, so it needed twice the density before the
    audit flagged it — while the UI was already warning at the single threshold. Broodstock bands
    are the tightest of the three, so the doubled bar was backwards.
    """
    import inspect

    from api.management.commands import audit_aquaculture_pond_load as cmd
    from api.services import aquaculture_units as units

    src = inspect.getsource(cmd.Command.handle)
    for role in ("grow_out", "other", "broodstock"):
        assert f'"{role}"' in src, f"{role} must be flagged at the base threshold"

    # 9,000 kg over 100 decimals = 90 kg/dec, above the 80 kg/dec warn line.
    advice = units.compute_stocking_load_advice(
        Decimal("9000"),
        water_area_decimal=Decimal("100"),
        water_volume_cu_ft=None,
        pond_role="broodstock",
        fish_count=1000,
    )
    assert advice["load_area_unit_warning"] is not None, (
        "the app warns broodstock at this density, so the audit command must flag it too"
    )


def test_capitalized_categories_follow_the_posting_policy_not_a_hand_list():
    """
    A capitalized pond input is an asset in 1581 until the fish are sold, so it is not a period
    expense — it reaches the P&L as harvest COGS (5240). The company P&L decides which register
    categories to hold back using the same bucket policy the posting path uses, so the ledger and
    the statement cannot drift apart.
    """
    from api.services.aquaculture_pond_bio_capitalization import (
        _NO_BIO_CAPITALIZE_BUCKETS,
        capitalized_register_expense_categories,
        pond_cost_bucket_capitalizes_to_bio,
    )

    cats = capitalized_register_expense_categories()

    # Direct production inputs are capitalized: they are the cost of the fish.
    for cat in ("feed_purchase", "fry_stocking", "medicine_purchase", "pond_preparation"):
        assert cat in cats, f"{cat} is a direct pond input and belongs in biological inventory"

    # Costs the policy deliberately keeps on operating expense stay period costs.
    for cat in ("fisherman", "lease", "shop_supplies", "mortality"):
        assert cat not in cats, f"{cat} is a period cost, not part of the cost of the fish"

    # The exclusions really are the posting policy's, not a second opinion.
    assert not pond_cost_bucket_capitalizes_to_bio("fisherman")
    assert {"lease", "shop_supplies", "biological_writeoff", "fisherman"} == set(
        _NO_BIO_CAPITALIZE_BUCKETS
    )


@pytest.mark.django_db
def test_bill_lines_come_back_in_the_order_they_were_entered(
    api_client, company_tenant, auth_admin_headers
):
    """
    BillLine has no Meta.ordering, so an unordered queryset returns rows in Postgres physical
    order. Updating a line — truck transport rewriting ``amount``, production-cycle assignment
    writing a cycle id — rewrites the row and moves it, so a saved bill came back with its lines
    shuffled. Any caller indexing ``lines[0]`` then reads a different line than the user typed.
    """
    import json

    from api.models import AquaculturePond, Company, Station

    Company.objects.filter(pk=company_tenant.id).update(
        aquaculture_enabled=True, aquaculture_licensed=True
    )
    Station.objects.create(company_id=company_tenant.id, station_name="Recv Ord", is_active=True)
    nursing = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Ord Nursing", pond_role="nursing", is_active=True
    )
    grow = AquaculturePond.objects.create(
        company_id=company_tenant.id, name="Ord Grow", pond_role="grow_out", is_active=True
    )
    h = auth_admin_headers
    v = api_client.post(
        "/api/vendors/",
        data=json.dumps({"company_name": "Ord Hatchery"}),
        content_type="application/json",
        **h,
    )
    assert v.status_code == 201, v.content.decode()
    vendor_id = json.loads(v.content)["id"]

    r = api_client.post(
        "/api/bills/",
        data=json.dumps(
            {
                "vendor_id": vendor_id,
                "bill_date": "2026-05-10",
                "subtotal": "50100.00",
                "tax_total": "0",
                "total": "50100.00",
                "status": "draft",
                "lines": [
                    {
                        "description": "Tilapia fry",
                        "quantity": "1",
                        "unit_cost": "30000.00",
                        "amount": "30000.00",
                        "aquaculture_pond_id": nursing.id,
                        "aquaculture_cost_bucket": "fry_stocking",
                    },
                    {
                        "description": "Transport",
                        "quantity": "1",
                        "unit_cost": "20000.00",
                        "amount": "20000.00",
                        "aquaculture_pond_id": nursing.id,
                    },
                    {
                        "description": "Lime (other pond)",
                        "quantity": "1",
                        "unit_cost": "100.00",
                        "amount": "100.00",
                        "aquaculture_pond_id": grow.id,
                    },
                ],
            }
        ),
        content_type="application/json",
        **h,
    )
    assert r.status_code == 201, r.content.decode()
    created = [ln["description"] for ln in json.loads(r.content)["lines"]]
    assert created == ["Tilapia fry", "Transport", "Lime (other pond)"]

    # And again on read-back, not just in the create response.
    bill_id = json.loads(r.content)["id"]
    got = api_client.get(f"/api/bills/{bill_id}/", **h)
    assert got.status_code == 200, got.content.decode()
    assert [ln["description"] for ln in json.loads(got.content)["lines"]] == created
