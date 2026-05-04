# Generated manually for fish species on harvest sales.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0062_station_aquaculture_shop_link"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquaculturefishsale",
            name="fish_species",
            field=models.CharField(
                max_length=64,
                db_index=True,
                default="tilapia",
                help_text="Species sold on this line (polyculture); feed remains pond-level.",
            ),
        ),
        migrations.AddField(
            model_name="aquaculturefishsale",
            name="fish_species_other",
            field=models.CharField(
                blank=True,
                help_text="When fish_species is 'other', optional name (e.g. local variety).",
                max_length=120,
            ),
        ),
    ]
