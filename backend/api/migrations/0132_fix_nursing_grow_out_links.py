"""Re-point nursing ponds away from inactive/wrong linked grow-out rows."""

from __future__ import annotations

from django.db import migrations


def _fix_nursing_links(apps, schema_editor):
    AquaculturePond = apps.get_model("api", "AquaculturePond")
    for nursing in AquaculturePond.objects.filter(pond_role="nursing", is_active=True).iterator():
        linked_id = getattr(nursing, "linked_grow_out_pond_id", None)
        linked = AquaculturePond.objects.filter(pk=linked_id).first() if linked_id else None
        needs_fix = linked is None or not linked.is_active or (linked.pond_role or "") != "grow_out"
        if not needs_fix:
            continue
        site = (getattr(nursing, "physical_site_name", None) or "").strip()
        grow = None
        if site:
            grow = (
                AquaculturePond.objects.filter(
                    company_id=nursing.company_id,
                    physical_site_name__iexact=site,
                    pond_role="grow_out",
                    is_active=True,
                )
                .exclude(pk=nursing.pk)
                .order_by("sort_order", "id")
                .first()
            )
        if grow:
            nursing.linked_grow_out_pond_id = grow.id
            nursing.save(update_fields=["linked_grow_out_pond_id", "updated_at"])


def _noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0131_backfill_aquaculture_site_phases"),
    ]

    operations = [
        migrations.RunPython(_fix_nursing_links, _noop),
    ]
