# Generated manually for Platform Brain API config UI

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0158_company_brain"),
    ]

    operations = [
        migrations.CreateModel(
            name="PlatformBrainConfig",
            fields=[
                ("id", models.PositiveSmallIntegerField(default=1, primary_key=True, serialize=False)),
                (
                    "free_api_key",
                    models.CharField(
                        blank=True,
                        default="",
                        help_text="OpenRouter (or compatible) API key for free-tier Brain chat.",
                        max_length=256,
                    ),
                ),
                (
                    "vendor_api_key",
                    models.CharField(
                        blank=True,
                        default="",
                        help_text="Paid vendor API key for Growth/Enterprise (reasoning + web research).",
                        max_length=256,
                    ),
                ),
                ("free_model_reasoning", models.CharField(default="google/gemini-2.0-flash-001", max_length=128)),
                ("vendor_model_reasoning", models.CharField(default="anthropic/claude-3.5-sonnet", max_length=128)),
                ("vendor_model_research", models.CharField(default="perplexity/sonar", max_length=128)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "updated_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="brain_config_updates",
                        to="api.user",
                    ),
                ),
            ],
            options={
                "verbose_name": "Platform Brain config",
                "db_table": "platform_brain_config",
            },
        ),
    ]
