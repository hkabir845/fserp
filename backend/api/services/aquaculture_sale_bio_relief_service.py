"""Sync bio-asset GL relief when aquaculture fish sales are finalized or edited."""
from __future__ import annotations

from api.services.aquaculture_bio_asset_cost_service import compute_sale_bio_relief
from api.services.gl_posting import (
    delete_aquaculture_fish_sale_bio_relief_journal,
    post_aquaculture_fish_sale_bio_relief_journal,
)


def sync_aquaculture_fish_sale_bio_relief(company_id: int, sale) -> dict:
    """
    (Re)post AUTO-AQ-SALE-{id}-BIO after finalize or sale edit.
    Returns {posted, relief_amount, cost_per_kg, basis_note}.
    """
    delete_aquaculture_fish_sale_bio_relief_journal(company_id, sale.id)

    relief, per_kg, note = compute_sale_bio_relief(company_id, sale)
    if relief <= 0 or per_kg is None:
        return {
            "posted": False,
            "relief_amount": "0",
            "cost_per_kg": str(per_kg) if per_kg is not None else None,
            "basis_note": note,
        }

    pond_label = (sale.pond.name or "").strip() if getattr(sale, "pond_id", None) else f"Pond #{sale.pond_id}"
    entry = post_aquaculture_fish_sale_bio_relief_journal(
        company_id,
        sale.id,
        sale.sale_date,
        relief_amount=relief,
        pond_id=sale.pond_id,
        production_cycle_id=sale.production_cycle_id,
        pond_label=pond_label,
        weight_kg=sale.weight_kg,
        cost_per_kg=per_kg,
        memo=note,
    )
    return {
        "posted": entry is not None,
        "relief_amount": str(relief),
        "cost_per_kg": str(per_kg),
        "basis_note": note,
    }
