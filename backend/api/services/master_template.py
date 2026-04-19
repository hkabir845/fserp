"""
Built-in demo tenant: Master Filling Station (company code FS-000001).

Ensured on deploy via `post_migrate` (unless skipped for tests). Idempotent: safe to run
multiple times. For a full accounting/hardware demo (GL, dips, broadcasts), run
`python manage.py seed_master_full_demo` manually.
"""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any

from django.conf import settings
from django.core.management import call_command
from django.db.models import Q

from api.chart_templates.fuel_station import seed_fuel_station_if_empty
from api.models import Company, Item
from api.services.company_code import MASTER_COMPANY_CODE, resolved_company_code
from api.services.tenant_release import get_target_release

logger = logging.getLogger(__name__)

# Bump when DEFAULT_GENERAL_DEMO_PRODUCTS or bootstrap steps change (ops / support).
MASTER_TEMPLATE_BOOTSTRAP_VERSION = "2"

MASTER_TEMPLATE_NAME = "Master Filling Station"
MASTER_TEMPLATE_LEGAL_NAME = (
    "Master Filling Station (Demo template — FS-000001; safe for experiments and training)"
)

# Shop / service SKUs for Cashier → General (keep in sync with seed_master_general_products).
DEFAULT_GENERAL_DEMO_PRODUCTS: list[dict[str, str]] = [
    {"name": "Drinking Water (500ml)", "unit_price": "20.00", "cost": "12.00", "unit": "piece", "item_type": "inventory", "category": "Beverages"},
    {"name": "Soft Drink (Can)", "unit_price": "45.00", "cost": "30.00", "unit": "piece", "item_type": "inventory", "category": "Beverages"},
    {"name": "Energy Drink", "unit_price": "120.00", "cost": "85.00", "unit": "piece", "item_type": "inventory", "category": "Beverages"},
    {"name": "Snacks Pack", "unit_price": "35.00", "cost": "22.00", "unit": "piece", "item_type": "inventory", "category": "Snacks"},
    {"name": "Engine Oil (1L)", "unit_price": "850.00", "cost": "620.00", "unit": "piece", "item_type": "inventory", "category": "Lubricants"},
    {"name": "Brake Fluid", "unit_price": "320.00", "cost": "210.00", "unit": "piece", "item_type": "inventory", "category": "Lubricants"},
    {"name": "Coolant (1L)", "unit_price": "280.00", "cost": "180.00", "unit": "piece", "item_type": "inventory", "category": "Lubricants"},
    {"name": "Car Air Freshener", "unit_price": "150.00", "cost": "90.00", "unit": "piece", "item_type": "inventory", "category": "Accessories"},
    {"name": "Microfiber Cloth", "unit_price": "80.00", "cost": "45.00", "unit": "piece", "item_type": "inventory", "category": "Accessories"},
    {"name": "Tire Pressure Check (Service)", "unit_price": "50.00", "cost": "0.00", "unit": "service", "item_type": "service", "category": "Service"},
    {"name": "Windshield Wash (Top-up)", "unit_price": "40.00", "cost": "10.00", "unit": "service", "item_type": "service", "category": "Service"},
]


def find_master_company_row() -> Company | None:
    """Single canonical master row (is_master), same idea as master_push.find_master_company."""
    return (
        Company.objects.filter(is_deleted=False)
        .filter(Q(is_master__iexact="true") | Q(is_master="1"))
        .order_by("id")
        .first()
    )


def count_master_company_rows() -> int:
    return (
        Company.objects.filter(is_deleted=False)
        .filter(Q(is_master__iexact="true") | Q(is_master="1"))
        .count()
    )


def _bootstrap_warnings_for_master(master: Company) -> list[str]:
    """Non-fatal issues for operators (logs + API summary)."""
    w: list[str] = []
    n = count_master_company_rows()
    if n > 1:
        w.append(
            f"Multiple master companies flagged ({n}); push uses the oldest id={master.id}. "
            "Demote extras to is_master=false in Admin → Companies."
        )
    code = resolved_company_code(master)
    if code != MASTER_COMPANY_CODE:
        w.append(f"Expected company_code {MASTER_COMPANY_CODE!r}, got {code!r} — run save() or ensure_master_template.")
    return w


