"""Recompute biomass sample extrapolation after full aquaculture schema is applied."""

from __future__ import annotations

from django.db import migrations


def _backfill_biomass_sample_extrapolation(apps, schema_editor):
    AquacultureBiomassSample = apps.get_model("api", "AquacultureBiomassSample")
    from api.services.aquaculture_biomass_sample_service import apply_aquaculture_biomass_sample_extrapolation

    update_fields = [
        "stock_reference_fish_count",
        "stock_reference_net_weight_kg",
        "stock_reference_avg_weight_kg",
        "extrapolated_biomass_kg",
        "biomass_gain_kg",
    ]
    for sample in AquacultureBiomassSample.objects.all().iterator():
        apply_aquaculture_biomass_sample_extrapolation(sample)
        sample.save(update_fields=update_fields)


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0153_company_language"),
    ]

    operations = [
        migrations.RunPython(_backfill_biomass_sample_extrapolation, migrations.RunPython.noop),
    ]
