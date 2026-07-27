# Generated manually for CompanyJobType (custom job types + access-profile allowlists)

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0165_permanent_aquaculture_adib_filling_station"),
    ]

    operations = [
        migrations.CreateModel(
            name="CompanyJobType",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("key", models.CharField(max_length=64)),
                ("label", models.CharField(max_length=120)),
                ("hint", models.CharField(blank=True, max_length=500)),
                ("inherits_from", models.CharField(blank=True, default="", max_length=64)),
                ("is_custom", models.BooleanField(default=True)),
                ("access_profile_enabled", models.BooleanField(default=False)),
                ("is_active", models.BooleanField(default=True)),
                ("sort_order", models.IntegerField(default=200)),
                ("created_at", models.DateTimeField(auto_now_add=True, null=True)),
                ("updated_at", models.DateTimeField(auto_now=True, null=True)),
                (
                    "allowed_roles",
                    models.ManyToManyField(
                        blank=True,
                        related_name="enabled_job_types",
                        to="api.companyrole",
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="job_types",
                        to="api.company",
                    ),
                ),
            ],
            options={
                "db_table": "company_job_type",
                "ordering": ["company_id", "sort_order", "label"],
                "unique_together": {("company", "key")},
            },
        ),
    ]
