import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0067_item_content_weight_kg"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquaculturepond",
            name="pond_role",
            field=models.CharField(
                db_index=True,
                default="grow_out",
                help_text="grow_out | nursing | broodstock | other — for filters and transfer workflows (management only).",
                max_length=32,
            ),
        ),
        migrations.CreateModel(
            name="AquacultureFishPondTransfer",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("transfer_date", models.DateField(db_index=True)),
                ("fish_species", models.CharField(db_index=True, default="tilapia", max_length=64)),
                ("fish_species_other", models.CharField(blank=True, max_length=120)),
                ("memo", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="aquaculture_fish_pond_transfers",
                        to="api.company",
                    ),
                ),
                (
                    "from_pond",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="fish_transfers_out",
                        to="api.aquaculturepond",
                    ),
                ),
                (
                    "from_production_cycle",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="fish_transfers_out",
                        to="api.aquacultureproductioncycle",
                    ),
                ),
            ],
            options={
                "db_table": "aquaculture_fish_pond_transfer",
                "ordering": ["-transfer_date", "-id"],
            },
        ),
        migrations.CreateModel(
            name="AquacultureFishPondTransferLine",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("weight_kg", models.DecimalField(decimal_places=4, max_digits=14)),
                ("fish_count", models.IntegerField(blank=True, null=True)),
                ("pcs_per_kg", models.DecimalField(blank=True, decimal_places=4, max_digits=14, null=True)),
                (
                    "cost_amount",
                    models.DecimalField(
                        decimal_places=2,
                        default=0,
                        help_text="BDT (or company currency) biological cost moved with this line; drives inter-pond P&L allocation.",
                        max_digits=14,
                    ),
                ),
                (
                    "to_pond",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="fish_transfers_in",
                        to="api.aquaculturepond",
                    ),
                ),
                (
                    "to_production_cycle",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="fish_transfers_in",
                        to="api.aquacultureproductioncycle",
                    ),
                ),
                (
                    "transfer",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="lines",
                        to="api.aquaculturefishpondtransfer",
                    ),
                ),
            ],
            options={
                "db_table": "aquaculture_fish_pond_transfer_line",
                "ordering": ["id"],
            },
        ),
        migrations.AddIndex(
            model_name="aquaculturefishpondtransfer",
            index=models.Index(fields=["company", "from_pond", "transfer_date"], name="aquaculture_company_8a1c2d_idx"),
        ),
        migrations.AddIndex(
            model_name="aquaculturefishpondtransferline",
            index=models.Index(fields=["to_pond"], name="aquaculture_to_pond_9b3e4f_idx"),
        ),
    ]
