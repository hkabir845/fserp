# Pond water / lease area in decimals: store and expose at 2 fractional digits.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0088_aquaculture_biomass_sample_extrapolation"),
    ]

    operations = [
        migrations.AlterField(
            model_name="aquaculturepond",
            name="leasing_area_decimal",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Leased land area in decimals — used with lease price per decimal for landlord rent.",
                max_digits=14,
                null=True,
            ),
        ),
        migrations.AlterField(
            model_name="aquaculturepond",
            name="water_area_decimal",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text=(
                    "Effective water surface area in decimals — for stocking, density, and production planning."
                ),
                max_digits=14,
                null=True,
            ),
        ),
    ]
