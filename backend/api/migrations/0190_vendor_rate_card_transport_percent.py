# Transport % of MRP on mill rate cards (variable transport allowance).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0189_audit_controls_uniques_indexes_meter"),
    ]

    operations = [
        migrations.AddField(
            model_name="vendorratecard",
            name="transport_percent",
            field=models.DecimalField(
                decimal_places=4,
                default=0,
                help_text="Transport allowance as % of line MRP (qty×MRP). Stacks with per-unit/kg/truck when set.",
                max_digits=8,
            ),
        ),
    ]
