"""Look up prior fish sales to suggest stock-ledger book values."""
from __future__ import annotations

from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.utils import timezone

from api.models import AquacultureFishSale
from api.services.aquaculture_constants import fish_species_display_label, normalize_fish_species
from api.services.tenant_reporting_categories import income_type_is_non_biological_for_company


def _price_per_kg(weight_kg, total_amount) -> Decimal | None:
    w = Decimal(str(weight_kg))
    if w <= 0:
        return None
    t = Decimal(str(total_amount))
    if t < 0:
        return None
    return (t / w).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def last_fish_sale_reference_for_ledger(
    company_id: int,
    *,
    pond_id: int,
    production_cycle_id: int | None,
    fish_species: str,
    fish_species_other: str | None = None,
) -> dict | None:
    """
    Most recent biological fish harvest sale for pond + cycle + species.
    production_cycle_id None matches sales with no cycle tagged.
    """
    cid = company_id
    sp_code, _ = normalize_fish_species(fish_species)
    qs = AquacultureFishSale.objects.filter(company_id=cid, pond_id=pond_id, fish_species=sp_code)
    if production_cycle_id is not None:
        qs = qs.filter(production_cycle_id=production_cycle_id)
    else:
        qs = qs.filter(production_cycle_id__isnull=True)
    if sp_code == "other" and fish_species_other and str(fish_species_other).strip():
        qs = qs.filter(fish_species_other__iexact=str(fish_species_other).strip())

    sale = (
        qs.select_related("pond", "production_cycle", "invoice")
        .order_by("-sale_date", "-id")
        .first()
    )
    if not sale:
        return None
    if income_type_is_non_biological_for_company(cid, getattr(sale, "income_type", None) or ""):
        return None
    ppk = _price_per_kg(sale.weight_kg, sale.total_amount)
    if ppk is None:
        return None

    cname = ""
    if sale.production_cycle_id and getattr(sale, "production_cycle", None):
        cname = (sale.production_cycle.name or "").strip()
    spo = getattr(sale, "fish_species_other", None) or ""
    return {
        "sale_id": sale.id,
        "sale_date": sale.sale_date.isoformat(),
        "pond_id": sale.pond_id,
        "production_cycle_id": sale.production_cycle_id,
        "production_cycle_name": cname,
        "fish_species": sp_code,
        "fish_species_label": fish_species_display_label(sp_code, spo),
        "weight_kg": str(sale.weight_kg),
        "fish_count": sale.fish_count,
        "total_amount": str(sale.total_amount),
        "price_per_kg": str(ppk.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
        "buyer_name": (sale.buyer_name or "").strip(),
    }


def company_average_fish_sale_price_per_kg(
    company_id: int,
    *,
    days: int = 365,
    pond_id: int | None = None,
) -> dict | None:
    """
    Weighted average BDT/kg from biological fish sales in the lookback window.
    Used for approximate live-biomass market value when a pond has no recent sale.
    """
    cutoff = timezone.localdate() - timedelta(days=max(1, days))
    qs = AquacultureFishSale.objects.filter(company_id=company_id, sale_date__gte=cutoff)
    if pond_id is not None:
        qs = qs.filter(pond_id=pond_id)

    total_weight = Decimal("0")
    total_amount = Decimal("0")
    sale_count = 0
    for sale in qs.only("weight_kg", "total_amount", "income_type"):
        if income_type_is_non_biological_for_company(company_id, sale.income_type or ""):
            continue
        try:
            w = Decimal(str(sale.weight_kg or 0))
            t = Decimal(str(sale.total_amount or 0))
        except Exception:
            continue
        if w <= 0 or t < 0:
            continue
        total_weight += w
        total_amount += t
        sale_count += 1

    if sale_count == 0 or total_weight <= 0:
        return None

    avg = (total_amount / total_weight).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return {
        "price_per_kg": str(avg),
        "sale_count": sale_count,
        "total_weight_kg": str(total_weight.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)),
        "total_amount_bdt": str(total_amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
        "lookback_days": days,
        "pond_id": pond_id,
    }


def suggest_ledger_book_value_from_sale(*, price_per_kg: str | Decimal, weight_kg: str | Decimal | float) -> str | None:
    """Book value = |weight| × last sale price/kg (2 dp). Legacy — prefer cost-based for mortality."""
    try:
        p = Decimal(str(price_per_kg))
        w = abs(Decimal(str(weight_kg)))
    except Exception:
        return None
    if p <= 0 or w <= 0:
        return None
    amt = (w * p).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return str(amt)


def suggest_ledger_book_value_from_bio_cost(
    *,
    cost_per_kg: str | Decimal,
    weight_kg: str | Decimal | float,
    bio_asset_balance: str | Decimal | None = None,
) -> str | None:
    """Book value = |weight| × production cost/kg, capped at bio-asset balance (2 dp)."""
    from api.services.aquaculture_bio_asset_cost_service import suggest_bio_asset_relief_amount

    relief, _ = suggest_bio_asset_relief_amount(
        cost_per_kg=cost_per_kg,
        weight_kg=weight_kg,
        bio_asset_balance=bio_asset_balance,
    )
    if relief <= 0:
        return None
    return str(relief)
