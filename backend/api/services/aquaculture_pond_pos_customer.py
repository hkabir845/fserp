"""
Auto-create a General POS customer when a pond is created (best practice: POS on account).

Linked customers are marked on the pond with auto_pos_customer; display name and active flag
stay in sync until the user assigns a different customer manually.
"""
from __future__ import annotations

import logging
from decimal import Decimal

from django.db import transaction

from api.models import AquaculturePond, Customer, Station
from api.services.reference_code import assign_string_code_if_empty

logger = logging.getLogger(__name__)

AUTO_CUSTOMER_PREFIX = "Aquaculture — "


def auto_pos_customer_display_name(pond_name: str) -> str:
    n = (pond_name or "").strip()
    s = f"{AUTO_CUSTOMER_PREFIX}{n}" if n else AUTO_CUSTOMER_PREFIX.strip()
    return s[:200]


def resolve_shop_station_for_pond(*, company_id: int, pond_id: int | None = None) -> int | None:
    """
    Default selling site for a pond POS customer (e.g. Premium Agro shop hub).
    Prefer a station explicitly linked to the pond, then shop-only sites, then Premium Agro by name.
    """
    if pond_id:
        linked = (
            Station.objects.filter(
                company_id=company_id,
                is_active=True,
                default_aquaculture_pond_id=pond_id,
            )
            .order_by("id")
            .first()
        )
        if linked:
            return int(linked.id)
    shop = (
        Station.objects.filter(company_id=company_id, is_active=True, operates_fuel_retail=False)
        .order_by("id")
        .first()
    )
    if shop:
        return int(shop.id)
    named = (
        Station.objects.filter(company_id=company_id, is_active=True, station_name__iexact="Premium Agro")
        .order_by("id")
        .first()
    )
    if named:
        return int(named.id)
    fallback = Station.objects.filter(company_id=company_id, is_active=True).order_by("id").first()
    return int(fallback.id) if fallback else None


def maybe_provision_auto_pos_customer(
    *,
    company_id: int,
    pond: AquaculturePond,
    skip_auto: bool,
) -> str | None:
    """
    If the pond has no pos_customer yet, create one and link it. Sets pond.auto_pos_customer True.
    Returns error detail or None.
    """
    if skip_auto:
        return None
    if pond.pos_customer_id:
        return None
    station_id = resolve_shop_station_for_pond(company_id=company_id, pond_id=pond.pk)
    c = Customer(
        company_id=company_id,
        display_name=auto_pos_customer_display_name(pond.name),
        company_name="",
        first_name="",
        is_active=bool(pond.is_active),
        customer_number="",
        current_balance=Decimal("0"),
        default_station_id=station_id,
    )
    c.save()
    assigned, aerr = assign_string_code_if_empty(
        company_id, Customer, "customer_number", "CUST", c.pk, None, None
    )
    if aerr:
        c.delete()
        return aerr or "Could not assign customer number."
    pond.pos_customer_id = c.pk
    pond.auto_pos_customer = True
    pond.save(update_fields=["pos_customer_id", "auto_pos_customer"])
    return None


def sync_auto_pos_customer_from_pond(pond: AquaculturePond) -> None:
    """Keep display name and active flag aligned with the pond for auto-managed customers."""
    if not getattr(pond, "auto_pos_customer", False) or not pond.pos_customer_id:
        return
    station_id = resolve_shop_station_for_pond(company_id=pond.company_id, pond_id=pond.pk)
    Customer.objects.filter(pk=pond.pos_customer_id, company_id=pond.company_id).update(
        display_name=auto_pos_customer_display_name(pond.name),
        is_active=bool(pond.is_active),
        default_station_id=station_id,
    )


def provision_missing_pond_pos_customers(*, company_id: int) -> dict:
    """
    Create POS customers for ponds that have none. Idempotent.
    Returns {"created": [pond_id, ...], "errors": [{"pond_id", "detail"}, ...]}.
    """
    created: list[int] = []
    errors: list[dict] = []
    qs = AquaculturePond.objects.filter(company_id=company_id, pos_customer_id__isnull=True).order_by("id")
    for pond in qs:
        err = maybe_provision_auto_pos_customer(company_id=company_id, pond=pond, skip_auto=False)
        if err:
            errors.append({"pond_id": pond.pk, "detail": err})
        elif pond.pos_customer_id:
            created.append(int(pond.pk))
    return {"created": created, "errors": errors}


def sync_aquaculture_customer_default_stations(*, company_id: int) -> int:
    """Align default_station on auto-managed pond POS customers with the shop hub for each pond."""
    updated = 0
    ponds = AquaculturePond.objects.filter(
        company_id=company_id,
        auto_pos_customer=True,
        pos_customer_id__isnull=False,
    ).only("id", "pos_customer_id")
    for pond in ponds:
        station_id = resolve_shop_station_for_pond(company_id=company_id, pond_id=pond.pk)
        n = Customer.objects.filter(
            pk=pond.pos_customer_id,
            company_id=company_id,
        ).exclude(default_station_id=station_id).update(default_station_id=station_id)
        updated += n
    return updated


def _deactivate_customer_if_zero_balance(company_id: int, customer_id: int) -> None:
    c = Customer.objects.filter(pk=customer_id, company_id=company_id).first()
    if not c:
        return
    bal = c.current_balance or Decimal("0")
    if bal != Decimal("0"):
        logger.info(
            "Leaving aquaculture auto-customer %s active (non-zero balance %s)",
            customer_id,
            bal,
        )
        return
    Customer.objects.filter(pk=customer_id, company_id=company_id).update(is_active=False)


def on_pond_pos_customer_replaced(
    *,
    company_id: int,
    old_customer_id: int | None,
    old_was_auto_managed: bool,
    new_customer_id: int | None,
) -> None:
    """When user picks a different POS customer, deactivate the old auto-created one if unused."""
    if not old_was_auto_managed or not old_customer_id:
        return
    if new_customer_id == old_customer_id:
        return
    _deactivate_customer_if_zero_balance(company_id, old_customer_id)


def on_pond_pos_customer_cleared(*, company_id: int, old_customer_id: int | None, old_was_auto_managed: bool) -> None:
    if not old_was_auto_managed or not old_customer_id:
        return
    _deactivate_customer_if_zero_balance(company_id, old_customer_id)


def on_pond_deleted(*, company_id: int, pond: AquaculturePond) -> None:
    if getattr(pond, "auto_pos_customer", False) and pond.pos_customer_id:
        _deactivate_customer_if_zero_balance(company_id, pond.pos_customer_id)


def customer_is_linked_pond_pos(company_id: int, customer_id: int | None) -> bool:
    """True when this customer is the linked POS account for an active aquaculture pond."""
    if customer_id is None:
        return False
    try:
        cid = int(customer_id)
    except (TypeError, ValueError):
        return False
    if cid <= 0:
        return False
    return AquaculturePond.objects.filter(
        company_id=company_id,
        is_active=True,
        pos_customer_id=cid,
    ).exists()


def pond_pos_customer_ids(company_id: int) -> list[int]:
    """Active pond-linked POS customer ids (for Cashier UI)."""
    return list(
        AquaculturePond.objects.filter(
            company_id=company_id,
            is_active=True,
            pos_customer_id__isnull=False,
        )
        .values_list("pos_customer_id", flat=True)
        .distinct()
    )
