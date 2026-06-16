"""Backfill physical_site_name and nursing→grow-out links for legacy Digonta / Mynuddin rows."""

from __future__ import annotations

from django.db import migrations


def _site_from_name(name: str) -> str:
    n = (name or "").strip()
    if not n:
        return ""
    for suffix in (
        " Nursing Pond",
        " Nursing",
        "-Grow Out",
        "-Grow-out",
        " Grow Out",
    ):
        if n.lower().endswith(suffix.lower()):
            return n[: -len(suffix)].strip()
    if n.lower().endswith("-grow out"):
        return n[: -len("-grow out")].strip()
    return n


def _backfill_site_phases(apps, schema_editor):
    AquaculturePond = apps.get_model("api", "AquaculturePond")
    for pond in AquaculturePond.objects.filter(is_active=True).iterator():
        name = (pond.name or "").strip()
        site = (getattr(pond, "physical_site_name", None) or "").strip()
        if not site and name:
            inferred = _site_from_name(name)
            if inferred:
                pond.physical_site_name = inferred[:120]
                pond.save(update_fields=["physical_site_name", "updated_at"])

    # Digonta: nursing "Digonta" → grow-out "Digonta-Grow Out" on same site.
    for company_id in (
        AquaculturePond.objects.filter(name__iexact="Digonta", pond_role="nursing")
        .values_list("company_id", flat=True)
        .distinct()
    ):
        nursing = (
            AquaculturePond.objects.filter(
                company_id=company_id, name__iexact="Digonta", pond_role="nursing", is_active=True
            )
            .order_by("id")
            .first()
        )
        if not nursing:
            continue
        grow = (
            AquaculturePond.objects.filter(
                company_id=company_id,
                pond_role="grow_out",
                is_active=True,
            )
            .filter(name__iexact="Digonta-Grow Out")
            .first()
        ) or (
            AquaculturePond.objects.filter(
                company_id=company_id,
                physical_site_name__iexact="Digonta",
                pond_role="grow_out",
                is_active=True,
            )
            .exclude(pk=nursing.pk)
            .order_by("id")
            .first()
        )
        if grow:
            changed = False
            if not (nursing.physical_site_name or "").strip():
                nursing.physical_site_name = "Digonta"
                changed = True
            if not (grow.physical_site_name or "").strip():
                grow.physical_site_name = "Digonta"
                grow.save(update_fields=["physical_site_name", "updated_at"])
            linked = (
                AquaculturePond.objects.filter(pk=getattr(nursing, "linked_grow_out_pond_id", None)).first()
                if getattr(nursing, "linked_grow_out_pond_id", None)
                else None
            )
            if (
                not getattr(nursing, "linked_grow_out_pond_id", None)
                or linked is None
                or not linked.is_active
                or (linked.pond_role or "") != "grow_out"
            ):
                nursing.linked_grow_out_pond_id = grow.id
                changed = True
            if changed:
                nursing.save(update_fields=["physical_site_name", "linked_grow_out_pond_id", "updated_at"])

        # Duplicate mis-labeled "Digonta Nursing" grow-out row — deactivate when real nursing exists.
        dup = (
            AquaculturePond.objects.filter(
                company_id=company_id,
                name__iexact="Digonta Nursing",
                pond_role="grow_out",
                is_active=True,
            )
            .exclude(pk=nursing.pk)
            .first()
        )
        if dup:
            grow_label = grow.name if grow else "?"
            dup.is_active = False
            note = (dup.notes or "").strip()
            dup.notes = (
                f"{note}\n[auto] Deactivated duplicate — use nursing pond {nursing.name!r} "
                f"(id={nursing.id}) and grow-out {grow_label!r} on site Digonta."
            ).strip()
            dup.save(update_fields=["is_active", "notes", "updated_at"])

    # Mynuddin: ensure grow-out pond has site; create nursing pair only when missing.
    for company_id in (
        AquaculturePond.objects.filter(name__iexact="Mynuddin", pond_role="grow_out")
        .values_list("company_id", flat=True)
        .distinct()
    ):
        grow = (
            AquaculturePond.objects.filter(
                company_id=company_id, name__iexact="Mynuddin", pond_role="grow_out", is_active=True
            )
            .order_by("id")
            .first()
        )
        if not grow:
            continue
        site = (grow.physical_site_name or "").strip() or "Mynuddin"
        if not (grow.physical_site_name or "").strip():
            grow.physical_site_name = site
            grow.save(update_fields=["physical_site_name", "updated_at"])
        has_nursing = AquaculturePond.objects.filter(
            company_id=company_id,
            physical_site_name__iexact=site,
            pond_role="nursing",
            is_active=True,
        ).exists()
        if has_nursing:
            nursing = (
                AquaculturePond.objects.filter(
                    company_id=company_id,
                    physical_site_name__iexact=site,
                    pond_role="nursing",
                    is_active=True,
                )
                .order_by("id")
                .first()
            )
            if nursing and not getattr(nursing, "linked_grow_out_pond_id", None):
                nursing.linked_grow_out_pond_id = grow.id
                nursing.save(update_fields=["linked_grow_out_pond_id", "updated_at"])


def _noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0130_aquaculture_pond_same_site_phases"),
    ]

    operations = [
        migrations.RunPython(_backfill_site_phases, _noop_reverse),
    ]
