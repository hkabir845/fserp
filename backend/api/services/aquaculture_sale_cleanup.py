"""Rollback aquaculture fish sale side-effects (biomass sample + linked invoice GL)."""
from __future__ import annotations

from decimal import Decimal

from django.db import transaction

from api.models import AquacultureBiomassSample, AquacultureFishSale, Invoice, InvoiceLine
from api.services.aquaculture_sale_accounting import _build_sale_line_description, _refresh_invoice_totals
from api.services.document_posting_lifecycle import (
    assert_invoice_change_allowed,
    reconcile_invoice_after_material_edit,
)
from api.services.gl_posting import cleanup_invoice_posting_effects, delete_aquaculture_fish_sale_bio_relief_journal


def cleanup_aquaculture_fish_sale_effects(company_id: int, sale: AquacultureFishSale) -> tuple[bool, str]:
    """
    Before deleting a fish sale: remove linked biomass row, delete linked invoice (with full rollback), clear link.
    """
    with transaction.atomic():
        locked = (
            AquacultureFishSale.objects.select_for_update()
            .filter(pk=sale.pk, company_id=company_id)
            .first()
        )
        if not locked:
            return True, ""

        AquacultureBiomassSample.objects.filter(source_fish_sale_id=locked.id).delete()

        delete_aquaculture_fish_sale_bio_relief_journal(company_id, locked.id)

        inv_id = locked.invoice_id
        if inv_id:
            ok, err = assert_invoice_change_allowed(company_id, int(inv_id))
            if not ok:
                return False, err
            inv = Invoice.objects.filter(pk=inv_id, company_id=company_id).first()
            if inv:
                ok_cl, err_cl = cleanup_invoice_posting_effects(company_id, inv)
                if not ok_cl:
                    return False, err_cl
                inv.delete()
            AquacultureFishSale.objects.filter(pk=locked.pk).update(invoice_id=None)

    return True, ""


def reconcile_aquaculture_fish_sale_with_invoice(
    company_id: int,
    sale: AquacultureFishSale,
    *,
    payment_method: str = "cash",
    bank_account_id: int | None = None,
) -> tuple[bool, str]:
    """After editing a finalized sale: sync biomass sample and refresh linked invoice + GL."""
    from api.services.aquaculture_sale_biomass_sync import sync_biomass_sample_from_fish_sale

    with transaction.atomic():
        sale.refresh_from_db()
        sync_biomass_sample_from_fish_sale(sale)

        inv_id = sale.invoice_id
        if not inv_id:
            return True, ""

        ok, err = assert_invoice_change_allowed(company_id, int(inv_id))
        if not ok:
            return False, err

        inv = Invoice.objects.filter(pk=inv_id, company_id=company_id).first()
        if not inv:
            return True, ""

        amt = (sale.total_amount or Decimal("0")).quantize(Decimal("0.01"))
        inv.invoice_date = sale.sale_date
        inv.subtotal = amt
        inv.total = amt
        inv.save(update_fields=["invoice_date", "subtotal", "total", "updated_at"])

        line = inv.lines.first()
        if line:
            line.description = _build_sale_line_description(sale)[:300]
            line.unit_price = amt
            line.amount = amt
            line.save(update_fields=["description", "unit_price", "amount"])
        else:
            InvoiceLine.objects.create(
                invoice=inv,
                item_id=None,
                description=_build_sale_line_description(sale)[:300],
                quantity=Decimal("1"),
                unit_price=amt,
                amount=amt,
            )
        _refresh_invoice_totals(inv)

        old_status = inv.status
        ok_rec, err_rec = reconcile_invoice_after_material_edit(
            company_id,
            inv,
            old_status=old_status,
            payment_method=payment_method or (inv.payment_method or "cash"),
            bank_account_id=bank_account_id,
        )
        if not ok_rec:
            return False, err_rec

        from api.services.aquaculture_sale_bio_relief_service import sync_aquaculture_fish_sale_bio_relief

        sync_aquaculture_fish_sale_bio_relief(company_id, sale)
        return True, ""
