"""
Bio-asset cost per kg for harvest COGS relief and mortality book value.

Uses biological production costs (fry, feed, medicine, pond preparation, transfer-in)
accumulated for the pond/cycle window — the same basis as inter-pond transfers.
Relief on GL is capped at the posted 1581 balance for the pond.
"""
from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from api.models import AquacultureProductionCycle
from api.services.aquaculture_data_bank_service import pond_biological_settlement
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows
from api.services.aquaculture_transfer_cost import (
    _biological_production_cost_total,
    _transfer_denominator_kg,
    pl_window_for_transfer_date,
)


def _money_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _kg_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def lookup_bio_cost_per_kg(
    company_id: int,
    *,
    pond_id: int,
    as_of_date: date,
    production_cycle: AquacultureProductionCycle | None = None,
    line_weight_kg: Decimal | None = None,
) -> dict:
    """
    Production cost/kg for bio-asset relief (feed + fry + medicine + preparation + transfer-in).

    Returns dict with found, cost_per_kg, basis_note, biological_cost_total, denominator_kg,
    on_hand_weight_kg, bio_asset_balance, book_cost_per_kg, method.
    """
    start, end = pl_window_for_transfer_date(as_of_date, production_cycle)
    cycle_filter_id = production_cycle.id if production_cycle is not None else None

    payload = compute_aquaculture_pl_summary_dict(
        company_id,
        start,
        end,
        pond_id,
        cycle_filter_id,
        production_cycle,
        include_cycle_breakdown=False,
    )
    ponds = payload.get("ponds") or []
    cpk: dict = ponds[0].get("cost_per_kg") or {} if ponds else {}
    bio_total = _biological_production_cost_total(cpk.get("costing_lines") or [])

    settlement = pond_biological_settlement(company_id, pond_id, as_of_date)
    on_hand = _kg_q(Decimal(str(settlement.get("settlement_weight_kg") or "0")))
    bio_balance = _money_q(Decimal(str(settlement.get("settlement_bioasset_value") or "0")))

    book_cost_per_kg: str | None = None
    if on_hand > 0 and bio_balance > 0:
        book_cost_per_kg = str(_money_q(bio_balance / on_hand))

    if bio_total <= 0:
        if book_cost_per_kg:
            return {
                "found": True,
                "cost_per_kg": book_cost_per_kg,
                "basis_note": (
                    "No fry/feed/medicine costs in period — using bio-asset book balance ÷ on-hand kg."
                ),
                "biological_cost_total": "0",
                "denominator_kg": str(on_hand),
                "on_hand_weight_kg": str(on_hand),
                "bio_asset_balance": str(bio_balance),
                "book_cost_per_kg": book_cost_per_kg,
                "method": "book_balance",
            }
        return {
            "found": False,
            "cost_per_kg": None,
            "basis_note": "No biological production costs or bio-asset book balance for this pond/scope.",
            "biological_cost_total": "0",
            "denominator_kg": "0",
            "on_hand_weight_kg": str(on_hand),
            "bio_asset_balance": str(bio_balance),
            "book_cost_per_kg": None,
            "method": "none",
        }

    denom, denom_note = _transfer_denominator_kg(
        company_id=company_id,
        pond_id=pond_id,
        cycle_filter_id=cycle_filter_id,
        cpk=cpk,
        line_weight_kg=line_weight_kg,
        transfer_total_weight_kg=None,
    )
    if denom <= 0:
        if book_cost_per_kg:
            return {
                "found": True,
                "cost_per_kg": book_cost_per_kg,
                "basis_note": "No kg basis for production costs — using bio-asset book balance ÷ on-hand kg.",
                "biological_cost_total": str(_money_q(bio_total)),
                "denominator_kg": str(on_hand),
                "on_hand_weight_kg": str(on_hand),
                "bio_asset_balance": str(bio_balance),
                "book_cost_per_kg": book_cost_per_kg,
                "method": "book_balance",
            }
        return {
            "found": False,
            "cost_per_kg": None,
            "basis_note": "Production costs exist but no kg basis (sales, on-hand, or line weight).",
            "biological_cost_total": str(_money_q(bio_total)),
            "denominator_kg": "0",
            "on_hand_weight_kg": str(on_hand),
            "bio_asset_balance": str(bio_balance),
            "book_cost_per_kg": book_cost_per_kg,
            "method": "none",
        }

    per_kg = _money_q(bio_total / denom)
    note = (
        f"Bio cost/kg = production costs ({_money_q(bio_total)}) ÷ {denom} kg ({denom_note}). "
        "Includes fry, feed, medicine, pond preparation, and transfer-in. "
        "Lease, labor, and other overhead are excluded."
    )
    cost_per_fish: str | None = None
    pos_rows = compute_fish_stock_position_rows(
        company_id, pond_id=pond_id, production_cycle_id=cycle_filter_id
    )
    if pos_rows:
        live_count = int(pos_rows[0].get("implied_net_fish_count") or 0)
        if live_count > 0:
            cost_per_fish = str(_money_q(bio_total / Decimal(live_count)))
    return {
        "found": True,
        "cost_per_kg": str(per_kg),
        "cost_per_fish": cost_per_fish,
        "basis_note": note,
        "biological_cost_total": str(_money_q(bio_total)),
        "denominator_kg": str(denom),
        "on_hand_weight_kg": str(on_hand),
        "live_fish_count": int(pos_rows[0].get("implied_net_fish_count") or 0) if pos_rows else 0,
        "bio_asset_balance": str(bio_balance),
        "book_cost_per_kg": book_cost_per_kg,
        "method": "biological_production",
    }


