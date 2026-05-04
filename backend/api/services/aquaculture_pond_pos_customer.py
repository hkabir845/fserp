"""
Auto-create a General POS customer when a pond is created (best practice: POS on account).

Linked customers are marked on the pond with auto_pos_customer; display name and active flag
stay in sync until the user assigns a different customer manually.
"""
from __future__ import annotations

import logging
from decimal import Decimal

from django.db import transaction

from api.models import AquaculturePond, Customer
from api.services.reference_code import assign_string_code_if_empty

logger = logging.getLogger(__name__)

AUTO_CUSTOMER_PREFIX = "Aquaculture — "


def auto_pos_customer_display_name(pond_name: str) -> str:
    n = (pond_name or "").strip()
    s = f"{AUTO_CUSTOMER_PREFIX}{n}" if n else AUTO_CUSTOMER_PREFIX.strip()
    return s[:200]


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
    c = Customer(
        company_id=company_id,
        display_name=auto_pos_customer_display_name(pond.name),
        company_name="",
        first_name="",
        is_active=bool(pond.is_active),
        customer_number="",
        current_balance=Decimal("0"),
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
    pond.save()
    return None


def sync_auto_pos_customer_from_pond(pond: AquaculturePond) -> None:
    """Keep display name and active flag aligned with the pond for auto-managed customers."""
    if not getattr(pond, "auto_pos_customer", False) or not pond.pos_customer_id:
        return
    Customer.objects.filter(pk=pond.pos_customer_id, company_id=pond.company_id).update(
        display_name=auto_pos_customer_display_name(pond.name),
        is_active=bool(pond.is_active),
    )


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
