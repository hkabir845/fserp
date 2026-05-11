# Average depth (ft) and lease price per decimal: 2 fractional digits.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0089_aquaculture_pond_area_two_decimal_places"),
    ]

    operations = [
        migrations.AlterField(
            model_name="aquaculturepond",
            name="pond_depth_ft",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text=(
                    "Representative average depth in feet — with water area (decimals) uses "
                    "435.6 sq ft per decimal for volume."
                ),
                max_digits=10,
                null=True,
            ),
        ),
        migrations.AlterField(
            model_name="aquaculturepond",
            name="lease_price_per_decimal_per_year",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=18, null=True),
        ),
    ]
