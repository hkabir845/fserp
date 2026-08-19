"""
Supplier identity for a pond, so one pond can sell fish or fingerlings to another.

Mirrors api.services.aquaculture_pond_pos_customer: that module gives a pond its *buying*
face (an AR customer other profit centres invoice), this one gives it the *selling* face
(an AP vendor the buying pond raises a bill against). Both point back at the pond through
is_internal / internal_pond so external A/R and A/P reporting can exclude them.
"""
from __future__ import annotations

import logging
from decimal import Decimal

from api.models import AquaculturePond, Customer, Vendor
from api.services.aquaculture_pond_pos_customer import auto_pos_customer_display_name
from api.services.reference_code import assign_string_code_if_empty

logger = logging.getLogger(__name__)


def auto_internal_vendor_display_name(pond_name: str) -> str:
    """Same label as the pond's POS customer — one pond, two trading faces."""
    return auto_pos_customer_display_name(pond_name)


def maybe_provision_auto_internal_vendor(
    *,
    company_id: int,
    pond: AquaculturePond,
    skip_auto: bool,
) -> str | None:
    """
    If the pond has no internal_vendor yet, create one and link it.
    Sets pond.auto_internal_vendor True. Returns error detail or None.
    """
    if skip_auto:
        return None
    if pond.internal_vendor_id:
        return None
    name = auto_internal_vendor_display_name(pond.name)
    v = Vendor(
        company_id=company_id,
        company_name=name,
        display_name=name,
        is_active=bool(pond.is_active),
        vendor_number="",
        current_balance=Decimal("0"),
        is_internal=True,
        internal_pond_id=pond.pk,
    )
    v.save()
    assigned, aerr = assign_string_code_if_empty(
        company_id, Vendor, "vendor_number", "VND", v.pk, None, None
    )
    if aerr:
        v.delete()
        return aerr or "Could not assign vendor number."
    pond.internal_vendor_id = v.pk
    pond.auto_internal_vendor = True
    pond.save(update_fields=["internal_vendor_id", "auto_internal_vendor"])
    return None


def sync_auto_internal_vendor_from_pond(pond: AquaculturePond) -> None:
    """Keep name and active flag aligned with the pond for auto-managed internal vendors."""
    if not getattr(pond, "auto_internal_vendor", False) or not pond.internal_vendor_id:
        return
    name = auto_internal_vendor_display_name(pond.name)
    Vendor.objects.filter(pk=pond.internal_vendor_id, company_id=pond.company_id).update(
        company_name=name,
        display_name=name,
        is_active=bool(pond.is_active),
    )


def mark_pond_pos_customer_internal(pond: AquaculturePond) -> int:
    """
    Flag the pond's POS customer as an internal party. Idempotent.

    Only auto-provisioned customers are flagged: when a user has deliberately pointed the pond
    at a real outside customer, that customer stays external and keeps counting toward real A/R.
    """
    if not pond.pos_customer_id or not getattr(pond, "auto_pos_customer", False):
        return 0
    return Customer.objects.filter(
        pk=pond.pos_customer_id,
        company_id=pond.company_id,
    ).exclude(
        is_internal=True,
        internal_pond_id=pond.pk,
    ).update(is_internal=True, internal_pond_id=pond.pk)


def provision_pond_internal_parties(
    *,
    company_id: int,
    pond: AquaculturePond,
    skip_auto: bool = False,
) -> str | None:
    """Give the pond its selling face and mark its buying face internal. Idempotent."""
    err = maybe_provision_auto_internal_vendor(
        company_id=company_id, pond=pond, skip_auto=skip_auto
    )
    mark_pond_pos_customer_internal(pond)
    return err


def provision_missing_pond_internal_vendors(*, company_id: int) -> dict:
    """
    Create internal vendors for ponds that have none and flag auto POS customers internal.
    Idempotent. Returns {"created": [pond_id, ...], "errors": [{"pond_id", "detail"}, ...]}.
    """
    created: list[int] = []
    errors: list[dict] = []
    for pond in AquaculturePond.objects.filter(company_id=company_id).order_by("id"):
        had_vendor = bool(pond.internal_vendor_id)
        err = provision_pond_internal_parties(company_id=company_id, pond=pond)
        if err:
            errors.append({"pond_id": pond.pk, "detail": err})
        elif not had_vendor and pond.internal_vendor_id:
            created.append(int(pond.pk))
    return {"created": created, "errors": errors}


def _deactivate_vendor_if_zero_balance(company_id: int, vendor_id: int) -> None:
    v = Vendor.objects.filter(pk=vendor_id, company_id=company_id).first()
    if not v:
        return
    bal = v.current_balance or Decimal("0")
    if bal != Decimal("0"):
        logger.info(
            "Leaving aquaculture internal vendor %s active (non-zero balance %s)",
            vendor_id,
            bal,
        )
        return
    Vendor.objects.filter(pk=vendor_id, company_id=company_id).update(is_active=False)


def on_pond_deleted_internal_vendor(*, company_id: int, pond: AquaculturePond) -> None:
    if getattr(pond, "auto_internal_vendor", False) and pond.internal_vendor_id:
        _deactivate_vendor_if_zero_balance(company_id, pond.internal_vendor_id)


def vendor_is_linked_pond_internal(company_id: int, vendor_id: int | None) -> bool:
    """True when this vendor is the selling identity of an active aquaculture pond."""
    if vendor_id is None:
        return False
    try:
        vid = int(vendor_id)
    except (TypeError, ValueError):
        return False
    if vid <= 0:
        return False
    return AquaculturePond.objects.filter(
        company_id=company_id,
        is_active=True,
        internal_vendor_id=vid,
    ).exists()


def pond_internal_vendor_ids(company_id: int) -> list[int]:
    """Active pond-linked internal vendor ids."""
    return list(
        AquaculturePond.objects.filter(
            company_id=company_id,
            is_active=True,
            internal_vendor_id__isnull=False,
        )
        .values_list("internal_vendor_id", flat=True)
        .distinct()
    )
