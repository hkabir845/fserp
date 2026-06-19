from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0144_aquaculture_expense_empty_sack_count"),
    ]

    operations = [
        migrations.CreateModel(
            name="PondWarehouseStockReturn",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("return_number", models.CharField(blank=True, max_length=64)),
                ("memo", models.CharField(blank=True, max_length=500)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=models.deletion.CASCADE,
                        related_name="pond_warehouse_returns",
                        to="api.company",
                    ),
                ),
                (
                    "pond",
                    models.ForeignKey(
                        on_delete=models.deletion.CASCADE,
                        related_name="warehouse_stock_returns",
                        to="api.aquaculturepond",
                    ),
                ),
                (
                    "to_station",
                    models.ForeignKey(
                        on_delete=models.deletion.PROTECT,
                        related_name="pond_warehouse_returns_in",
                        to="api.station",
                    ),
                ),
            ],
            options={
                "db_table": "pond_warehouse_stock_return",
                "ordering": ["-created_at", "-id"],
            },
        ),
        migrations.CreateModel(
            name="PondWarehouseStockReturnLine",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("quantity", models.DecimalField(decimal_places=4, max_digits=14)),
                (
                    "item",
                    models.ForeignKey(
                        on_delete=models.deletion.PROTECT,
                        related_name="pond_warehouse_return_lines",
                        to="api.item",
                    ),
                ),
                (
                    "stock_return",
                    models.ForeignKey(
                        on_delete=models.deletion.CASCADE,
                        related_name="lines",
                        to="api.pondwarehousestockreturn",
                    ),
                ),
            ],
            options={
                "db_table": "pond_warehouse_stock_return_line",
            },
        ),
    ]
