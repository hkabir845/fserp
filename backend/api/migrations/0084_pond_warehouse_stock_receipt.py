import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0083_bill_line_aquaculture_dimensions"),
    ]

    operations = [
        migrations.CreateModel(
            name="PondWarehouseStockReceipt",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("receipt_number", models.CharField(blank=True, max_length=64)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="pond_warehouse_receipts",
                        to="api.company",
                    ),
                ),
                (
                    "from_station",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="pond_warehouse_receipts_out",
                        to="api.station",
                    ),
                ),
                (
                    "pond",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="warehouse_stock_receipts",
                        to="api.aquaculturepond",
                    ),
                ),
            ],
            options={
                "db_table": "pond_warehouse_stock_receipt",
                "ordering": ["-created_at", "-id"],
            },
        ),
        migrations.CreateModel(
            name="PondWarehouseStockReceiptLine",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("quantity", models.DecimalField(decimal_places=4, max_digits=14)),
                (
                    "item",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="pond_warehouse_receipt_lines",
                        to="api.item",
                    ),
                ),
                (
                    "receipt",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="lines",
                        to="api.pondwarehousestockreceipt",
                    ),
                ),
            ],
            options={
                "db_table": "pond_warehouse_stock_receipt_line",
            },
        ),
    ]
