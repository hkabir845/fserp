# Feed mill transport credit is ৳ per ton (e.g. 10 t × 950), not a fixed lorry fee.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0191_mill_two_lane_settlement"),
    ]

    operations = [
        migrations.AddField(
            model_name="vendorratecard",
            name="transport_per_ton",
            field=models.DecimalField(
                decimal_places=4,
                default=0,
                help_text="Mill transport credit ৳ per metric ton (kg÷1000). Example: 10 t × 950 = 9500.",
                max_digits=14,
            ),
        ),
        migrations.AlterField(
            model_name="vendorratecard",
            name="transport_per_truck",
            field=models.DecimalField(
                decimal_places=4,
                default=0,
                help_text="Optional fixed ৳ once per bill. Prefer transport_per_ton for feed mills.",
                max_digits=14,
            ),
        ),
    ]
