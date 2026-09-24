"""
Find/delete leftover AUTO-AQ-SALE-{id}-BIO journals that double-relieved IPT sales.

Inter-pond mirrors already Cr 1581 via AUTO-IPT-INV-*; a second BIO journal is wrong.
"""
from __future__ import annotations

import re

from django.db import transaction

from api.models import AquacultureFishSale, JournalEntry
from api.services.gl_posting import delete_aquaculture_fish_sale_bio_relief_journal

_BIO_RE = re.compile(r"^AUTO-AQ-SALE-(\d+)-BIO$")


def find_ipt_double_bio_relief_journals(company_id: int) -> dict:
    """List BIO journals whose sale is an IPT mirror (transfer line or IPT invoice)."""
    jes = list(
        JournalEntry.objects.filter(
            company_id=company_id,
            entry_number__startswith="AUTO-AQ-SALE-",
            entry_number__endswith="-BIO",
        )
        .only("id", "entry_number", "entry_date", "description")
        .order_by("id")
    )
    leftovers: list[dict] = []
    for je in jes:
        m = _BIO_RE.match(je.entry_number or "")
        if not m:
            continue
        sale_id = int(m.group(1))
        sale = (
            AquacultureFishSale.objects.filter(pk=sale_id, company_id=company_id)
            .select_related("invoice")
            .first()
        )
        if sale is None:
            leftovers.append(
                {
                    "journal_id": je.id,
                    "entry_number": je.entry_number,
                    "entry_date": je.entry_date.isoformat() if je.entry_date else None,
                    "sale_id": sale_id,
                    "reason": "orphan_bio_sale_missing",
                }
            )
            continue
        xfer = getattr(sale, "source_fish_pond_transfer_line_id", None)
        inv = getattr(sale, "invoice", None)
        ipt_inv = bool(inv is not None and getattr(inv, "internal_fish_transfer_line_id", None))
        if not xfer and not ipt_inv:
            continue
        leftovers.append(
            {
                "journal_id": je.id,
                "entry_number": je.entry_number,
                "entry_date": je.entry_date.isoformat() if je.entry_date else None,
                "sale_id": sale_id,
                "reason": "ipt_mirror_double_relief",
                "source_fish_pond_transfer_line_id": xfer,
                "ipt_on_invoice": ipt_inv,
            }
        )
    return {
        "company_id": company_id,
        "count": len(leftovers),
        "journals": leftovers,
    }


@transaction.atomic
def delete_ipt_double_bio_relief_journals(company_id: int) -> dict:
    preview = find_ipt_double_bio_relief_journals(company_id)
    deleted = 0
    for row in preview["journals"]:
        n = delete_aquaculture_fish_sale_bio_relief_journal(company_id, row["sale_id"])
        deleted += int(n or 0)
    return {
        "company_id": company_id,
        "found": preview["count"],
        "deleted": deleted,
        "journals": preview["journals"],
    }
