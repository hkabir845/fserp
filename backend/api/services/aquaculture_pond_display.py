"""Display names for nursing vs grow-out phases on the same physical pond site."""

from __future__ import annotations

import re

from api.models import AquaculturePond, BillLine

_AUTO_POND_CODE = re.compile(r"^P\d+$", re.I)


def _strip_nursing_suffix(name: str) -> str:
    cleaned = name
    for suffix in (" Nursing Pond", " Nursing", " nursing pond", " nursing"):
        if cleaned.lower().endswith(suffix.lower()):
            cleaned = cleaned[: -len(suffix)].strip()
    return cleaned


def _strip_grow_out_suffix(name: str) -> str:
    cleaned = name
    for suffix in ("-Grow Out", "-Grow-out", " Grow Out", "-Grow-out"):
        if suffix.lower() in cleaned.lower():
            cleaned = re.sub(re.escape(suffix), "", cleaned, flags=re.I).strip()
    return cleaned


def pond_site_base_name(pond: AquaculturePond) -> str:
    """Short site label (e.g. Mynuddin)."""
    physical = (getattr(pond, "physical_site_name", None) or "").strip()
    if physical:
        return physical
    code = (pond.code or "").strip()
    if code and not _AUTO_POND_CODE.match(code):
        return code
    name = (pond.name or "").strip()
    if not name:
        return f"Pond {pond.id}"
    name = _strip_nursing_suffix(name)
    name = _strip_grow_out_suffix(name)
    return name.strip() or f"Pond {pond.id}"


def pond_nursing_display_name(pond: AquaculturePond) -> str:
    """While fry are nursed (e.g. Mynuddin Nursing Pond)."""
    name = (pond.name or "").strip()
    lower = name.lower()
    if "nursing" in lower:
        return name
    base = pond_site_base_name(pond)
    return f"{base} Nursing Pond"


def pond_grow_out_display_name(pond: AquaculturePond) -> str:
    """Fingerling grow-out on the same physical site (e.g. Mynuddin Pond)."""
    name = (pond.name or "").strip()
    if "nursing" in name.lower():
        return pond_site_base_name(pond)
    cleaned = _strip_grow_out_suffix(name)
    return cleaned or pond_site_base_name(pond)


def pond_operational_display_name(pond: AquaculturePond | None, *, phase: str | None = None) -> str:
    if not pond:
        return ""
    role = (phase or getattr(pond, "pond_role", None) or "grow_out").strip().lower()
    if role == "nursing":
        return pond_nursing_display_name(pond)
    if role == "grow_out":
        return pond_grow_out_display_name(pond)
    return (pond.name or "").strip() or f"Pond {pond.id}"


def prefer_nursing_pond_id(ponds: list[AquaculturePond]) -> int | None:
    nursing = [p for p in ponds if (getattr(p, "pond_role", None) or "").strip().lower() == "nursing"]
    return nursing[0].id if nursing else None


def _bill_line_is_fish_stocking(line: BillLine) -> bool:
    if getattr(line, "aquaculture_fish_count", None) is not None:
        return True
    if getattr(line, "aquaculture_fish_weight_kg", None) is not None:
        return True
    species = (getattr(line, "aquaculture_fish_species", "") or "").strip()
    if species and species != "not_applicable":
        return True
    item = getattr(line, "item", None)
    return bool(item and (getattr(item, "pos_category", "") or "").strip().lower() == "fish")


def bill_line_pond_display_name(pond: AquaculturePond | None, line: BillLine) -> str:
    if not pond:
        return ""
    role = (getattr(pond, "pond_role", None) or "grow_out").strip().lower()
    if _bill_line_is_fish_stocking(line) and role == "nursing":
        return pond_nursing_display_name(pond)
    return pond_operational_display_name(pond, phase=role)
