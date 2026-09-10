# Generated manually for AuthRefreshSession (refresh rotation + replay detection).

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0180_mill_truck_transport_and_scheme_reserve"),
    ]

    operations = [
        migrations.CreateModel(
            name="AuthRefreshSession",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("jti", models.CharField(db_index=True, max_length=64, unique=True)),
                ("family_id", models.CharField(db_index=True, max_length=64)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("expires_at", models.DateTimeField()),
                ("rotated_at", models.DateTimeField(blank=True, null=True)),
                ("revoked_at", models.DateTimeField(blank=True, null=True)),
                ("user_agent", models.CharField(blank=True, max_length=255)),
                ("ip_address", models.CharField(blank=True, max_length=64)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="auth_refresh_sessions",
                        to="api.user",
                    ),
                ),
            ],
            options={
                "db_table": "auth_refresh_session",
            },
        ),
        migrations.AddIndex(
            model_name="authrefreshsession",
            index=models.Index(fields=["user", "family_id"], name="auth_ref_user_fam_idx"),
        ),
        migrations.AddIndex(
            model_name="authrefreshsession",
            index=models.Index(fields=["expires_at"], name="auth_ref_expires_idx"),
        ),
    ]
