"""
Unified pond economics snapshot: live fish, biomass, density, production cost, and market value.
"""
from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from api.models import AquaculturePond, AquacultureProductionCycle
from api.services.aquaculture_constants import AQUACULTURE_POND_ROLE_CHOICES
from api.services.aquaculture_biological_asset_service import compute_pond_biological_asset_summary
from api.services.aquaculture_sale_reference_service import last_fish_sale_reference_for_ledger
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows
from api.services.aquaculture_transfer_cost import (
    _live_fingerling_heads_basis,
    _nursing_stocked_heads_basis,
    lookup_transfer_cost_per_head,
)


def _money_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _kg_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def _infer_fish_species(stock_row: dict, explicit: str | None) -> str:
    if explicit and str(explicit).strip():
        return str(explicit).strip()
    sample_sp = (stock_row.get("latest_sample_fish_species") or "").strip()
    if sample_sp:
        return sample_sp
    return "tilapia"


def _biomass_kg_for_market(stock_row: dict) -> Decimal:
    eff_raw = stock_row.get("effective_net_weight_kg")
    if eff_raw not in (None, ""):
        try:
            eff = Decimal(str(eff_raw))
            if eff > 0:
                return _kg_q(eff)
        except Exception:
            pass
    try:
        book = Decimal(str(stock_row.get("implied_net_weight_kg") or "0"))
        if book > 0:
            return _kg_q(book)
    except Exception:
        pass
    return Decimal("0")


def compute_pond_economics_snapshot(
    company_id: int,
    pond_id: int,
    *,
    as_of_date: date | None = None,
    production_cycle: AquacultureProductionCycle | None = None,
    fish_species: str | None = None,
    include_last_sale: bool = True,
) -> dict | None:
    """
    Single pond: live stock, biomass metrics, accumulated production cost, transfer cost/head, market value.
    """
    pond = AquaculturePond.objects.filter(pk=pond_id, company_id=company_id).first()
    if not pond:
        return None

    as_of = as_of_date or date.today()
    cycle_id = production_cycle.id if production_cycle is not None else None
    species = (fish_species or "").strip() or None

    stock_rows = compute_fish_stock_position_rows(
        company_id,
        pond_id=pond_id,
        production_cycle_id=cycle_id,
        fish_species_filter=species,
        include_inactive_ponds=True,
    )
    stock = stock_rows[0] if stock_rows else {}
    sp = _infer_fish_species(stock, species)

    bio = compute_pond_biological_asset_summary(
        company_id,
        pond_id=pond_id,
        as_of_date=as_of,
        production_cycle=production_cycle,
    )

    live_heads = int(stock.get("implied_net_fish_count") or bio.get("live_fish_count") or 0)
    if live_heads <= 0:
        live_heads = _live_fingerling_heads_basis(
            company_id=company_id,
            pond_id=pond_id,
            cycle_filter_id=cycle_id,
        )
    stocked_heads = _nursing_stocked_heads_basis(
        company_id=company_id,
        pond_id=pond_id,
        cycle_filter_id=cycle_id,
    )

    biomass_kg = _biomass_kg_for_market(stock)
    last_sale: dict | None = None
    price_per_kg: Decimal | None = None
    if include_last_sale:
        last_sale = last_fish_sale_reference_for_ledger(
            company_id,
            pond_id=pond_id,
            production_cycle_id=cycle_id,
            fish_species=sp,
        )
        if last_sale and last_sale.get("price_per_kg"):
            try:
                price_per_kg = Decimal(str(last_sale["price_per_kg"]))
            except Exception:
                price_per_kg = None

    implied_market_value: str | None = None
    if price_per_kg is not None and price_per_kg > 0 and biomass_kg > 0:
        implied_market_value = str(_money_q(biomass_kg * price_per_kg))

    transfer_cost_per_head: str | None = None
    transfer_cost_note: str | None = None
    role = (pond.pond_role or "").strip().lower()
    if role == "nursing" or (live_heads >= 10000 and live_heads > 0):
        per_head, note = lookup_transfer_cost_per_head(
            company_id=company_id,
            from_pond_id=pond_id,
            transfer_date=as_of,
            from_cycle=production_cycle,
        )
        if per_head is not None:
            transfer_cost_per_head = str(per_head)
        transfer_cost_note = note or None

    wa_dec = stock.get("water_area_decimal") or (
        str(pond.water_area_decimal) if getattr(pond, "water_area_decimal", None) else None
    )

    role_labels = dict(AQUACULTURE_POND_ROLE_CHOICES)

    return {
        "pond_id": pond.id,
        "pond_name": (pond.name or "").strip(),
        "pond_role": pond.pond_role or "",
        "pond_role_label": role_labels.get(pond.pond_role or "", pond.pond_role or ""),
        "as_of_date": as_of.isoformat(),
        "production_cycle_id": cycle_id,
        "fish_species": sp,
        "live_fish_count": live_heads,
        "stocked_fish_count": stocked_heads if stocked_heads > 0 else None,
        "book_weight_kg": stock.get("implied_net_weight_kg") or bio.get("live_weight_kg"),
        "biomass_kg": str(biomass_kg) if biomass_kg > 0 else stock.get("effective_net_weight_kg"),
        "current_fish_per_kg": stock.get("current_fish_per_kg"),
        "current_avg_weight_kg": stock.get("current_avg_weight_kg"),
        "current_fish_per_kg_source": stock.get("current_fish_per_kg_source"),
        "water_area_decimal": wa_dec,
        "stock_density_kg_per_decimal": stock.get("stock_density_kg_per_decimal"),
        "load_level": stock.get("load_level"),
        "load_level_label": stock.get("load_level_label"),
        "latest_sample_date": stock.get("latest_sample_date"),
        "total_biological_asset_value": bio.get("total_biological_asset_value"),
        "cost_per_fish": bio.get("cost_per_fish"),
        "cost_per_kg": bio.get("cost_per_kg"),
        "gl_1581_balance": bio.get("gl_1581_balance"),
        "gl_reconciliation_note": bio.get("gl_reconciliation_note"),
        "transfer_cost_per_head": transfer_cost_per_head,
        "transfer_cost_basis_note": transfer_cost_note,
        "last_sale": last_sale,
        "last_sale_price_per_kg": str(price_per_kg) if price_per_kg is not None else None,
        "implied_market_value": implied_market_value,
        "book_value_at_cost": bio.get("total_biological_asset_value"),
    }


