# Aquaculture feeding advice: WorldFish-style tilapia rations + manager review workflow.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0077_pond_depth_m_to_ft_column"),
    ]

    operations = [
        migrations.CreateModel(
            name="AquacultureFeedingAdvice",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "target_date",
                    models.DateField(db_index=True, help_text="Calendar day this feeding plan targets."),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending_review", "Pending review"),
                            ("approved", "Approved"),
                            ("applied", "Applied"),
                            ("cancelled", "Cancelled"),
                        ],
                        db_index=True,
                        default="pending_review",
                        max_length=32,
                    ),
                ),
                (
                    "pond_status_snapshot",
                    models.JSONField(
                        default=dict,
                        help_text="Pond metrics at generation time (stock position, recent feed, etc.).",
                    ),
                ),
                (
                    "ai_advice_text",
                    models.TextField(help_text="Original generated advisory narrative."),
                ),
                (
                    "edited_advice_text",
                    models.TextField(
                        blank=True,
                        help_text="Manager-edited narrative; when empty, effective text follows ai_advice_text.",
                    ),
                ),
                (
                    "suggested_feed_kg",
                    models.DecimalField(
                        blank=True,
                        decimal_places=4,
                        help_text="Suggested total feed (kg) for target_date; manager may override before approval.",
                        max_digits=14,
                        null=True,
                    ),
                ),
                (
                    "approved_advice_text",
                    models.TextField(blank=True, help_text="Snapshot of agreed text at approval."),
                ),
                ("approved_at", models.DateTimeField(blank=True, null=True)),
                ("applied_feed_kg", models.DecimalField(blank=True, decimal_places=4, max_digits=14, null=True)),
                ("applied_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "applied_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="aquaculture_feeding_advices_applied",
                        to="api.user",
                    ),
                ),
                (
                    "approved_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="aquaculture_feeding_advices_approved",
                        to="api.user",
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="aquaculture_feeding_advices",
                        to="api.company",
                    ),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="aquaculture_feeding_advices_created",
                        to="api.user",
                    ),
                ),
                (
                    "linked_expense",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="feeding_advice",
                        to="api.aquacultureexpense",
                    ),
                ),
                (
                    "pond",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="feeding_advices",
                        to="api.aquaculturepond",
                    ),
                ),
                (
                    "production_cycle",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="feeding_advices",
                        to="api.aquacultureproductioncycle",
                    ),
                ),
            ],
            options={
                "db_table": "aquaculture_feeding_advice",
                "ordering": ["-target_date", "-id"],
            },
        ),
        migrations.AddIndex(
            model_name="aquaculturefeedingadvice",
            index=models.Index(fields=["company", "pond", "target_date"], name="aquaculture_company_568ac8_idx"),
        ),
        migrations.AddIndex(
            model_name="aquaculturefeedingadvice",
            index=models.Index(fields=["company", "status"], name="aquaculture_company_17ed1b_idx"),
        ),
    ]
