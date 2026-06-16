from decimal import Decimal, ROUND_HALF_UP
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from app.modules.feed_manufacturing.models import Silo, SiloTransaction


class SiloService:
    @staticmethod
    def _cap_level(silo: Silo, proposed: Decimal) -> Tuple[Decimal, Optional[str]]:
        if silo.capacity_kg is None:
            return proposed, None
        cap = Decimal(str(silo.capacity_kg))
        if proposed > cap:
            return cap, "Level capped at silo capacity"
        return proposed, None

    @staticmethod
    def consume(
        db: Session,
        tenant_id: int,
        silo_id: int,
        qty_kg: Decimal,
        ref_type: str,
        ref_id: Optional[int],
        notes: Optional[str],
        user_id: Optional[int],
    ) -> SiloTransaction:
        if qty_kg <= 0:
            raise ValueError("Consumption quantity must be positive")
        silo = (
            db.query(Silo)
            .filter(Silo.id == silo_id, Silo.tenant_id == tenant_id, Silo.is_active == True)
            .with_for_update()
            .first()
        )
        if not silo:
            raise ValueError("Silo not found or inactive")
        current = Decimal(str(silo.current_qty_kg or 0))
        if current < qty_kg:
            raise ValueError(f"Insufficient silo stock. Available: {current} kg, required: {qty_kg} kg")
        silo.current_qty_kg = (current - qty_kg).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
        txn = SiloTransaction(
            tenant_id=tenant_id,
            silo_id=silo.id,
            qty_delta=-qty_kg,
            ref_type=ref_type,
            ref_id=ref_id,
            notes=notes,
            created_by=user_id,
        )
        db.add(txn)
        return txn

    @staticmethod
    def fill(
        db: Session,
        tenant_id: int,
        silo_id: int,
        qty_kg: Decimal,
        ref_type: str,
        ref_id: Optional[int],
        notes: Optional[str],
        user_id: Optional[int],
    ) -> SiloTransaction:
        if qty_kg <= 0:
            raise ValueError("Fill quantity must be positive")
        silo = (
            db.query(Silo)
            .filter(Silo.id == silo_id, Silo.tenant_id == tenant_id, Silo.is_active == True)
            .with_for_update()
            .first()
        )
        if not silo:
            raise ValueError("Silo not found or inactive")
        current = Decimal(str(silo.current_qty_kg or 0))
        new_level, warn = SiloService._cap_level(silo, current + qty_kg)
        silo.current_qty_kg = new_level
        n = notes or ""
        if warn:
            n = f"{n} [{warn}]".strip()
        txn = SiloTransaction(
            tenant_id=tenant_id,
            silo_id=silo.id,
            qty_delta=qty_kg,
            ref_type=ref_type,
            ref_id=ref_id,
            notes=n or None,
            created_by=user_id,
        )
        db.add(txn)
        return txn

    @staticmethod
    def adjust_level(
        db: Session,
        tenant_id: int,
        silo_id: int,
        new_level_kg: Decimal,
        notes: Optional[str],
        user_id: Optional[int],
    ) -> SiloTransaction:
        silo = (
            db.query(Silo)
            .filter(Silo.id == silo_id, Silo.tenant_id == tenant_id)
            .with_for_update()
            .first()
        )
        if not silo:
            raise ValueError("Silo not found")
        if new_level_kg < 0:
            raise ValueError("Level cannot be negative")
        new_level_kg, warn = SiloService._cap_level(silo, new_level_kg)
        old = Decimal(str(silo.current_qty_kg or 0))
        delta = new_level_kg - old
        silo.current_qty_kg = new_level_kg
        n = notes or ""
        if warn:
            n = f"{n} [{warn}]".strip()
        txn = SiloTransaction(
            tenant_id=tenant_id,
            silo_id=silo.id,
            qty_delta=delta,
            ref_type="adjustment",
            ref_id=None,
            notes=n or None,
            created_by=user_id,
        )
        db.add(txn)
        return txn

    @staticmethod
    def set_level_from_sensor(
        db: Session,
        tenant_id: int,
        silo_id: int,
        reported_level_kg: Decimal,
        notes: Optional[str],
        user_id: Optional[int],
    ) -> SiloTransaction:
        """Absolute level from load cell / PLC — stored as adjustment-style delta for audit."""
        silo = (
            db.query(Silo)
            .filter(Silo.id == silo_id, Silo.tenant_id == tenant_id, Silo.is_active == True)
            .with_for_update()
            .first()
        )
        if not silo:
            raise ValueError("Silo not found or inactive")
        if reported_level_kg < 0:
            raise ValueError("Reported level cannot be negative")
        reported_level_kg, warn = SiloService._cap_level(silo, reported_level_kg)
        old = Decimal(str(silo.current_qty_kg or 0))
        delta = reported_level_kg - old
        silo.current_qty_kg = reported_level_kg
        n = notes or ""
        if warn:
            n = f"{n} [{warn}]".strip()
        txn = SiloTransaction(
            tenant_id=tenant_id,
            silo_id=silo.id,
            qty_delta=delta,
            ref_type="sensor_sync",
            ref_id=None,
            notes=n or None,
            created_by=user_id,
        )
        db.add(txn)
        return txn
