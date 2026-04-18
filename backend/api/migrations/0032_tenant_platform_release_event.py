# Generated manually — audit trail for tenant platform upgrades.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0031_company_platform_release_previous"),
    ]

    operations = [
        migrations.CreateModel(
            name="TenantPlatformReleaseEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("category", models.CharField(db_index=True, help_text="master_push | apply_release | rollback_release", max_length=32)),
                ("server_target_release", models.CharField(blank=True, default="", max_length=64)),
                ("success", models.BooleanField(default=True)),
                ("error_message", models.TextField(blank=True)),
                ("actor_user_id", models.IntegerField(blank=True, null=True)),
                ("source", models.CharField(blank=True, default="", max_length=48)),
                ("detail", models.JSONField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=models.CASCADE,
                        related_name="platform_release_events",
                        to="api.company",
                    ),
                ),
            ],
            options={
                "db_table": "tenant_platform_release_event",
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="tenantplatformreleaseevent",
            index=models.Index(fields=["company", "-created_at"], name="tenant_plat_company_4376c6_idx"),
        ),
    ]