def compute_pond_economics_portfolio(
    company_id: int,
    *,
    as_of_date: date | None = None,
) -> dict:
    """All active ponds — economics rows for dashboard (no per-pond last-sale lookup)."""
    from api.models import AquaculturePond

    role_labels = dict(AQUACULTURE_POND_ROLE_CHOICES)
    as_of = as_of_date or date.today()
    ponds = AquaculturePond.objects.filter(company_id=company_id, is_active=True).order_by(
        "sort_order", "id"
    )
    stock_by_pond = {
        int(r["pond_id"]): r
        for r in compute_fish_stock_position_rows(company_id, include_inactive_ponds=False)
    }

    rows: list[dict] = []
    grand_bio = Decimal("0")
    grand_live = 0
    grand_biomass = Decimal("0")

    for pond in ponds:
        stock = stock_by_pond.get(pond.id, {})
        bio = compute_pond_biological_asset_summary(
            company_id, pond_id=pond.id, as_of_date=as_of
        )
        biomass_kg = _biomass_kg_for_market(stock)
        live = int(stock.get("implied_net_fish_count") or bio.get("live_fish_count") or 0)
        bio_val = Decimal(str(bio.get("total_biological_asset_value") or "0"))
        grand_bio += bio_val
        grand_live += live
        grand_biomass += biomass_kg

        transfer_cost_per_head: str | None = None
        role = (pond.pond_role or "").strip().lower()
        if role == "nursing" or live >= 10000:
            per_head, _ = lookup_transfer_cost_per_head(
                company_id=company_id,
                from_pond_id=pond.id,
                transfer_date=as_of,
                from_cycle=None,
            )
            if per_head is not None:
                transfer_cost_per_head = str(per_head)

        rows.append(
            {
                "pond_id": pond.id,
                "pond_name": (pond.name or "").strip(),
                "pond_role": pond.pond_role or "",
                "pond_role_label": role_labels.get(pond.pond_role or "", pond.pond_role or ""),
                "live_fish_count": live,
                "biomass_kg": str(biomass_kg) if biomass_kg > 0 else None,
                "current_fish_per_kg": stock.get("current_fish_per_kg"),
                "current_avg_weight_kg": stock.get("current_avg_weight_kg"),
                "stock_density_kg_per_decimal": stock.get("stock_density_kg_per_decimal"),
                "load_level_label": stock.get("load_level_label"),
                "total_biological_asset_value": bio.get("total_biological_asset_value"),
                "cost_per_fish": bio.get("cost_per_fish"),
                "cost_per_kg": bio.get("cost_per_kg"),
                "transfer_cost_per_head": transfer_cost_per_head,
            }
        )

    return {
        "as_of_date": as_of.isoformat(),
        "pond_count": len(rows),
        "total_biological_asset_value": str(_money_q(grand_bio)),
        "total_live_fish_count": grand_live,
        "total_biomass_kg": str(_kg_q(grand_biomass)) if grand_biomass > 0 else "0",
        "ponds": rows,
    }
