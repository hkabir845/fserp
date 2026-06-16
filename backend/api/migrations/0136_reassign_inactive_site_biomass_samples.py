"""Move biomass samples off inactive duplicate site ponds onto the active nursing profit center."""

from __future__ import annotations

from django.db import migrations


def _reassign_inactive_site_samples(apps, schema_editor):
    AquaculturePond = apps.get_model("api", "AquaculturePond")
    AquacultureBiomassSample = apps.get_model("api", "AquacultureBiomassSample")
    AquacultureProductionCycle = apps.get_model("api", "AquacultureProductionCycle")

    for inactive in AquaculturePond.objects.filter(is_active=False).exclude(physical_site_name="").iterator():
        site = (inactive.physical_site_name or "").strip()
        if not site:
            continue
        nursing = (
            AquaculturePond.objects.filter(
                company_id=inactive.company_id,
                physical_site_name__iexact=site,
                pond_role="nursing",
                is_active=True,
            )
            .order_by("id")
            .first()
        )
        if not nursing or nursing.id == inactive.id:
            continue
        for sample in AquacultureBiomassSample.objects.filter(pond_id=inactive.id).iterator():
            cycle_id = sample.production_cycle_id
            if cycle_id:
                cycle = AquacultureProductionCycle.objects.filter(pk=cycle_id).first()
                if cycle is None or cycle.pond_id != nursing.id:
                    sample.production_cycle_id = None
            sample.pond_id = nursing.id
            sample.save(update_fields=["pond_id", "production_cycle_id"])


def _noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0135_backfill_biomass_sample_extrapolation"),
    ]

    operations = [
        migrations.RunPython(_reassign_inactive_site_samples, _noop_reverse),
    ]
