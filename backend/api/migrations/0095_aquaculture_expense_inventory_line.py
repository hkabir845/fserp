import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0094_invoice_line_nozzle_shift_closing_meters"),
    ]

    operations = [
        migrations.CreateModel(
            name="AquacultureExpenseInventoryLine",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("quantity", models.DecimalField(decimal_places=4, max_digits=14)),
                (
                    "expense",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="inventory_lines",
                        to="api.aquacultureexpense",
                    ),
                ),
                (
                    "item",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="aquaculture_expense_inventory_lines",
                        to="api.item",
                    ),
                ),
                (
                    "source_station",
                    models.ForeignKey(
                        blank=True,
                        help_text="When set, stock was taken from this station's shop (bins or QOH); when null, from the expense pond warehouse.",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="aquaculture_expense_inventory_lines",
                        to="api.station",
                    ),
                ),
            ],
            options={
                "db_table": "aquaculture_expense_inventory_line",
                "ordering": ["id"],
            },
        ),
    ]
