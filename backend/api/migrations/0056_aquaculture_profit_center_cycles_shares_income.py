# Aquaculture: production cycles, shared expense splits, typed fish-sale income.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0055_aquaculture_pond_profit_transfer"),
    ]

    operations = [
        migrations.CreateModel(
            name="AquacultureProductionCycle",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=200)),
                ("code", models.CharField(blank=True, help_text="Optional short code for filters and exports.", max_length=64)),
                ("start_date", models.DateField(db_index=True)),
                ("end_date", models.DateField(blank=True, db_index=True, help_text="Null means the cycle is still open.", null=True)),
                ("sort_order", models.IntegerField(default=0)),
                ("is_active", models.BooleanField(default=True)),
                ("notes", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="aquaculture_production_cycles",
                        to="api.company",
                    ),
                ),
                (
                    "pond",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="production_cycles",
                        to="api.aquaculturepond",
                    ),
                ),
            ],
            options={
                "db_table": "aquaculture_production_cycle",
                "ordering": ["pond_id", "sort_order", "-start_date", "id"],
            },
        ),
        migrations.AddField(
            model_name="aquaculturefishsale",
            name="income_type",
            field=models.CharField(
                db_index=True,
                default="fish_harvest_sale",
                help_text="Stable income line code for management P&L.",
                max_length=64,
            ),
        ),
        migrations.AddField(
            model_name="aquaculturefishsale",
            name="production_cycle",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="fish_sales",
                to="api.aquacultureproductioncycle",
            ),
        ),
        migrations.AddField(
            model_name="aquacultureexpense",
            name="production_cycle",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="expenses",
                to="api.aquacultureproductioncycle",
            ),
        ),
        migrations.AlterField(
            model_name="aquacultureexpense",
            name="pond",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="expenses",
                to="api.aquaculturepond",
            ),
        ),
        migrations.AddField(
            model_name="aquaculturepondprofittransfer",
            name="production_cycle",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="profit_transfers",
                to="api.aquacultureproductioncycle",
            ),
        ),
        migrations.CreateModel(
            name="AquacultureExpensePondShare",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("amount", models.DecimalField(decimal_places=2, max_digits=14)),
                (
                    "expense",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="pond_shares",
                        to="api.aquacultureexpense",
                    ),
                ),
                (
                    "pond",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="aquaculture_expense_shares",
                        to="api.aquaculturepond",
                    ),
                ),
            ],
            options={
                "db_table": "aquaculture_expense_pond_share",
            },
        ),
        migrations.AddConstraint(
            model_name="aquacultureexpensepondshare",
            constraint=models.UniqueConstraint(fields=("expense", "pond"), name="aquaculture_exp_share_exp_pond_uniq"),
        ),
        migrations.AddIndex(
            model_name="aquacultureproductioncycle",
            index=models.Index(fields=["company", "pond", "is_active"], name="aquaculture_company_8c1a2e_idx"),
        ),
        migrations.AddIndex(
            model_name="aquaculturefishsale",
            index=models.Index(fields=["company", "pond", "income_type", "sale_date"], name="aquaculture_company_9d2b3f_idx"),
        ),
        migrations.AddIndex(
            model_name="aquacultureexpense",
            index=models.Index(fields=["company", "expense_date"], name="aquaculture_company_exp_date_idx"),
        ),
    ]
