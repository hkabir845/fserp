from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0081_aquaculture_pond_warehouse_stock"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquaculturepond",
            name="default_medicine_item",
            field=models.ForeignKey(
                blank=True,
                help_text="Inventory SKU drawn from this pond's warehouse when recording medicine consumption.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="ponds_default_medicine",
                to="api.item",
            ),
        ),
    ]
