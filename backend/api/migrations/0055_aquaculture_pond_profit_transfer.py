# Generated manually for AquaculturePondProfitTransfer

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0054_aquaculture_module"),
    ]

    operations = [
        migrations.CreateModel(
            name="AquaculturePondProfitTransfer",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("transfer_date", models.DateField(db_index=True)),
                ("amount", models.DecimalField(decimal_places=2, max_digits=14)),
                ("memo", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="aquaculture_pond_profit_transfers",
                        to="api.company",
                    ),
                ),
                (
                    "credit_account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="aquaculture_profit_transfer_credits",
                        to="api.chartofaccount",
                    ),
                ),
                (
                    "debit_account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="aquaculture_profit_transfer_debits",
                        to="api.chartofaccount",
                    ),
                ),
                (
                    "journal_entry",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="aquaculture_pond_profit_transfers",
                        to="api.journalentry",
                    ),
                ),
                (
                    "pond",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="profit_transfers",
                        to="api.aquaculturepond",
                    ),
                ),
            ],
            options={
                "db_table": "aquaculture_pond_profit_transfer",
                "ordering": ["-transfer_date", "-id"],
            },
        ),
        migrations.AddIndex(
            model_name="aquaculturepondprofittransfer",
            index=models.Index(fields=["company", "pond", "transfer_date"], name="aquaculture_company_0f90b8_idx"),
        ),
    ]
