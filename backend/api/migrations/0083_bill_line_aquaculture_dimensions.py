import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0082_aquaculture_pond_default_medicine_item"),
    ]

    operations = [
        migrations.AddField(
            model_name="billline",
            name="aquaculture_cost_bucket",
            field=models.CharField(
                blank=True,
                help_text="Optional P&L cost bucket when aquaculture_pond is set (e.g. equipment, feed).",
                max_length=40,
            ),
        ),
        migrations.AddField(
            model_name="billline",
            name="aquaculture_pond",
            field=models.ForeignKey(
                blank=True,
                help_text="When set, expense-side GL lines from this bill line are tagged for aquaculture pond P&L.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="bill_lines",
                to="api.aquaculturepond",
            ),
        ),
        migrations.AddField(
            model_name="billline",
            name="aquaculture_production_cycle",
            field=models.ForeignKey(
                blank=True,
                help_text="Optional production cycle (must belong to aquaculture_pond).",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="bill_lines",
                to="api.aquacultureproductioncycle",
            ),
        ),
    ]
