"""Resolve tenant-scoped catalog UOMs; sync from platform catalog when missing."""

from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.catalog.models import UOM
from app.modules.platform.models import UnitOfMeasure


# Minimal platform UOMs inserted when the platform catalog is empty (dev / new installs).
MINIMAL_PLATFORM_UOMS: list[dict] = [
    {"code": "KG", "name": "Kilogram", "category": "weight", "base_unit": "KG", "conversion_factor": Decimal("1")},
    {"code": "G", "name": "Gram", "category": "weight", "base_unit": "KG", "conversion_factor": Decimal("0.001")},
    {"code": "MT", "name": "Metric Ton", "category": "weight", "base_unit": "KG", "conversion_factor": Decimal("1000")},
    {"code": "L", "name": "Liter", "category": "volume", "base_unit": "L", "conversion_factor": Decimal("1")},
    {"code": "ML", "name": "Milliliter", "category": "volume", "base_unit": "L", "conversion_factor": Decimal("0.001")},
    {"code": "NOS", "name": "Numbers", "category": "count", "base_unit": None, "conversion_factor": Decimal("1")},
    {"code": "PCS", "name": "Pieces", "category": "count", "base_unit": None, "conversion_factor": Decimal("1")},
    {"code": "PIECE", "name": "Piece", "category": "count", "base_unit": None, "conversion_factor": Decimal("1")},
    {"code": "EA", "name": "Each", "category": "count", "base_unit": None, "conversion_factor": Decimal("1")},
    {"code": "BAG", "name": "Bag", "category": "packaging", "base_unit": None, "conversion_factor": Decimal("1")},
]


def ensure_minimal_platform_uoms(db: Session) -> None:
    """Insert a small industrial set when no platform UOMs exist (same request transaction)."""
    count = db.query(UnitOfMeasure).count()
    if count > 0:
        return
    for row in MINIMAL_PLATFORM_UOMS:
        db.add(
            UnitOfMeasure(
                code=row["code"],
                name=row["name"],
                category=row["category"],
                base_unit=row.get("base_unit"),
                conversion_factor=row["conversion_factor"],
                is_active=True,
            )
        )
    db.flush()


def get_or_create_tenant_uom(
    db: Session, tenant_id: int, code: str, user_id: int | None
) -> UOM:
    """Return tenant catalog UOM by code; create from platform UOM if needed."""
    code = (code or "").strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="Invalid or empty uom_code")

    existing = db.query(UOM).filter(UOM.tenant_id == tenant_id, UOM.code == code).first()
    if existing:
        return existing

    platform = db.query(UnitOfMeasure).filter(UnitOfMeasure.code == code).first()
    name = platform.name if platform else code
    row = UOM(tenant_id=tenant_id, code=code, name=name, created_by=user_id)
    db.add(row)
    db.flush()
    return row


def resolve_item_uom_id(
    db: Session,
    tenant_id: int,
    *,
    uom_id: int | None,
    uom_code: str | None,
    user_id: int | None,
) -> int:
    """Pick catalog uom_id from explicit id or case-insensitive code."""
    if uom_code and str(uom_code).strip():
        return get_or_create_tenant_uom(db, tenant_id, uom_code, user_id).id
    if uom_id is not None:
        uom = db.query(UOM).filter(UOM.id == uom_id, UOM.tenant_id == tenant_id).first()
        if not uom:
            raise HTTPException(status_code=400, detail="Invalid uom_id for this company")
        return uom.id

    raise HTTPException(status_code=400, detail="Either uom_id or uom_code is required")
