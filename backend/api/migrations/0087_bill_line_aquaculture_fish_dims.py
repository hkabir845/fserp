import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0086_landlord_ledger_payment_gl"),
    ]

    operations = [
        migrations.AddField(
            model_name="billline",
            name="aquaculture_fish_weight_kg",
            field=models.DecimalField(
                blank=True,
                decimal_places=4,
                help_text="For fish-type items: total weight (kg) on this vendor line (optional).",
                max_digits=14,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="billline",
            name="aquaculture_fish_count",
            field=models.IntegerField(
                blank=True,
                help_text="For fish-type items: total headcount on this vendor line (optional).",
                null=True,
            ),
        ),
    ]
