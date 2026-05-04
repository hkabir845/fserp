from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0044_inventory_station_stock"),
    ]

    operations = [
        migrations.AddField(
            model_name="company",
            name="station_mode",
            field=models.CharField(
                default="multi",
                help_text="single = at most one station; multi = multiple stations (default).",
                max_length=16,
            ),
        ),
    ]
