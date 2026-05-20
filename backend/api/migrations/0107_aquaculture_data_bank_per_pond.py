# Per-pond Data Bank closes (replaces company-wide period + pond_lock).

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def migrate_period_locks_to_pond_closes(apps, schema_editor):
    Period = apps.get_model("api", "AquacultureDataBankPeriod")
    Lock = apps.get_model("api", "AquacultureDataBankPondLock")
    Close = apps.get_model("api", "AquacultureDataBankPondClose")
    if Lock.objects.count() == 0:
        return
    for lock in Lock.objects.select_related("period", "pond").iterator():
        period = lock.period
        Close.objects.get_or_create(
            pond_id=lock.pond_id,
            period_end=period.period_end,
            defaults={
                "company_id": period.company_id,
                "label": period.label,
                "period_start": period.period_start,
                "status": period.status,
                "is_data_locked": lock.is_data_locked,
                "reference_access_enabled": lock.reference_access_enabled,
                "closed_at": period.closed_at,
                "closed_by_id": period.closed_by_id,
                "notes": period.notes,
                "reopened_at": lock.reopened_at,
                "reopened_by_id": lock.reopened_by_id,
                "reopen_reason": lock.reopen_reason,
                "relocked_at": lock.relocked_at,
                "relocked_by_id": lock.relocked_by_id,
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0106_aquaculture_data_bank"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AquacultureDataBankPondClose",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("label", models.CharField(help_text="Display label, e.g. Pond A — FY 2025.", max_length=120)),
                ("period_start", models.DateField()),
                ("period_end", models.DateField(help_text="Year-end / close date chosen for this pond.")),
                ("status", models.CharField(db_index=True, default="closed", max_length=16)),
                ("is_data_locked", models.BooleanField(default=True, help_text="When true, operational writes for this pond are blocked.")),
                (
                    "reference_access_enabled",
                    models.BooleanField(
                        default=False,
                        help_text="Admin reopened this close in Data Bank for historical reference (read-only).",
                    ),
                ),
                ("closed_at", models.DateTimeField(auto_now_add=True)),
                ("notes", models.TextField(blank=True)),
                ("reopened_at", models.DateTimeField(blank=True, null=True)),
                ("reopen_reason", models.TextField(blank=True)),
                ("relocked_at", models.DateTimeField(blank=True, null=True)),
                (
                    "closed_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="aquaculture_data_bank_pond_closes_closed",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="aquaculture_data_bank_pond_closes",
                        to="api.company",
                    ),
                ),
                (
                    "pond",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="data_bank_closes",
                        to="api.aquaculturepond",
                    ),
                ),
                (
                    "relocked_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="aquaculture_data_bank_pond_closes_relocked",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "reopened_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="aquaculture_data_bank_pond_closes_reopened",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "db_table": "aquaculture_data_bank_pond_close",
                "ordering": ["-period_end", "-id"],
            },
        ),
        migrations.RunPython(migrate_period_locks_to_pond_closes, migrations.RunPython.noop),
        migrations.AddIndex(
            model_name="aquaculturedatabankpondclose",
            index=models.Index(fields=["company", "pond", "period_end"], name="aq_db_close_co_pond_end_idx"),
        ),
        migrations.AddIndex(
            model_name="aquaculturedatabankpondclose",
            index=models.Index(fields=["pond", "is_data_locked"], name="aq_db_close_pond_lock_idx"),
        ),
        migrations.AddConstraint(
            model_name="aquaculturedatabankpondclose",
            constraint=models.UniqueConstraint(
                fields=("pond", "period_end"),
                name="uq_aquaculture_data_bank_pond_close_pond_end",
            ),
        ),
        migrations.DeleteModel(name="AquacultureDataBankPondLock"),
        migrations.DeleteModel(name="AquacultureDataBankPeriod"),
    ]
