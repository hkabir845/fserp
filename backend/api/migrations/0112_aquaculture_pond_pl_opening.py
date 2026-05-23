import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0111_company_platform_hooks_version"),
    ]

    operations = [
        migrations.CreateModel(
            name="AquaculturePondPlOpening",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("pl_kind", models.CharField(db_index=True, max_length=16)),
                ("category_code", models.CharField(db_index=True, max_length=64)),
                (
                    "amount",
                    models.DecimalField(
                        decimal_places=2,
                        default=0,
                        help_text="Positive amount; interpreted as revenue (income) or cost (expense) by pl_kind.",
                        max_digits=14,
                    ),
                ),
                ("as_of_date", models.DateField(blank=True, null=True)),
                ("memo", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="aquaculture_pond_pl_openings",
                        to="api.company",
                    ),
                ),
                (
                    "pond",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="pl_openings",
                        to="api.aquaculturepond",
                    ),
                ),
            ],
            options={
                "db_table": "aquaculture_pond_pl_opening",
                "ordering": ["pl_kind", "category_code"],
                "indexes": [
                    models.Index(fields=["company", "pond", "pl_kind"], name="aq_pl_ob_co_pond_kind"),
                ],
            },
        ),
        migrations.AddConstraint(
            model_name="aquaculturepondplopening",
            constraint=models.UniqueConstraint(
                fields=("company", "pond", "pl_kind", "category_code"),
                name="uq_aq_pond_pl_opening_kind_cat",
            ),
        ),
    ]
