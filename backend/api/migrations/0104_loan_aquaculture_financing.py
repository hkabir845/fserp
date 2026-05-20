# Generated manually — tag loans used for whole-aquaculture working capital.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0103_employee_labor_scope_not_applicable"),
    ]

    operations = [
        migrations.AddField(
            model_name="loan",
            name="aquaculture_financing",
            field=models.BooleanField(
                default=False,
                help_text=(
                    "When true, loan appears on Aquaculture → Financing and can use pond allocation / "
                    "repayment worksheet tools."
                ),
            ),
        ),
        migrations.CreateModel(
            name="AquacultureFinancingAllocation",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("allocation_date", models.DateField(db_index=True)),
                (
                    "amount",
                    models.DecimalField(
                        decimal_places=2,
                        help_text="Positive amount attributed to this pond (use or repayment contribution).",
                        max_digits=14,
                    ),
                ),
                (
                    "allocation_kind",
                    models.CharField(
                        default="use",
                        help_text="use = funds directed to pond; repayment = pond contribution toward loan.",
                        max_length=16,
                    ),
                ),
                ("memo", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=models.deletion.CASCADE,
                        related_name="aquaculture_financing_allocations",
                        to="api.company",
                    ),
                ),
                (
                    "disbursement",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=models.deletion.SET_NULL,
                        related_name="aquaculture_financing_allocations",
                        to="api.loandisbursement",
                    ),
                ),
                (
                    "loan",
                    models.ForeignKey(
                        on_delete=models.deletion.CASCADE,
                        related_name="aquaculture_financing_allocations",
                        to="api.loan",
                    ),
                ),
                (
                    "pond",
                    models.ForeignKey(
                        on_delete=models.deletion.CASCADE,
                        related_name="financing_allocations",
                        to="api.aquaculturepond",
                    ),
                ),
                (
                    "profit_transfer",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=models.deletion.SET_NULL,
                        related_name="financing_allocations",
                        to="api.aquaculturepondprofittransfer",
                    ),
                ),
            ],
            options={
                "db_table": "aquaculture_financing_allocation",
                "ordering": ["-allocation_date", "-id"],
            },
        ),
        migrations.AddIndex(
            model_name="aquaculturefinancingallocation",
            index=models.Index(fields=["company", "loan", "allocation_date"], name="aq_fin_alloc_co_loan_dt"),
        ),
        migrations.AddIndex(
            model_name="aquaculturefinancingallocation",
            index=models.Index(fields=["company", "pond", "allocation_date"], name="aq_fin_alloc_co_pond_dt"),
        ),
    ]
