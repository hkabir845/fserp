"""
Mirror historical fish-pond transfer lines as AquacultureFishSale rows.

Transfer rows stay in place for stock / biomass history. Each priced line also gets a seller
sale so Sales UI, pond P&L revenue, and reports treat the move as a sale. Stock position still
reads the transfer (not the mirrored sale) so heads/kg are not double-counted.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction

from api.models import AquacultureFishPondTransfer, AquacultureFishPondTransferLine, AquacultureFishSale, Invoice


def _money_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _d(value) -> Decimal:
    if value is None:
        return Decimal("0")
    try:
        return Decimal(str(value))
    except (TypeError, ValueError):
        return Decimal("0")


def sale_amount_for_transfer_line(line: AquacultureFishPondTransferLine) -> Decimal:
    """Prefer internal sale price; fall back to book cost moved with the line."""
    sale = _money_q(_d(getattr(line, "sale_amount", None)))
    if sale > 0:
        return sale
    return _money_q(_d(getattr(line, "cost_amount", None)))


def ensure_fish_sale_for_transfer_line(
    line: AquacultureFishPondTransferLine,
    *,
    transfer: AquacultureFishPondTransfer | None = None,
) -> AquacultureFishSale | None:
    """
    Create or refresh the seller-side AquacultureFishSale for one transfer line.
    Returns None when weight is missing/zero (nothing to sell).
    """
    transfer = transfer or line.transfer
    weight = _d(line.weight_kg)
    if weight <= 0:
        return None

    amount = sale_amount_for_transfer_line(line)
    buyer = ""
    to_pond = getattr(line, "to_pond", None)
    if to_pond is not None:
        buyer = (getattr(to_pond, "pos_customer_display", None) or "").strip()
        if not buyer:
            pc = getattr(to_pond, "pos_customer", None)
            if pc is not None:
                buyer = (pc.company_name or pc.display_name or "").strip()
        if not buyer:
            buyer = (to_pond.name or "").strip()
    if not buyer:
        buyer = f"Pond #{line.to_pond_id}"

    memo_bits = [
        f"Inter-pond sale (from transfer #{transfer.id}, line #{line.id})",
    ]
    if (transfer.memo or "").strip():
        memo_bits.append(transfer.memo.strip())

    ipt_inv = (
        Invoice.all_objects.filter(internal_fish_transfer_line_id=line.id)
        .order_by("id")
        .first()
    )

    defaults = {
        "company_id": transfer.company_id,
        "pond_id": transfer.from_pond_id,
        "production_cycle_id": transfer.from_production_cycle_id,
        "income_type": (
            "fingerling_sale"
            if (getattr(getattr(transfer, "from_pond", None), "pond_role", "") or "")
            .strip()
            .lower()
            in ("nursing", "broodstock")
            else "fish_harvest_sale"
        ),
        "fish_species": transfer.fish_species or "tilapia",
        "fish_species_other": (transfer.fish_species_other or "").strip()[:120],
        "sale_date": transfer.transfer_date,
        "weight_kg": weight,
        "fish_count": line.fish_count,
        "total_amount": amount,
        "buyer_name": buyer[:200],
        "memo": " — ".join(memo_bits)[:2000],
    }
    if ipt_inv is not None and not AquacultureFishSale.objects.filter(invoice_id=ipt_inv.id).exclude(
        source_fish_pond_transfer_line_id=line.id
    ).exists():
        defaults["invoice_id"] = ipt_inv.id

    existing = AquacultureFishSale.objects.filter(source_fish_pond_transfer_line_id=line.id).first()
    if existing:
        for k, v in defaults.items():
            setattr(existing, k, v)
        existing.save()
        return existing

    return AquacultureFishSale.objects.create(
        source_fish_pond_transfer_line_id=line.id,
        **defaults,
    )


@transaction.atomic
def materialize_fish_sales_for_transfer(transfer: AquacultureFishPondTransfer) -> list[AquacultureFishSale]:
    out: list[AquacultureFishSale] = []
    lines = (
        AquacultureFishPondTransferLine.objects.filter(transfer_id=transfer.id)
        .select_related("to_pond", "to_pond__pos_customer", "transfer")
        .order_by("id")
    )
    for line in lines:
        sale = ensure_fish_sale_for_transfer_line(line, transfer=transfer)
        if sale is not None:
            out.append(sale)
    return out


@transaction.atomic
def materialize_fish_sales_for_company(company_id: int) -> dict:
    """Ensure every historical transfer line has a seller sale row. Does not delete transfers."""
    created = 0
    updated = 0
    skipped = 0
    missing = (
        AquacultureFishPondTransferLine.objects.filter(
            transfer__company_id=company_id,
            materialized_fish_sale__isnull=True,
        )
        .select_related("transfer", "to_pond", "to_pond__pos_customer")
        .order_by("id")
    )
    for line in missing:
        sale = ensure_fish_sale_for_transfer_line(line, transfer=line.transfer)
        if sale is None:
            skipped += 1
        else:
            created += 1
    transfer_count = AquacultureFishPondTransfer.objects.filter(company_id=company_id).count()
    return {
        "company_id": company_id,
        "transfers": transfer_count,
        "sales_created": created,
        "sales_updated": updated,
        "lines_skipped": skipped,
    }
