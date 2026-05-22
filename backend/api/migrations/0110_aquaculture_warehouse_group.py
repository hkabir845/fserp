from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0109_aquaculture_landlord_opening_balance"),
    ]

    operations = [
        migrations.CreateModel(
            name="AquacultureWarehouseGroup",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=200)),
                ("code", models.CharField(blank=True, max_length=64)),
                ("notes", models.TextField(blank=True)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="aquaculture_warehouse_groups",
                        to="api.company",
                    ),
                ),
            ],
            options={
                "db_table": "aquaculture_warehouse_group",
                "ordering": ["name", "id"],
            },
        ),
        migrations.AddIndex(
            model_name="aquaculturewarehousegroup",
            index=models.Index(fields=["company", "is_active"], name="aquaculture_company_8e2f1a_idx"),
        ),
        migrations.AddField(
            model_name="aquaculturepond",
            name="warehouse_group",
            field=models.ForeignKey(
                blank=True,
                help_text="When set, this pond's pond-warehouse balance is an allocation from a shared physical store. Use pond-to-pond warehouse transfer to reallocate between members.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="ponds",
                to="api.aquaculturewarehousegroup",
            ),
        ),
        migrations.CreateModel(
            name="PondWarehouseInterPondTransfer",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("transfer_number", models.CharField(blank=True, max_length=64)),
                ("memo", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="pond_warehouse_inter_pond_transfers",
                        to="api.company",
                    ),
                ),
                (
                    "from_pond",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="warehouse_transfers_out",
                        to="api.aquaculturepond",
                    ),
                ),
                (
                    "to_pond",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="warehouse_transfers_in",
                        to="api.aquaculturepond",
                    ),
                ),
            ],
            options={
                "db_table": "pond_warehouse_inter_pond_transfer",
                "ordering": ["-created_at", "-id"],
            },
        ),
        migrations.CreateModel(
            name="PondWarehouseInterPondTransferLine",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("quantity", models.DecimalField(decimal_places=4, max_digits=14)),
                (
                    "item",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="pond_warehouse_inter_pond_transfer_lines",
                        to="api.item",
                    ),
                ),
                (
                    "transfer",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="lines",
                        to="api.pondwarehouseinterpondtransfer",
                    ),
                ),
            ],
            options={
                "db_table": "pond_warehouse_inter_pond_transfer_line",
            },
        ),
        migrations.AddIndex(
            model_name="pondwarehouseinterpondtransfer",
            index=models.Index(
                fields=["company", "from_pond", "created_at"],
                name="pond_wh_ip_from_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="pondwarehouseinterpondtransfer",
            index=models.Index(
                fields=["company", "to_pond", "created_at"],
                name="pond_wh_ip_to_idx",
            ),
        ),
    ]