def suggest_bio_asset_relief_amount(
    *,
    cost_per_kg: str | Decimal,
    weight_kg: str | Decimal | float,
    bio_asset_balance: str | Decimal | None = None,
) -> tuple[Decimal, str]:
    """
    Relief = |weight| × cost/kg, capped at 1581 pond balance when balance > 0.
    """
    try:
        p = Decimal(str(cost_per_kg))
        w = abs(Decimal(str(weight_kg)))
    except Exception:
        return Decimal("0"), ""
    if p <= 0 or w <= 0:
        return Decimal("0"), ""

    raw = _money_q(w * p)
    if bio_asset_balance is not None:
        bal = Decimal(str(bio_asset_balance))
        if bal > 0 and raw > bal:
            return bal, f"Capped at bio-asset book balance ({bal})."
    return raw, ""


def compute_sale_bio_relief(
    company_id: int,
    sale,
) -> tuple[Decimal, Decimal | None, str]:
    """
    Returns (relief_amount, cost_per_kg, basis_note) for an AquacultureFishSale.
    """
    from api.services.tenant_reporting_categories import income_type_is_non_biological_for_company

    if income_type_is_non_biological_for_company(company_id, getattr(sale, "income_type", None) or ""):
        return Decimal("0"), None, "Non-biological income type — no bio-asset relief."

    wk = Decimal(str(sale.weight_kg or 0))
    if wk <= 0:
        return Decimal("0"), None, "No harvest weight."

    cycle = getattr(sale, "production_cycle", None)
    ref = lookup_bio_cost_per_kg(
        company_id,
        pond_id=sale.pond_id,
        as_of_date=sale.sale_date,
        production_cycle=cycle,
        line_weight_kg=wk,
    )
    if not ref.get("found") or not ref.get("cost_per_kg"):
        return Decimal("0"), None, ref.get("basis_note") or "No cost/kg available."

    per_kg = Decimal(str(ref["cost_per_kg"]))
    relief, cap_note = suggest_bio_asset_relief_amount(
        cost_per_kg=per_kg,
        weight_kg=wk,
        bio_asset_balance=ref.get("bio_asset_balance"),
    )
    note = str(ref.get("basis_note") or "")
    if cap_note:
        note = f"{note} {cap_note}".strip()
    return relief, per_kg, note
