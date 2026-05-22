"""Standard shift templates for continuous (24/7) station operations."""
from __future__ import annotations

from datetime import time

from api.models import ShiftTemplate

# Three 8-hour windows covering a full day (night shift ends next calendar morning).
STANDARD_24_7_SHIFT_TEMPLATES: tuple[tuple[str, time, time], ...] = (
    ("Day Shift", time(6, 0), time(14, 0)),
    ("Evening Shift", time(14, 0), time(22, 0)),
    ("Night Shift", time(22, 0), time(6, 0)),
)


def seed_standard_24_7_shift_templates(company_id: int) -> dict:
    """
    Ensure the three standard 24/7 templates exist for a company.
    Skips names that already exist (case-insensitive).
    """
    created: list[dict] = []
    skipped: list[str] = []
    for name, start_time, end_time in STANDARD_24_7_SHIFT_TEMPLATES:
        if ShiftTemplate.objects.filter(company_id=company_id, name__iexact=name).exists():
            skipped.append(name)
            continue
        t = ShiftTemplate.objects.create(
            company_id=company_id,
            name=name,
            start_time=start_time,
            end_time=end_time,
        )
        created.append(
            {
                "id": t.id,
                "name": t.name,
                "start_time": t.start_time.isoformat()[:8] if t.start_time else None,
                "end_time": t.end_time.isoformat()[:8] if t.end_time else None,
            }
        )
    return {"created": created, "skipped": skipped, "created_count": len(created)}
