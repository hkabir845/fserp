from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0097_bill_line_fuel_station_reporting"),
    ]

    operations = [
        migrations.AddField(
            model_name="item",
            name="pieces_per_kg",
            field=models.DecimalField(
                blank=True,
                decimal_places=4,
                help_text=(
                    "Fish / fry only: how many pieces (heads) make one kilogram (pcs/kg). "
                    "Used on vendor bills to derive weight and headcount from quantity and amount."
                ),
                max_digits=12,
                null=True,
            ),
        ),
    ]
