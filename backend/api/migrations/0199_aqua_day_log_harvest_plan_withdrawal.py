# Aquaculture P0 ops: day log, harvest lot plan, structured treatment withdrawal.

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0198_bill_idempotency_user_company_fk"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquacultureexpense",
            name="withdrawal_days",
            field=models.PositiveIntegerField(
                blank=True,
                help_text=(
                    "Medicine/treatment withdrawal period in days from expense_date. "
                    "Used for food-fish sale clearance; prefer this over memo-only Withdrawal: N d."
                ),
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="aquacultureexpense",
            name="clear_to_sell_on",
            field=models.DateField(
                blank=True,
                db_index=True,
                help_text=(
                    "Earliest calendar date food-fish from this pond may be sold after this treatment "
                    "(expense_date + withdrawal_days). Null when no withdrawal applies."
                ),
                null=True,
            ),
        ),
        migrations.AddIndex(
            model_name="aquacultureexpense",
            index=models.Index(
                fields=["company", "pond", "clear_to_sell_on"],
                name="aquaculture_company_5f0c1a_idx",
            ),
        ),
        migrations.CreateModel(
            name="AquaculturePondDayLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("log_date", models.DateField(db_index=True)),
                ("do_morning_mg_l", models.DecimalField(blank=True, decimal_places=2, max_digits=8, null=True)),
                ("do_evening_mg_l", models.DecimalField(blank=True, decimal_places=2, max_digits=8, null=True)),
                ("ph", models.DecimalField(blank=True, decimal_places=2, max_digits=6, null=True)),
                ("temp_c", models.DecimalField(blank=True, decimal_places=2, max_digits=6, null=True)),
                ("ammonia_mg_l", models.DecimalField(blank=True, decimal_places=3, max_digits=8, null=True)),
                ("mortality_count", models.PositiveIntegerField(blank=True, null=True)),
                ("mortality_kg", models.DecimalField(blank=True, decimal_places=3, max_digits=12, null=True)),
                ("feed_kg", models.DecimalField(blank=True, decimal_places=3, max_digits=12, null=True)),
                ("aerator_hours", models.DecimalField(blank=True, decimal_places=2, max_digits=8, null=True)),
                (
                    "appetite",
                    models.CharField(
                        blank=True,
                        default="",
                        help_text="normal | low | none | leftover — free text ok for field notes.",
                        max_length=32,
                    ),
                ),
                ("weather", models.CharField(blank=True, default="", max_length=120)),
                ("notes", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="aquaculture_pond_day_logs",
                        to="api.company",
                    ),
                ),
                (
                    "pond",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="day_logs",
                        to="api.aquaculturepond",
                    ),
                ),
            ],
            options={
                "db_table": "aquaculture_pond_day_log",
                "ordering": ["-log_date", "-id"],
            },
        ),
        migrations.CreateModel(
            name="AquacultureHarvestLotPlan",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(blank=True, default="", max_length=200)),
                ("planned_start", models.DateField(db_index=True)),
                ("planned_end", models.DateField(db_index=True)),
                ("target_avg_weight_g", models.DecimalField(blank=True, decimal_places=1, max_digits=10, null=True)),
                ("target_weight_kg", models.DecimalField(blank=True, decimal_places=3, max_digits=14, null=True)),
                ("target_fish_count", models.PositiveIntegerField(blank=True, null=True)),
                (
                    "priority",
                    models.PositiveSmallIntegerField(default=100, help_text="Lower = earlier in the sequence."),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("planned", "Planned"),
                            ("cleared", "Cleared to sell"),
                            ("ready", "Ready"),
                            ("partial", "Partially sold"),
                            ("sold", "Sold"),
                            ("deferred", "Deferred"),
                            ("cancelled", "Cancelled"),
                        ],
                        db_index=True,
                        default="planned",
                        max_length=16,
                    ),
                ),
                (
                    "depends_on_clearance",
                    models.BooleanField(
                        default=True,
                        help_text="When true, sale clearance (withdrawal) must be met before marking ready/sold.",
                    ),
                ),
                ("notes", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="aquaculture_harvest_lot_plans",
                        to="api.company",
                    ),
                ),
                (
                    "pond",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="harvest_lot_plans",
                        to="api.aquaculturepond",
                    ),
                ),
                (
                    "production_cycle",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="harvest_lot_plans",
                        to="api.aquacultureproductioncycle",
                    ),
                ),
            ],
            options={
                "db_table": "aquaculture_harvest_lot_plan",
                "ordering": ["priority", "planned_start", "id"],
            },
        ),
        migrations.AddConstraint(
            model_name="aquacultureponddaylog",
            constraint=models.UniqueConstraint(
                fields=("company", "pond", "log_date"),
                name="uq_aq_pond_day_log_company_pond_date",
            ),
        ),
        migrations.AddIndex(
            model_name="aquacultureponddaylog",
            index=models.Index(fields=["company", "log_date"], name="aquaculture_company_daylog_idx"),
        ),
        migrations.AddIndex(
            model_name="aquacultureponddaylog",
            index=models.Index(
                fields=["company", "pond", "log_date"],
                name="aquaculture_company_pond_day_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="aquacultureharvestlotplan",
            index=models.Index(
                fields=["company", "status", "planned_start"],
                name="aquaculture_harvest_status_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="aquacultureharvestlotplan",
            index=models.Index(
                fields=["company", "pond", "planned_start"],
                name="aquaculture_harvest_pond_idx",
            ),
        ),
    ]