def sync_master_template_metadata(master: Company) -> list[str]:
    """
    Keep platform release and display fields aligned when a server upgrade ships.
    Returns list of field names updated.
    """
    target = (get_target_release() or "").strip()[:64]
    updated: list[str] = []
    fields: list[str] = []

    if target and not (master.platform_release or "").strip():
        master.platform_release = target
        fields.append("platform_release")

    if not (master.legal_name or "").strip():
        master.legal_name = MASTER_TEMPLATE_LEGAL_NAME
        fields.append("legal_name")

    if fields:
        master.save(update_fields=fields)
        updated.extend(fields)

    # Reconcile company_code via model save (compute_company_code).
    master.refresh_from_db()
    if resolved_company_code(master) != MASTER_COMPANY_CODE:
        master.save()
        updated.append("company_code")

    return updated


def get_or_create_master_template_company() -> tuple[Company, bool]:
    """
    Return the master template company (FS-000001), creating or promoting a row if needed.

    Returns (company, created) where created is True only when a new DB row was inserted.
    """
    existing = find_master_company_row()
    if existing:
        return existing, False

    legacy = (
        Company.objects.filter(is_deleted=False, name__iexact=MASTER_TEMPLATE_NAME)
        .order_by("id")
        .first()
    )
    if legacy:
        legacy.is_master = "true"
        legacy.save(update_fields=["is_master"])
        sync_master_template_metadata(legacy)
        return legacy, False

    target = get_target_release()[:64]
    c = Company.objects.create(
        name=MASTER_TEMPLATE_NAME,
        legal_name=MASTER_TEMPLATE_LEGAL_NAME,
        currency="BDT",
        is_active=True,
        is_master="true",
        is_deleted=False,
        platform_release=target,
    )
    return c, True


def seed_general_demo_products_for_company(company_id: int) -> int:
    """Idempotent general POS items (names de-duplicated). Returns number of rows created."""
    existing = {
        (n or "").strip().lower()
        for n in Item.objects.filter(company_id=company_id).values_list("name", flat=True)
    }
    n = 0
    for row in DEFAULT_GENERAL_DEMO_PRODUCTS:
        key = row["name"].strip().lower()
        if key in existing:
            continue
        pos_cat = "service" if row["item_type"] == "service" else "general"
        it = Item(
            company_id=company_id,
            name=row["name"][:200],
            description="",
            item_type=row["item_type"][:32],
            unit_price=Decimal(row["unit_price"]),
            cost=Decimal(row["cost"]),
            quantity_on_hand=Decimal("100.0000") if row["item_type"] == "inventory" else Decimal("0"),
            unit=row["unit"][:20],
            pos_category=pos_cat,
            category=(row.get("category") or "")[:100],
            barcode="",
            is_taxable=True,
            is_pos_available=True,
            is_active=True,
            image_url="",
        )
        it.save()
        it.item_number = f"ITM-{it.id}"
        Item.objects.filter(pk=it.pk).update(item_number=it.item_number)
        existing.add(key)
        n += 1
    return n


def ensure_master_template_bootstrap() -> dict[str, Any]:
    """
    Idempotent: master row + chart (if empty) + general products + fuel hardware tree.

    Skipped when settings.SKIP_MASTER_TEMPLATE_BOOTSTRAP is True (pytest / manage.py test).
    """
    if getattr(settings, "SKIP_MASTER_TEMPLATE_BOOTSTRAP", False):
        return {"skipped": True, "reason": "SKIP_MASTER_TEMPLATE_BOOTSTRAP"}

    master, created = get_or_create_master_template_company()
    meta_updates = sync_master_template_metadata(master)
    master.refresh_from_db()

    cid = master.id
    warnings = _bootstrap_warnings_for_master(master)
    for w in warnings:
        logger.warning("Master template: %s", w)

    summary: dict[str, Any] = {
        "skipped": False,
        "bootstrap_version": MASTER_TEMPLATE_BOOTSTRAP_VERSION,
        "company_id": cid,
        "company_code": MASTER_COMPANY_CODE,
        "created": created,
        "metadata_updated": meta_updates,
        "warnings": warnings,
        "chart": None,
        "general_products_added": 0,
        "nozzles": None,
        "nozzles_detail": None,
    }

    chart = seed_fuel_station_if_empty(cid, profile="full")
    summary["chart"] = chart

    summary["general_products_added"] = seed_general_demo_products_for_company(cid)

    try:
        call_command("seed_master_nozzles", verbosity=0)
        summary["nozzles"] = "ok"
    except Exception as e:
        logger.exception("seed_master_nozzles failed during master template bootstrap")
        summary["nozzles"] = "error"
        summary["nozzles_detail"] = str(e)[:500]

    logger.info(
        "Master template ready: id=%s code=%s created=%s coa_seeded=%s products_added=%s version=%s",
        cid,
        MASTER_COMPANY_CODE,
        created,
        chart.get("seeded"),
        summary["general_products_added"],
        MASTER_TEMPLATE_BOOTSTRAP_VERSION,
    )
    return summary
