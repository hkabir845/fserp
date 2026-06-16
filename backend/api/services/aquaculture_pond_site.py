"""Same physical site: nursing-phase pond ↔ grow-out-phase pond (e.g. Mynuddin Nursing → Mynuddin)."""

from __future__ import annotations

from api.models import AquaculturePond
from api.services.aquaculture_pond_display import (
    pond_grow_out_display_name,
    pond_nursing_display_name,
    pond_site_base_name,
)


def normalize_physical_site_name(raw: str | None) -> str:
    return (raw or "").strip()


def _role(pond: AquaculturePond) -> str:
    return (getattr(pond, "pond_role", None) or "grow_out").strip().lower()


def ponds_for_site(company_id: int, site_name: str, *, active_only: bool = True) -> list[AquaculturePond]:
    site = normalize_physical_site_name(site_name)
    if not site:
        return []
    qs = AquaculturePond.objects.filter(company_id=company_id, physical_site_name__iexact=site)
    if active_only:
        qs = qs.filter(is_active=True)
    return list(qs.order_by("sort_order", "id"))


def same_site_grow_out_pond(pond: AquaculturePond | None) -> AquaculturePond | None:
    """Grow-out profit center paired with this nursing pond (explicit link or same physical site)."""
    if not pond or _role(pond) != "nursing":
        return None
    linked_id = getattr(pond, "linked_grow_out_pond_id", None)
    if linked_id:
        dest = getattr(pond, "linked_grow_out_pond", None)
        if dest and dest.is_active:
            return dest
        found = AquaculturePond.objects.filter(
            pk=linked_id, company_id=pond.company_id, is_active=True
        ).first()
        if found:
            return found
    site = normalize_physical_site_name(getattr(pond, "physical_site_name", None))
    if not site:
        return None
    for peer in ponds_for_site(pond.company_id, site):
        if peer.id != pond.id and _role(peer) == "grow_out":
            return peer
    return None


def same_site_nursing_pond(pond: AquaculturePond | None) -> AquaculturePond | None:
    """Nursing-phase profit center paired with this grow-out pond."""
    if not pond:
        return None
    cid = pond.company_id
    if _role(pond) == "grow_out":
        explicit = AquaculturePond.objects.filter(
            company_id=cid,
            linked_grow_out_pond_id=pond.id,
            is_active=True,
        ).order_by("sort_order", "id").first()
        if explicit:
            return explicit
    site = normalize_physical_site_name(getattr(pond, "physical_site_name", None))
    if site:
        for peer in ponds_for_site(cid, site):
            if peer.id != pond.id and _role(peer) == "nursing":
                return peer
    return None


def site_peers_json(pond: AquaculturePond) -> list[dict]:
    site = normalize_physical_site_name(getattr(pond, "physical_site_name", None))
    if not site:
        return []
    out: list[dict] = []
    for p in ponds_for_site(pond.company_id, site):
        if p.id == pond.id:
            continue
        role = _role(p)
        out.append(
            {
                "id": p.id,
                "name": (p.name or "").strip(),
                "pond_role": role,
                "operational_display_name": (
                    pond_nursing_display_name(p) if role == "nursing" else pond_grow_out_display_name(p)
                ),
            }
        )
    return out


def phase_workflow_summary(pond: AquaculturePond) -> str:
    role = _role(pond)
    base = pond_site_base_name(pond)
    if role == "nursing":
        grow = same_site_grow_out_pond(pond)
        grow_label = pond_grow_out_display_name(grow) if grow else f"{base} (grow-out)"
        return (
            f"Nursing phase on this physical site: stock fry here, record mortality and feeding, "
            f"sample until fingerling size (measured pcs/kg from seine sampling), then transfer to production ponds and "
            f"remainder to {grow_label}."
        )
    if role == "grow_out":
        nurse = same_site_nursing_pond(pond)
        if nurse:
            nurse_label = pond_nursing_display_name(nurse)
            return (
                f"Grow-out phase on this physical site. Fingerlings arrive from {nurse_label} "
                f"via inter-pond transfer after nursing; continue feed, sampling, and harvest here."
            )
        return "Grow-out / production pond on this physical site."
    return ""


def validate_nursing_grow_out_link(
    nursing: AquaculturePond,
    grow_out: AquaculturePond,
) -> str | None:
    if _role(nursing) != "nursing":
        return "Source pond must have role Nursing / nursery."
    if _role(grow_out) != "grow_out":
        return "Linked pond must have role Grow-out."
    if nursing.id == grow_out.id:
        return "Cannot link a pond to itself."
    ns = normalize_physical_site_name(nursing.physical_site_name)
    gs = normalize_physical_site_name(grow_out.physical_site_name)
    if ns and gs and ns.lower() != gs.lower():
        return (
            f"Physical site names must match ({ns!r} vs {gs!r}). "
            "Use the same site label for both phases on one water body."
        )
    return None


def default_nursing_name_for_site(site_name: str) -> str:
    base = normalize_physical_site_name(site_name) or "Pond"
    if "nursing" in base.lower():
        return base
    return f"{base} Nursing Pond"


def default_grow_out_name_for_site(site_name: str) -> str:
    base = normalize_physical_site_name(site_name) or "Pond"
    for suffix in (" Nursing Pond", " Nursing", "-Grow Out", " Grow Out"):
        if base.lower().endswith(suffix.lower()):
            base = base[: -len(suffix)].strip()
    return base or "Pond"
