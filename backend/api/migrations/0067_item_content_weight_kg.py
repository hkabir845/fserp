from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0066_backfill_pond_pos_customers"),
    ]

    operations = [
        migrations.AddField(
            model_name="item",
            name="content_weight_kg",
            field=models.DecimalField(
                blank=True,
                decimal_places=4,
                help_text=(
                    "Labeled kg per selling unit for sack-packed feed (e.g. 25). "
                    "Inventory and POS quantities use `unit` (typically sack); this is for weight hints and reporting."
                ),
                max_digits=12,
                null=True,
            ),
        ),
    ]
