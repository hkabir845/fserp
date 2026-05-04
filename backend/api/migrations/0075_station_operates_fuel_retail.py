# Generated manually — station forecourt profile for aquaculture + retail hubs.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0074_journal_entry_line_aquaculture_costing"),
    ]

    operations = [
        migrations.AddField(
            model_name="station",
            name="operates_fuel_retail",
            field=models.BooleanField(
                default=True,
                help_text="When True, this site is expected to run fuel forecourt infrastructure (tanks, islands, nozzles). "
                "Set False for aquaculture hubs / shop-only locations with no underground fuel.",
            ),
        ),
    ]
