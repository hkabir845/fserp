"""
Fish is not transferred between ponds any more — it is sold.

A pond that parts with fish raises a sale and the receiving pond records the matching purchase
bill, so both sides show the trade and the selling pond earns its margin (see
``aquaculture_internal_trade_posting``). The pond-to-pond **transfer** document survives only for
feed, medicine, equipment and other supplies, which move through
``aquaculture_pond_stock_service.transfer_pond_warehouse_between_ponds``.

``FISH_POND_TRANSFERS_ENABLED`` is off, and there is no setting to turn it back on: retiring the
document is a company-wide accounting decision, not a per-tenant preference. It exists as a
module constant rather than an inlined ``return`` so the transfer machinery — stock ledger,
biomass sampling, line costing, the GL seam — stays reachable and under test for the historical
records that still run through it, including
``manage.py convert_fish_transfers_to_documents``.

Reading, deleting and converting an existing transfer are all still allowed; only creating or
editing one is closed off.
"""
from __future__ import annotations

FISH_POND_TRANSFERS_ENABLED = False

FISH_TRANSFER_RETIRED_DETAIL = (
    "Fish is no longer moved by transfer. A pond that sells fish — to another pond or to an "
    "outside customer — raises a sale, and the buying pond records the matching purchase bill, "
    "so both sides show the trade and the selling pond earns its margin. Pond-to-pond transfers "
    "remain for feed, medicine, equipment and other supplies."
)


def fish_pond_transfers_allowed() -> bool:
    """False in normal operation; tests flip the constant to exercise historical machinery."""
    return bool(FISH_POND_TRANSFERS_ENABLED)
