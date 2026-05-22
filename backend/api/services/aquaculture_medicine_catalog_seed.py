"""
Idempotent built-in aquaculture medicine / pond-care SKUs (AQ-MED-* item numbers).

Mirrors frontend POND_CARE_PRODUCT_GUIDES — seeded into company inventory so the
medicine treatment form product dropdown lists standard products without manual item setup.
"""
from __future__ import annotations

from decimal import Decimal

from api.models import Item

MEDICINE_CATALOG_ITEM_PREFIX = "AQ-MED-"

# guide_id, display name, stock unit, reporting category
_BUILTIN_MEDICINE_SPECS: tuple[tuple[str, str, str, str], ...] = (
    ("ag_lime", "Agricultural lime (CaCO₃ / chuna)", "kg", "Pond care"),
    ("hydrated_lime", "Hydrated lime (Ca(OH)₂)", "kg", "Pond care"),
    ("dolomite", "Dolomite", "kg", "Pond care"),
    ("zeolite", "Zeolite", "kg", "Pond care"),
    ("salt", "Salt (NaCl)", "kg", "Pond care"),
    ("kmno4", "Potassium permanganate (KMnO₄)", "kg", "Pond care"),
    ("formalin", "Formalin (37–40% formaldehyde)", "liter", "Pond care"),
    ("copper_sulphate", "Copper sulphate (bluestone)", "kg", "Pond care"),
    ("malachite", "Malachite green", "liter", "Pond care"),
    ("methylene_blue", "Methylene blue", "liter", "Pond care"),
    ("h2o2", "Hydrogen peroxide (H₂O₂)", "liter", "Pond care"),
    ("bleach", "Calcium hypochlorite / pond bleach", "kg", "Pond care"),
    ("oxytetracycline", "Oxytetracycline (OTC / Terramycin)", "kg", "Medicine"),
    ("florfenicol", "Florfenicol", "kg", "Medicine"),
    ("cifax", "CIFAX / ciprofloxacin (where approved)", "bottle", "Medicine"),
    ("probiotic", "Aquaculture probiotic", "liter", "Pond care"),
    ("vitamin_c", "Vitamin C / ascorbic acid", "kg", "Pond care"),
    ("mineral_premix", "Mineral / vitamin premix", "kg", "Pond care"),
    ("alum", "Alum (aluminium sulphate)", "kg", "Pond care"),
    ("potassium_permanganate_feed", "Potassium (KCl) / pond K supplement", "kg", "Pond care"),
)


def medicine_catalog_item_number(guide_id: str) -> str:
    return f"{MEDICINE_CATALOG_ITEM_PREFIX}{guide_id}"


def guide_id_from_item_number(item_number: str | None) -> str | None:
    raw = (item_number or "").strip()
    if not raw.upper().startswith(MEDICINE_CATALOG_ITEM_PREFIX):
        return None
    gid = raw[len(MEDICINE_CATALOG_ITEM_PREFIX) :].strip()
    return gid or None


def ensure_aquaculture_medicine_catalog_items(company_id: int) -> dict:
    """
    Create or refresh built-in medicine SKUs for a company.
    Returns counts and lightweight item rows for the API.
    """
    created = 0
    updated = 0
    items_out: list[dict] = []

    for guide_id, name, unit, category in _BUILTIN_MEDICINE_SPECS:
        inum = medicine_catalog_item_number(guide_id)
        item = Item.objects.filter(company_id=company_id, item_number=inum).first()
        if item:
            dirty: list[str] = []
            if (item.name or "").strip() != name:
                item.name = name
                dirty.append("name")
            if (item.unit or "").strip() != unit:
                item.unit = unit
                dirty.append("unit")
            if (item.category or "").strip() != category:
                item.category = category
                dirty.append("category")
            if (item.pos_category or "").lower() != "medicine":
                item.pos_category = "medicine"
                dirty.append("pos_category")
            if not item.is_active:
                item.is_active = True
                dirty.append("is_active")
            if item.item_type != "inventory":
                item.item_type = "inventory"
                dirty.append("item_type")
            if dirty:
                item.save(update_fields=dirty + ["updated_at"])
                updated += 1
        else:
            item = Item.objects.create(
                company_id=company_id,
                item_number=inum,
                name=name,
                description="Built-in pond care / medicine SKU — typical dose rates apply in Aquaculture → Medicine.",
                item_type="inventory",
                unit_price=Decimal("0"),
                cost=Decimal("0"),
                unit=unit,
                pos_category="medicine",
                category=category,
                is_active=True,
                is_pos_available=True,
            )
            created += 1

        items_out.append(
            {
                "id": item.id,
                "item_number": item.item_number,
                "name": item.name,
                "unit": item.unit,
                "category": item.category,
                "pos_category": item.pos_category,
                "guide_id": guide_id,
            }
        )

    return {
        "created": created,
        "updated": updated,
        "total": len(items_out),
        "items": items_out,
    }
