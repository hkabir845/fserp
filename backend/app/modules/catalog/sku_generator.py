"""Generate unique per-tenant item SKUs when the user does not provide one."""

import secrets
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.modules.catalog.models import Item

# Short prefixes by product type (industrial catalog)
_TYPE_PREFIX: dict[str, str] = {
    "raw_material": "RM",
    "finished_good": "FG",
    "feed": "FD",
    "flour": "FL",
    "fuel": "FU",
    "animal": "AN",
    "bird": "BR",
    "service": "SRV",
}


def generate_unique_item_sku(db: Session, tenant_id: int, item_type: str) -> str:
    """Return a SKU like ``RM-20260421-A1B2C3`` guaranteed unique for this tenant."""
    p = _TYPE_PREFIX.get((item_type or "").strip(), "ITM")
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    for _ in range(50):
        suffix = secrets.token_hex(3).upper()
        sku = f"{p}-{day}-{suffix}"
        exists = (
            db.query(Item.id)
            .filter(Item.tenant_id == tenant_id, Item.sku == sku)
            .first()
        )
        if not exists:
            return sku
    # Extremely unlikely: longer suffix
    sku = f"{p}-{day}-{secrets.token_hex(8).upper()}"
    return sku
