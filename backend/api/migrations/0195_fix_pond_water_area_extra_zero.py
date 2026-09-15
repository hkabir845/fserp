"""Strip the extra trailing zero on Digonta / Ashari-2 / Mynuddin Nursing water areas."""

from __future__ import annotations

from django.db import migrations


def _fix_extra_zero_water_areas(apps, schema_editor):
    from api.services.aquaculture_pond_water_area_fix import apply_extra_zero_water_area_corrections

    apply_extra_zero_water_area_corrections()


def _noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0194_tax_rate_range_and_mill_field_descriptions"),
    ]

    operations = [
        migrations.RunPython(_fix_extra_zero_water_areas, _noop),
    ]
