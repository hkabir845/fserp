"""Create missing same-site grow-out ponds per company and fix cross-company links."""

from __future__ import annotations

from django.db import migrations


def _grow_out_name_for_site(site: str, nursing_name: str) -> str:
    site = (site or "").strip()
    nursing = (nursing_name or "").strip()
    if nursing and nursing.lower() == site.lower():
        return f"{site}-Grow Out"
    return site or "Pond"


def _ensure_company_site_pairs(apps, schema_editor):
    AquaculturePond = apps.get_model("api", "AquaculturePond")
    for nursing in AquaculturePond.objects.filter(pond_role="nursing", is_active=True).iterator():
        site = (getattr(nursing, "physical_site_name", None) or "").strip()
        if not site:
            continue
        cid = nursing.company_id
        linked_id = getattr(nursing, "linked_grow_out_pond_id", None)
        linked = AquaculturePond.objects.filter(pk=linked_id, company_id=cid).first() if linked_id else None
        if linked and linked.is_active and (linked.pond_role or "") == "grow_out":
            continue
        grow = (
            AquaculturePond.objects.filter(
                company_id=cid,
                physical_site_name__iexact=site,
                pond_role="grow_out",
                is_active=True,
            )
            .exclude(pk=nursing.pk)
            .order_by("sort_order", "id")
            .first()
        )
        if not grow:
            grow_name = _grow_out_name_for_site(site, nursing.name or "")
            if AquaculturePond.objects.filter(company_id=cid, name__iexact=grow_name).exists():
                grow_name = f"{grow_name} ({site})"[:200]
            max_sort = (
                AquaculturePond.objects.filter(company_id=cid).order_by("-sort_order").values_list("sort_order", flat=True).first()
                or 0
            )
            grow = AquaculturePond.objects.create(
                company_id=cid,
                name=grow_name[:200],
                code=f"P-AUTO-{nursing.id}-GO"[:64],
                sort_order=int(max_sort) + 1,
                is_active=True,
                pond_role="grow_out",
                physical_site_name=site[:120],
            )
        nursing.linked_grow_out_pond_id = grow.id
        nursing.save(update_fields=["linked_grow_out_pond_id", "updated_at"])


def _noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0132_fix_nursing_grow_out_links"),
    ]

    operations = [
        migrations.RunPython(_ensure_company_site_pairs, _noop),
    ]
