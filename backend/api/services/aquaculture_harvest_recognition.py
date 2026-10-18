"""When a fish sale has left the pond.

Standing stock, FCR harvest kilograms, and cost-per-kg harvest kilograms share
this rule. A sale is recognized when it is booked on a non-draft, non-void
sales invoice. A row with no invoice is a draft: the outbound guard may reserve those fish, but
they are still standing stock and are not harvested production. A sale that
mirrors an inter-pond transfer is not a harvest; the transfer line already
moved the fish. The memo prefix still applies after the transfer link is cleared.
"""
from __future__ import annotations

INTER_POND_MIRROR_SALE_MEMO_PREFIX = "Inter-pond sale (from transfer"


def recognized_pond_sales(qs):
    """Sales that reduce standing stock and count as harvested production."""
    return qs.filter(
        source_fish_pond_transfer_line_id__isnull=True,
        invoice_id__isnull=False,
    ).exclude(
        invoice__status__in=("draft", "void"),
    ).exclude(memo__startswith=INTER_POND_MIRROR_SALE_MEMO_PREFIX)
