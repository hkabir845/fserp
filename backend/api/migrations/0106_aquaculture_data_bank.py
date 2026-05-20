# Aquaculture Data Bank: fiscal year close and per-pond locks.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0105_password_reset_token_indexes"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AquacultureDataBankPeriod",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("label", models.CharField(help_text="Display label, e.g. FY 2025.", max_length=120)),
                ("period_start", models.DateField()),
                ("period_end", models.DateField()),
                ("status", models.CharField(db_index=True, default="closed", max_length=16)),
                ("closed_at", models.DateTimeField(auto_now_add=True)),
                ("notes", models.TextField(blank=True)),
                (
                    "closed_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="aquaculture_data_bank_periods_closed",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="aquaculture_data_bank_periods",
                        to="api.company",
                    ),
                ),
            ],
            options={
                "db_table": "aquaculture_data_bank_period",
                "ordering": ["-period_end", "-id"],
            },
        ),
        migrations.CreateModel(
            name="AquacultureDataBankPondLock",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "is_data_locked",
                    models.BooleanField(
                        default=True,
                        help_text="When true, operational writes for this pond are blocked.",
                    ),
                ),
                (
                    "reference_access_enabled",
                    models.BooleanField(
                        default=False,
                        help_text="Admin reopened this pond in Data Bank for historical reference (read-only).",
                    ),
                ),
                ("reopened_at", models.DateTimeField(blank=True, null=True)),
                ("reopen_reason", models.TextField(blank=True)),
                ("relocked_at", models.DateTimeField(blank=True, null=True)),
                (
                    "period",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="pond_locks",
                        to="api.aquaculturedatabankperiod",
                    ),
                ),
                (
                    "pond",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="data_bank_locks",
                        to="api.aquaculturepond",
                    ),
                ),
                (
                    "relocked_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="aquaculture_data_bank_pond_locks_relocked",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "reopened_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="aquaculture_data_bank_pond_locks_reopened",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "db_table": "aquaculture_data_bank_pond_lock",
            },
        ),
        migrations.AddIndex(
            model_name="aquaculturedatabankperiod",
            index=models.Index(fields=["company", "period_end"], name="aquaculture_company_6e0f0d_idx"),
        ),
        migrations.AddConstraint(
            model_name="aquaculturedatabankperiod",
            constraint=models.UniqueConstraint(
                fields=("company", "period_end"),
                name="uq_aquaculture_data_bank_period_company_end",
            ),
        ),
        migrations.AddIndex(
            model_name="aquaculturedatabankpondlock",
            index=models.Index(fields=["pond", "is_data_locked"], name="aquaculture_pond_id_8c2a1b_idx"),
        ),
        migrations.AlterUniqueTogether(
            name="aquaculturedatabankpondlock",
            unique_together={("period", "pond")},
        ),
    ]
